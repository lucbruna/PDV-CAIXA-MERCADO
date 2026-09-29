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

function arred2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

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
    let subtotalServidor = 0;
    for (const item of itens) {
      const p = obter(db, 'produtos', item.id);
      if (!p) {
        throw Object.assign(
          new Error(`Produto "${item.name || item.id}" nao existe mais no servidor.`),
          { status: 409, codigo: 'produto_inexistente' }
        );
      }
      const qty = Number(item.qty) || 0;
      const preco = Number(p.price) || 0;
      const linha = { ...item, price: preco, qty, subtotal: arred2(preco * qty) };
      itensCorrigidos.push(linha);
      subtotalServidor = arred2(subtotalServidor + linha.subtotal);

      const novo = arred2((Number(p.stock) || 0) - qty);
      p.stock = novo;
      if (novo < -1e-9) {
        /* Cliente ja levou a mercadoria: a venda segue, mas fica sinalizada. */
        divergentes.push({ id: p.id, name: p.name, stock: novo, vendido: qty });
        p.divergencia = true;
      } else {
        /* Sempre normaliza para booleano. Antes, um produto que nunca ficou
           negativo mantinha o campo ausente do JSON, e a tela de estoque
           comparava contra false sem nunca ver o campo. */
        p.divergencia = false;
      }
      gravar(db, 'produtos', p);
    }

    /* Desconto concede desconto: o total do servidor e o subtotal menos o que
     * o cliente declarou, nunca acima do subtotal nem acima do teto do perfil.
     * Sem o teto, um `discount` de 99999 zera a venda e o caixa entrega
     * mercadoria de graça — o preco unitario estar correto nao impede isso. */
    const tetoDesconto = opcoes.tetoDesconto == null ? Infinity : Math.max(0, Number(opcoes.tetoDesconto) || 0);
    const desconto = Math.min(
      Math.max(Number(venda.discount) || 0, 0),
      subtotalServidor,
      tetoDesconto
    );
    const total = arred2(subtotalServidor - desconto);
    const vendaCorrigida = {
      ...venda,
      items: itensCorrigidos,
      subtotal: subtotalServidor,
      discount: desconto,
      total,
    };

    /* ---- cliente: divida e pontos somam sobre o valor do servidor ---- */
    if (vendaCorrigida.customerId) {
      const c = obter(db, 'clientes', vendaCorrigida.customerId);
      const credito = (vendaCorrigida.payments || [])
        .filter((x) => x.method === 'Crediário')
        .reduce((a, x) => a + (Number(x.amount) || 0), 0);
      if (c) {
        if (credito > 0) {
          c.debt = arred2((Number(c.debt) || 0) + credito);
          const cfg = opcoes.loyalty || {};
          if (cfg.enabled) {
            c.points = (Number(c.points) || 0) + Math.floor((Number(vendaCorrigida.total) || 0) * (Number(cfg.pointsPerReal) || 1));
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
    const troco = Number(vendaCorrigida.change) || 0;
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
          amount: arred2(p.amount),
          method: 'Crediário',
          settled: false,
        });
      } else {
        const recebido = arred2(p.amount - (p.method === 'Dinheiro' ? troco : 0));
        if (recebido > 0) {
          gravar(db, 'lancamentos', {
            ...base,
            type: 'Entrada',
            category: 'Venda PDV',
            description: `Venda #${vendaCorrigida.id}`,
            amount: recebido,
            method: p.method,
            settled: p.method === 'Dinheiro',
          });
        }
      }
    }

    /* ---- turno: soma o dinheiro esperado no caixa ---- */
    if (vendaCorrigida.shiftId) {
      const t = obter(db, 'turnos', vendaCorrigida.shiftId);
      if (t) {
        const entrando = (vendaCorrigida.payments || [])
          .filter((p) => p.method === 'Dinheiro')
          .reduce((a, p) => a + (Number(p.amount) || 0), 0) - troco;
        t.cashExpected = arred2((Number(t.cashExpected) || 0) + entrando);
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
export function estornarVenda(db, vendaId, motivo) {
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
      gravar(db, 'produtos', p);
    }

    /* ---- baixa a divida do cliente ---- */
    const credito = (venda.payments || [])
      .filter((p) => p.method === 'Crediário')
      .reduce((a, p) => a + (Number(p.amount) || 0), 0);
    if (venda.customerId && credito > 0) {
      const c = obter(db, 'clientes', venda.customerId);
      if (c) {
        c.debt = arred2(Math.max(0, (Number(c.debt) || 0) - credito));
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
    let devolvido = 0;
    for (const p of venda.payments || []) {
      if (p.method === 'Dinheiro') {
        devolvido = arred2(devolvido + (Number(p.amount) || 0) - (Number(venda.change) || 0));
      }
    }
    if (venda.shiftId) {
      const t = obter(db, 'turnos', venda.shiftId);
      if (t) {
        t.cashExpected = arred2((Number(t.cashExpected) || 0) - devolvido);
        t.sales = (t.sales || []).filter((x) => x !== vendaId);
        gravar(db, 'turnos', t);
      }
    }

    /* ---- marca a venda ---- */
    const estornada = {
      ...venda,
      status: 'Estornada',
      refundReason: motivo || 'sem motivo informado',
      voidedAt: new Date().toISOString(),
    };
    gravar(db, 'vendas', estornada);

    db.exec('COMMIT');
    return { venda: estornada, repetida: false, devolvido };
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
