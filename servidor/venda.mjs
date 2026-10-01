/* Venda em transacao.
 *
 * Este e o unico lugar do sistema onde o estoque e decidido. Se 5 caixas
 * venderem ao mesmo tempo, todas passam por aqui, e o SQLite serializa a
 * escrita. A regra deliberada: a venda NUNCA e recusada por falta de estoque.
 * A mercadoria ja saiu da prateleira e o cliente esta na frente do caixa --
 * devolver o cliente ao balcao seria pior que o estoque negativo. O que a
 * venda faz e ser gravada e marcada para o gerente reconciliar.
 */
import { gravar, obter } from './banco.mjs';
import { centavos, reais, arred2, somaCentavos } from './dinheiro.mjs';

/* Erro de entrada do cliente (400) — nao e falha do servidor, entao o cliente
 * precisa saber que a venda foi recusada, e nao que deu problema. */
function entrada(mensagem, codigo) {
  return Object.assign(new Error(mensagem), { status: 400, codigo });
}

/* Folga de 1 centavo. Centavo unico e sempre sujeito a ponto flutuante
 * (10.10 / 3 = 3.3666...), e reprovar uma venda por causa de 0,005 e pior
 * que o erro que ela evita: o cliente esta no balcao com a mercadoria. */
const FOLGA_CENT = 1;

/* Id sequencial de lancamento. Fica em uma funcao propria porque e usado em
 * dois ramos do laco e a versao anterior repetia a mesma subquery giantemente
 * dentro de dois prepare(). */
function proximoLancamentoId(db) {
  const r = db
    .prepare("SELECT COALESCE(MAX(CAST(SUBSTR(id, 2) AS INTEGER)), 5000) + 1 AS n FROM lancamentos WHERE id LIKE 'L%'")
    .get();
  return 'L' + r.n;
}

