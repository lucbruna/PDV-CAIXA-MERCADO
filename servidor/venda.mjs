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
    /* ---- estoque ---- */
    for (const item of itens) {
      const p = obter(db, 'produtos', item.id);
      if (!p) {
        throw Object.assign(
          new Error(`Produto "${item.name || item.id}" nao existe mais no servidor.`),
          { status: 409, codigo: 'produto_inexistente' }
        );
      }
      const novo = arred2((Number(p.stock) || 0) - (Number(item.qty) || 0));
      p.stock = novo;
      if (novo < -1e-9) {
        /* Cliente ja levou a mercadoria: a venda segue, mas fica sinalizada. */
        divergentes.push({ id: p.id, name: p.name, stock: novo, vendido: Number(item.qty) || 0 });
        p.divergencia = true;
      } else if (p.divergencia && novo >= 0) {
        p.divergencia = false;
      }
      gravar(db, 'produtos', p);
    }

    /* ---- cliente: divida e pontos somam sobre o valor do servidor ---- */
    if (venda.customerId) {
      const c = obter(db, 'clientes', venda.customerId);
      const credito = (venda.payments || [])
        .filter((x) => x.method === 'Crediário')
        .reduce((a, x) => a + (Number(x.amount) || 0), 0);
      if (c) {
        if (credito > 0) {
          c.debt = arred2((Number(c.debt) || 0) + credito);
          const cfg = opcoes.loyalty || {};
          if (cfg.enabled) {
            c.points = (Number(c.points) || 0) + Math.floor((Number(venda.total) || 0) * (Number(cfg.pointsPerReal) || 1));
          }
        }
        gravar(db, 'clientes', c);
      }
    }

    /* ---- a venda ---- */
    const gravada = { ...venda, divergencia: divergentes.length > 0, divergentes };
    gravar(db, 'vendas', gravada);

    /* ---- lancamentos financeiros ---- */
    const troco = Number(venda.change) || 0;
    for (const p of venda.payments || []) {
      const base = {
        id: proximoLancamentoId(db),
        date: venda.date,
        source: venda.id,
        shiftId: venda.shiftId || null,
        customerId: venda.customerId || null
      };
      if (p.method === 'Crediário') {
        gravar(db, 'lancamentos', {
          ...base,
          type: 'A receber',
          category: 'Venda a prazo',
          description: `Venda #${venda.id} · ${venda.customerName || ''}`,
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
            description: `Venda #${venda.id}`,
            amount: recebido,
            method: p.method,
            settled: p.method === 'Dinheiro',
          });
        }
      }
    }

    /* ---- turno: soma o dinheiro esperado no caixa ---- */
    if (venda.shiftId) {
      const t = obter(db, 'turnos', venda.shiftId);
      if (t) {
        const entrando = (venda.payments || [])
          .filter((p) => p.method === 'Dinheiro')
          .reduce((a, p) => a + (Number(p.amount) || 0), 0) - troco;
        t.cashExpected = arred2((Number(t.cashExpected) || 0) + entrando);
        t.sales = (t.sales || []).concat([venda.id]);
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