export function registrarVenda(db, venda, opcoes = {}) {
  const itens = Array.isArray(venda.items) ? venda.items : [];
  if (!itens.length) throw Object.assign(new Error('Venda sem itens.'), { status: 400 });

  const divergentes = [];

  db.exec('BEGIN IMMEDIATE');
  try {
    /* ---- estoque ----
     * O preco unitario vem do servidor, nunca do corpo da venda. O cliente
     * calcula total e troco para a tela, mas quem grava e o preco do cadastro:
     * assim um corpo adulterado (ou um bug de rede) nao baixa o estoque por
     * 999 unidades cobrando R$ 0,01 cada. */
    const itensCorrigidos = [];
    let subtotalCent = 0;
    for (const item of itens) {
      const p = obter(db, 'produtos', item.id);
      if (!p) {
        throw Object.assign(
          new Error(`Produto "${item.name || item.id}" nao existe mais no servidor.`),
          { status: 409, codigo: 'produto_inexistente' }
        );
      }
      /* Quantidade precisa ser positiva e finita. Sem esta regra um corpo com
       * `qty: -50` passa, o estoque AUMENTA 50 unidades numa "venda" e o
       * caixa pode inflar o estoque sem limite simplesmente repetindo a
       * chamada — o preco do servidor estava certo e nao segurava isso. */
      const qty = Number(item.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw entrada(`Quantidade invalida (${item.qty}) em "${p.name || item.id}".`, 'qty_invalida');
      }
      const preco = Number(p.price);
      if (!Number.isFinite(preco) || preco < 0) {
        throw entrada(`Preco invalido no cadastro de "${p.name || item.id}".`, 'preco_invalido');
      }
      /* A conta do item e em centavos: preco em ponto flutuante multiplicado
         por quantidade fracionaria (kg) so acumula erro. */
      const precoCent = centavos(preco);
      const subtotalItemCent = Math.round(precoCent * qty);
      const linha = { ...item, price: reais(precoCent), qty, subtotal: reais(subtotalItemCent) };
      itensCorrigidos.push(linha);
      subtotalCent += subtotalItemCent;

      const estoqueAtual = Number(p.stock) || 0;
      if (p.stockDeposit == null && p.stockSales == null) {
        p.stockDeposit = p.stockArea === 'venda' ? 0 : estoqueAtual;
        p.stockSales = p.stockArea === 'venda' ? estoqueAtual : 0;
      }
      const novo = arred2(estoqueAtual - qty);
      let aBaixar = qty;
      const noSalao = Math.max(0, Number(p.stockSales) || 0);
      const baixaSalao = Math.min(noSalao, aBaixar);
      if (p.stockSales != null) p.stockSales = arred2(noSalao - baixaSalao);
      aBaixar = arred2(aBaixar - baixaSalao);
      if (p.stockDeposit != null) p.stockDeposit = arred2((Number(p.stockDeposit) || 0) - aBaixar);
      p.stock = novo;
      if (novo < -1e-9) {
        divergentes.push({ id: p.id, name: p.name, stock: novo, vendido: qty });
        p.divergencia = true;
      } else {
        /* Sempre normaliza para booleano. Antes, um produto que nunca ficou
           negativo mantinha o campo ausente do JSON, e a tela de estoque
           comparava contra false sem nunca ver o campo. */
        p.divergencia = false;
      }
      /* `interno: true`: e a venda que produz o estoque negativo quando o
       * caixa vendeu mais do que tinha (divergencia, conferida depois). A
       * validacao de cadastro em banco.mjs rejeitaria estoque negativo — e
       * aqui ele e o resultado legitimo da regra da casa, nao um erro. */
      gravar(db, 'produtos', p, { interno: true });
    }

    /* Desconto concede desconto: o total do servidor e o subtotal menos o que
     * o cliente declarou, nunca acima do subtotal nem acima do teto do perfil.
     * Sem o teto, um `discount` de 99999 zera a venda e o caixa entrega
     * mercadoria de graça — o preco unitario estar correto nao impede isso. */
    const tetoNum = opcoes.tetoDesconto == null ? Infinity : Number(opcoes.tetoDesconto);
    const tetoCent = Number.isFinite(tetoNum) ? Math.max(0, centavos(tetoNum)) : Infinity;
    const descontoCent = Math.min(Math.max(centavos(venda.discount), 0), subtotalCent, tetoCent);
    const totalCent = subtotalCent - descontoCent;

    /* ---- pagamento conferido contra o total do servidor ----
     *
     * O preco unitario ja vinha do servidor, mas os VALORES das formas de
     * pagamento ainda vinham do cliente — e sao eles que viram dinheiro: o
     * troco, o dinheiro esperado no gaveteiro, a entrada no financeiro e a
     * divida do cliente. Uma venda de R$ 100 com `payments: [{Dinheiro,
     * 0.01}]` era aceita: o total ficava 100, mas o caixa recebia 0,01 e o
     * gerencia via R$ 100 a menos no gaveteiro, sem nenhum rastro do motivo.
     * Aqui o servidor passa a conferir.
     *
     * A regra que sobra para o cliente e legitima: dividir o total em varias
     * formas (dinheiro + Pix, parcelado no cartao) e pagar em dinheiro a mais
     * para receber troco. Todo o resto e derivado aqui.
     */
    const pagamentosBrutos = Array.isArray(venda.payments) ? venda.payments : [];
    const pagamentos = [];
    let pagoTotalCent = 0;
    let pagoDinheiroCent = 0;
    let pagoNaoDinheiroCent = 0;
    for (const p of pagamentosBrutos) {
      if (!p || typeof p !== 'object') continue;
      const metodo = String(p.method || '').trim();
      if (!metodo) continue;
      const valor = Number(p.amount);
      if (!Number.isFinite(valor) || valor < 0) {
        throw entrada(`Valor invalido na forma de pagamento "${metodo}".`, 'pagamento_invalido');
      }
      const valorCent = centavos(valor);
      /* Só o dinheiro pode passar do total, porque é o único que gera troco.
       * Sem isso, `Crediário: 999999` numa venda de R$ 10 inflava a dívida
       * do cliente para R$ 999.999 — o limite de crédito virava ficção. */
      if (metodo !== 'Dinheiro' && valorCent > totalCent + FOLGA_CENT) {
        throw entrada(
          `"${metodo}" (R$ ${reais(valorCent).toFixed(2)}) maior que o total da venda (R$ ${reais(totalCent).toFixed(2)}).`,
          'pagamento_acima_do_total'
        );
      }
      pagamentos.push({ ...p, method: metodo, amount: reais(valorCent) });
      pagoTotalCent += valorCent;
      if (metodo === 'Dinheiro') pagoDinheiroCent += valorCent;
      else pagoNaoDinheiroCent += valorCent;
    }
    if (!pagamentos.length) {
      throw entrada('Informe a forma de pagamento da venda.', 'pagamento_ausente');
    }
    /* Somente o dinheiro pode exceder o saldo restante. Conferir cada forma
       isoladamente permitia, por exemplo, R$ 100 em dinheiro + R$ 100 em
       crediario numa venda de R$ 100, dobrando a divida do cliente. */
    if (pagoNaoDinheiroCent > totalCent) {
      throw entrada('Pagamentos que nao sejam dinheiro nao podem exceder o total da venda.', 'pagamento_acima_do_total');
    }
    if (pagoTotalCent + FOLGA_CENT < totalCent) {
      throw entrada(
        `Pagamento insuficiente: faltam R$ ${reais(totalCent - pagoTotalCent).toFixed(2)}.`,
        'pagamento_insuficiente'
      );
    }

    /* Troco é do servidor. Aceitar o `change` do cliente permitia declarar
     * troco de R$ 450 sobre R$ 500 recebidos numa venda de R$ 10 e baixar o
     * dinheiro esperado do gaveteiro em R$ 440 sem nenhum dinheiro real. */
    const trocoCent = Math.max(0, pagoDinheiroCent - (totalCent - pagoNaoDinheiroCent));

    /* Data e do servidor. Aceitar `date` do cliente permitia lancar uma venda
     * de hoje com data de 400 dias atrás (ou de amanhã), mexendo em todo
     * relatório e no fechamento de caixa sem que nada pedisse senha. */
    const agoraServidor = new Date().toISOString();

  const vendaCorrigida = {
    ...venda,
    items: itensCorrigidos,
    payments: pagamentos,
    subtotal: reais(subtotalCent),
    discount: reais(descontoCent),
    total: reais(totalCent),
    change: reais(trocoCent),
    date: agoraServidor,
    /* QUEM vendeu vem da sessao, nunca do corpo da requisicao. O `...venda`
     * acima traz tudo que o cliente mandou, inclusive `operatorId` -- e esse
     * campo e o que decide quem pode estornar a venda. Se aceite, um caixa
     * carimba `operatorId` do gerente e a venda passa a ser "dele": a
     * rastreabilidade de quem mexeu no dinheiro vira ficção, e o estorno sai
     * pela regra errada. O servidor tem a sessao na mao; o cliente nao tem
     * nada a dizer aqui. */
    ...(opcoes.operador
      ? {
          operatorId: opcoes.operador.id,
          operatorName: opcoes.operador.name,
        }
      : {}),
  };

    /* ---- cliente: divida e pontos somam sobre o valor do servidor ---- */
    if (vendaCorrigida.customerId) {
      const c = obter(db, 'clientes', vendaCorrigida.customerId);
      const creditoCent = somaCentavos(
        (vendaCorrigida.payments || []).filter((x) => x.method === 'Crediário').map((x) => x.amount)
      );
      if (c) {
        if (creditoCent > 0) {
          c.debt = reais(centavos(c.debt) + creditoCent);
          const cfg = opcoes.loyalty || {};
          if (cfg.enabled) {
            c.points = (Number(c.points) || 0) + Math.floor(reais(totalCent) * (Number(cfg.pointsPerReal) || 1));
          }
        }
        gravar(db, 'clientes', c);
      }
    }

    /* ---- a venda ----
     * O `seq` e atribuido AQUI, dentro da transacao, e nunca aceito do
     * cliente. Antes cada caixa numerava a sua com o proximoSeq que leu do
     * /api/base: dois caixas que vendem no mesmo instante leem o mesmo
     * numero, e a segunda gravacao morre no indice unico ux_venda_seq --
     * devolvendo o cliente ao balcao com a mercadoria ja entregue. Como o
     * BEGIN IMMEDIATE serializa a escrita, o MAX(seq) aqui e sempre o do
     * servidor e nunca o de uma leitura velha. */
    const seqServidor = proximoSeq(db);
    const gravada = {
      ...vendaCorrigida,
      seq: seqServidor,
      seqDoCliente: vendaCorrigida.seq == null ? null : vendaCorrigida.seq,
      divergencia: divergentes.length > 0,
      divergentes,
    };
    gravar(db, 'vendas', gravada);

    /* ---- lancamentos financeiros ---- */
    for (const p of vendaCorrigida.payments || []) {
      const base = {
        id: proximoLancamentoId(db),
        date: vendaCorrigida.date,
        source: vendaCorrigida.id,
        shiftId: vendaCorrigida.shiftId || null,
        customerId: vendaCorrigida.customerId || null
      };
      if (p.method === 'Crediário') {
        gravar(db, 'lancamentos', {
          ...base,
          type: 'A receber',
          category: 'Venda a prazo',
          description: `Venda #${vendaCorrigida.id} · ${vendaCorrigida.customerName || ''}`,
          amount: reais(centavos(p.amount)),
          method: 'Crediário',
          settled: false,
        });
      } else {
        const recebidoCent = centavos(p.amount) - (p.method === 'Dinheiro' ? trocoCent : 0);
        if (recebidoCent > 0) {
          gravar(db, 'lancamentos', {
            ...base,
            type: 'Entrada',
            category: 'Venda PDV',
            description: `Venda #${vendaCorrigida.id}`,
            amount: reais(recebidoCent),
            method: p.method,
            /* Nada foi baixado ainda: uma venda recem-registrada nao esta
             * "liquidada". Marcar a entrada de dinheiro como settled na criacao
             * fazia o estorno pular exatamente essa linha (`if (lan.settled)
             * continue`) — o venda voltava o estoque e tirava o dinheiro
             * esperado do gaveteiro, mas a entrada de R$ X continuava no
             * financeiro. O caixa fechava com R$ X a menos do que o relatorio
             * dizia. `settled` e para o que ja foi conferido no fechamento. */
            settled: false,
          });
        }
      }
    }

    /* ---- turno: soma o dinheiro esperado no caixa ---- */
    if (vendaCorrigida.shiftId) {
      const t = obter(db, 'turnos', vendaCorrigida.shiftId);
      if (t) {
        const entrandoCent = somaCentavos(
          (vendaCorrigida.payments || []).filter((p) => p.method === 'Dinheiro').map((p) => p.amount)
        ) - trocoCent;
        t.cashExpected = reais(centavos(t.cashExpected) + entrandoCent);
        t.sales = (t.sales || []).concat([vendaCorrigida.id]);
        gravar(db, 'turnos', t);
      }
    }

    db.exec('COMMIT');
    return { venda: gravada, divergentes };
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    throw e;
  }
}

export function proximoSeq(db) {
  const r = db.prepare('SELECT COALESCE(MAX(seq), 1000) + 1 AS seq FROM vendas').get();
  return r.seq;
}

/* ---------------- estorno ----------------
 *
 * O estorno e o inverso exato de registrarVenda, e precisa rodar na MESMA
 * transacao. Sem ele aqui, o estorno feito no PDV devolvia o estoque apenas
 * no caixa que fez a venda: os outros 4 continuavam vendo a mercadoria como
 * disponivel e podiam vender o que ja estava devolvido. Pior, a proxima
 * puxada sobrescrevia o estorno local e ele sumia do historico.
 *
 * Idempotente por vendaId: estornar duas vezes nao devolve o estoque duas
 * vezes (o `status` da venda gravada e a trava).
 */
export function estornarVenda(db, vendaId, motivo, opcoes = {}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const l = db.prepare('SELECT json FROM vendas WHERE id = ?').get(String(vendaId));
    if (!l) {
      throw Object.assign(new Error('Venda nao encontrada no servidor.'), { status: 404 });
    }
    const venda = JSON.parse(l.json);

    if (venda.status === 'Estornada') {
      db.exec('COMMIT');
      return { venda, repetida: true };
    }

    /* ---- devolve o estoque ---- */
    for (const item of venda.items || []) {
      const p = obter(db, 'produtos', item.id);
      if (!p) continue; // produto deletado no caminho: nada a devolver
      p.stock = arred2((Number(p.stock) || 0) + (Number(item.qty) || 0));
      p.divergencia = p.stock < -1e-9;
      gravar(db, 'produtos', p, { interno: true });
    }

    /* ---- baixa a divida do cliente ---- */
    const creditoCent = somaCentavos(
      (venda.payments || []).filter((p) => p.method === 'Crediário').map((p) => p.amount)
    );
    if (venda.customerId && creditoCent > 0) {
      const c = obter(db, 'clientes', venda.customerId);
      if (c) {
        c.debt = reais(Math.max(0, centavos(c.debt) - creditoCent));
        gravar(db, 'clientes', c);
      }
    }

    /* ---- estorna os lancamentos da venda ---- */
    const lancamentos = bancoObterPorFonte(db, vendaId);
    for (const lan of lancamentos) {
      if (lan.settled) continue; // ja foi baixa no caixa: mexer aqui desalinharia
      db.prepare('DELETE FROM lancamentos WHERE id = ?').run(lan.id);
    }

    /* ---- tira do turno e do dinheiro esperado ---- */
    let devolvidoCent = 0;
    for (const p of venda.payments || []) {
      if (p.method === 'Dinheiro') {
        devolvidoCent += centavos(p.amount) - centavos(venda.change);
      }
    }
    if (venda.shiftId) {
      const t = obter(db, 'turnos', venda.shiftId);
      if (t) {
        t.cashExpected = reais(centavos(t.cashExpected) - devolvidoCent);
        t.sales = (t.sales || []).filter((x) => x !== vendaId);
        gravar(db, 'turnos', t);
      }
    }

    /* ---- marca a venda ---- */
    /* Quem estornou fica gravado na venda. Antes so o motivo (texto livre) e o
     * horario diziam o que aconteceu; num extravio de dinheiro no fim do dia,
     * "nao sei, foi o Pedro" e tudo que o registro tinha a oferecer. */
    const autor = opcoes.por && opcoes.por.username ? opcoes.por.username : 'desconhecido';
    const estornada = {
      ...venda,
      status: 'Estornada',
      refundReason: motivo || 'sem motivo informado',
      refundBy: autor,
      voidedAt: new Date().toISOString(),
    };
    gravar(db, 'vendas', estornada);

    db.exec('COMMIT');
    return { venda: estornada, repetida: false, devolvido: reais(devolvidoCent) };
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    throw e;
  }
}

function bancoObterPorFonte(db, fonte) {
  return db
    .prepare('SELECT json FROM lancamentos WHERE source = ?')
    .all(String(fonte))
    .map((r) => JSON.parse(r.json));
}
