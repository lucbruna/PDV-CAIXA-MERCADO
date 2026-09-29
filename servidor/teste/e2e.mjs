/* Teste ponta a ponta do servidor, por HTTP, contra um banco descartavel.
   Cobre: bootstrap da migracao, login com senha scrypt, bloqueio de sessao
   ausente, gravacao de produto/cliente, venda em transacao (com preco do
   servidor), divergencia de estoque, idempotencia e total adulterado. */
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { scryptSync, randomBytes } from 'node:crypto';

const W = process.argv[2];
const PORTA = 8795;
const BASE = `http://127.0.0.1:${PORTA}`;
const DB = join(W, 'e2e.db');

for (const s of ['', '-wal', '-shm']) { try { rmSync(DB + s); } catch {} }

const srv = spawn(process.execPath, ['servidor.mjs'], {
  cwd: process.argv[3],
  env: { ...process.env, SUDAM_DB: DB, SUDAM_PORTA: String(PORTA) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stdout.on('data', () => {});
srv.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));

await new Promise((r) => setTimeout(r, 1500));

let ok = 0, fail = 0;
function check(nome, cond, extra = '') {
  if (cond) { ok++; console.log('  PASS  ' + nome); }
  else { fail++; console.log('  FAIL  ' + nome + (extra ? ' :: ' + extra : '')); }
}

async function req(metodo, caminho, corpo, token) {
  const headers = {};
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(BASE + caminho, {
    method: metodo,
    headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  let dados = null;
  try { dados = await r.json(); } catch {}
  return { status: r.status, dados };
}

try {
  console.log('\n1. Bootstrap e migracao');
  const m = await req('POST', '/api/migrar', {
    products: [
      { id: 'p1', code: '111', name: 'Agua', price: 2.5, cost: 1, stock: 10 },
      { id: 'p2', code: '222', name: 'Coca', price: 9.9, cost: 6, stock: 2 },
    ],
    customers: [{ id: 'c1', name: 'Joao', debt: 0, points: 0 }],
    auth: { users: [
      { id: 'u1', name: 'Admin', username: 'admin', passHash: 'legado', role: 'admin', active: true },
    ] },
    config: { storeName: 'E2E' },
  });
  check('migracao responde 200', m.status === 200, JSON.stringify(m.dados));
  check('migracao contou 2 produtos', m.dados?.contagem?.produtos === 2);
  // precisa de token: /api/produtos exige sessao (a contagem acima vem do
  // bootstrap, que e a unica escrita liberada sem login).
  check('gravou produto (le de volta)', (await req('GET', '/api/produtos?busca=Agua')).status === 401);

  console.log('\n2. Migracao fecha depois do primeiro usuario');
  check('2a migracao sem token -> 401', (await req('POST', '/api/migrar', {})).status === 401);

  console.log('\n3. Senha');
  check('senha errada -> 401', (await req('POST', '/api/login', { usuario: 'admin', senha: 'nao-e-1234' })).status === 401);
  check('hash legado nao autentica', (await req('POST', '/api/login', { usuario: 'admin', senha: 'legado' })).status === 401);

  // o legado so passa com a senha em texto puro que o FNV representa
  const sal = randomBytes(16).toString('hex');
  const hash = scryptSync('1234', sal, 64, { N: 16384 }).toString('hex');
  const bd = new DatabaseSync(DB);
  const u = JSON.parse(bd.prepare('SELECT json FROM usuarios WHERE id=?').get('u1').json);
  u.sal = sal; u.senhaHash = hash; delete u.passHash;
  bd.prepare('UPDATE usuarios SET json=? WHERE id=?').run(JSON.stringify(u), 'u1');
  bd.close();

  const login = await req('POST', '/api/login', { usuario: 'admin', senha: '1234' });
  check('login scrypt -> 200', login.status === 200, JSON.stringify(login.dados));
  const token = login.dados?.token;
  check('login devolve token', typeof token === 'string' && token.length === 64);
  check('login nao devolve senhaHash', login.dados?.usuario && login.dados.usuario.senhaHash === undefined);
  check('login nao devolve sal', login.dados?.usuario && login.dados.usuario.sal === undefined);
  check('login nao devolve passHash legado', login.dados?.usuario && login.dados.usuario.passHash === undefined);

  console.log('\n4. Sessao obrigatoria');
  for (const ep of ['/api/base', '/api/produtos', '/api/customers', '/api/entries', '/api/config', '/api/vendas']) {
    check('sem token ' + ep + ' -> 401', (await req('GET', ep)).status === 401);
  }
  check('token invalido -> 401', (await req('GET', '/api/base', undefined, 'x'.repeat(64))).status === 401);
  check('com token /api/base -> 200', (await req('GET', '/api/base', undefined, token)).status === 200);
  check('token nao vaza em usuario', (await req('GET', '/api/base', undefined, token)).dados?.usuarios?.[0]?.senhaHash === undefined);

  console.log('\n5. Gravacao de produto e cliente (a rota quebrada)');
  const gp = await req('POST', '/api/produtos', { lista: [{ id: 'p9', code: '999', name: 'Biscoito', price: 3, stock: 7 }] }, token);
  check('POST /api/produtos 200', gp.status === 200, JSON.stringify(gp.dados));
  check('POST /api/produtos gravou 1', gp.dados?.gravados === 1);
  check('produto relido', (await req('GET', '/api/produtos?busca=Biscoito', undefined, token)).dados?.produtos?.[0]?.price === 3);
  const gc = await req('POST', '/api/clientes', { lista: [{ id: 'c9', name: 'Maria', debt: 0 }] }, token);
  check('POST /api/clientes 200', gc.status === 200, JSON.stringify(gc.dados));

  console.log('\n6. Venda em transacao');
  const v = await req('POST', '/api/venda', {
    id: 'v1', seq: 1001, date: '2026-09-29T12:00:00.000Z',
    items: [{ id: 'p1', name: 'Agua', qty: 2, price: 2.5 }],
    total: 5, change: 0, payments: [{ method: 'Dinheiro', amount: 5 }],
    customerId: 'c1',
  }, token);
  check('venda 200', v.status === 200, JSON.stringify(v.dados));
  const estoque = (await req('GET', '/api/produtos?busca=Agua', undefined, token)).dados?.produtos?.[0]?.stock;
  check('estoque baixou 10 -> 8', estoque === 8, 'estoque=' + estoque);
  check('sem divergencia', (await req('GET', '/api/produtos?busca=Agua', undefined, token)).dados?.produtos?.[0]?.divergencia === false);
  const cl = (await req('GET', '/api/base', undefined, token)).dados?.clientes?.find((c) => c.id === 'c1');
  check('divida nao subiu em venda a vista', cl?.debt === 0, 'debt=' + cl?.debt);

  console.log('\n7. Preco vem do servidor, nao do corpo');
  /* O corpo mente sobre o preco (0.01 em vez de 2.5) mas PAGA o valor que o
   * servidor vai cobrar. A mentira no preco e absorvida — o total sai 2.5.
   * (Esta versao pagava 0.01 e ainda esperava 200: o servidor aceitava uma
   * venda de R$ 2,50 receivebendo R$ 0,01, e o troco/gaveteiro/financeiro
   * ficavam com o valor do corpo. Ver o bloco 7b.) */
  const ad = await req('POST', '/api/venda', {
    id: 'v2', seq: 1002, date: '2026-09-29T12:05:00.000Z',
    items: [{ id: 'p1', name: 'Agua', qty: 1, price: 0.01 }],
    total: 0.01, change: 0, payments: [{ method: 'Dinheiro', amount: 2.5 }],
  }, token);
  check('venda adulterada aceita como venda normal', ad.status === 200, JSON.stringify(ad.dados));
  check('total recalculado pelo servidor (2.5)', ad.dados?.venda?.total === 2.5, 'total=' + ad.dados?.venda?.total);
  check('preco do item reescrito (2.5)', ad.dados?.venda?.items?.[0]?.price === 2.5);
  check('troco recalculado pelo servidor (0)', ad.dados?.venda?.change === 0, 'troco=' + ad.dados?.venda?.change);

  console.log('\n7b. Pagamento conferido contra o total (dinheiro real)');
  /* A lacuna que a versao anterior nao pegava: o preco do item ja era do
   * servidor, mas o VALOR PAGO ainda vinha do corpo. Uma venda de R$ 100
   * com `payments: [{Dinheiro, 0.01}]` era aceita e o gaveteiro, o
   * financeiro e o troco registravam 0,01. */
  const sub = await req('POST', '/api/venda', {
    id: 'v2b', items: [{ id: 'p2', name: 'Coca', qty: 10 }],
    payments: [{ method: 'Dinheiro', amount: 0.01 }], change: 0,
  }, token);
  check('pagamento insuficiente -> 400', sub.status === 400, 'status=' + sub.status);
  check('  motivo nomeado', sub.dados?.codigo === 'pagamento_insuficiente', JSON.stringify(sub.dados));
  check('  estoque nao foi tocado',
    (await req('GET', '/api/produtos?busca=Coca', undefined, token)).dados?.produtos?.[0]?.stock === 2,
    'stock=' + (await req('GET', '/api/produtos?busca=Coca', undefined, token)).dados?.produtos?.[0]?.stock);

  const cred = await req('POST', '/api/venda', {
    id: 'v2c', items: [{ id: 'p2', name: 'Coca', qty: 1 }],
    customerId: 'c1', payments: [{ method: 'Crediário', amount: 999999 }], change: 0,
  }, token);
  check('crediario acima do total -> 400', cred.status === 400, 'status=' + cred.status);
  check('  divida do cliente intacta',
    (await req('GET', '/api/base', undefined, token)).dados?.clientes?.find((c) => c.id === 'c1')?.debt === 0);

  const semPg = await req('POST', '/api/venda', {
    id: 'v2d', items: [{ id: 'p2', name: 'Coca', qty: 1 }], payments: [], change: 0,
  }, token);
  check('venda sem pagamento -> 400', semPg.status === 400, 'status=' + semPg.status);

  const qtyNeg = await req('POST', '/api/venda', {
    id: 'v2e', items: [{ id: 'p2', name: 'Coca', qty: -50 }],
    payments: [{ method: 'Dinheiro', amount: 0 }], change: 0,
  }, token);
  check('quantidade negativa -> 400', qtyNeg.status === 400, 'status=' + qtyNeg.status);
  check('  estoque nao aumentou com qty negativa',
    (await req('GET', '/api/produtos?busca=Coca', undefined, token)).dados?.produtos?.[0]?.stock === 2,
    'stock=' + (await req('GET', '/api/produtos?busca=Coca', undefined, token)).dados?.produtos?.[0]?.stock);

  /* Troco dinheiro a mais e legitimo (nota grande); o troco e sempre do
   * servidor e nunca pode ser maior que o dinheiro recebido. */
  const trocoOk = await req('POST', '/api/venda', {
    id: 'v2f', items: [{ id: 'p2', name: 'Coca', qty: 1 }],
    payments: [{ method: 'Dinheiro', amount: 100 }], change: 999999,
  }, token);
  check('troco do cliente e ignorado, recalculado (90.10)', trocoOk.dados?.venda?.change === 90.1,
    'troco=' + trocoOk.dados?.venda?.change);

  console.log('\n7c. Data da venda e do servidor');
  const back = await req('POST', '/api/venda', {
    id: 'v2g', date: '2020-01-01T00:00:00.000Z', items: [{ id: 'p2', name: 'Coca', qty: 1 }],
    payments: [{ method: 'Dinheiro', amount: 9.9 }],
  }, token);
  check('data antiga do cliente e descartada',
    back.dados?.venda?.date !== '2020-01-01T00:00:00.000Z', 'date=' + back.dados?.venda?.date);

  console.log('\n8. Divergencia de estoque');
  const ov = await req('POST', '/api/venda', {
    id: 'v3', seq: 1003, date: '2026-09-29T12:06:00.000Z',
    items: [{ id: 'p2', name: 'Coca', qty: 999, price: 9.9 }],
    total: 9890.1, change: 0, payments: [{ method: 'Dinheiro', amount: 9890.1 }],
  }, token);
  check('oversell nao e recusado (regra da casa)', ov.status === 200, JSON.stringify(ov.dados));
  check('marcou divergente', ov.dados?.venda?.divergencia === true);
  check('lista divergentes', ov.dados?.divergentes?.length === 1);
  const coca = (await req('GET', '/api/produtos?busca=Coca', undefined, token)).dados?.produtos?.[0];
  check('estoque ficou negativo', coca?.stock < 0, 'stock=' + coca?.stock);
  check('divergencia persistida na coluna', coca?.divergencia === true, 'coluna=' + coca?.divergencia);

  console.log('\n9. Idempotencia');
  const rep = await req('POST', '/api/venda', {
    id: 'v1', seq: 1001, date: '2026-09-29T12:00:00.000Z',
    items: [{ id: 'p1', name: 'Agua', qty: 2, price: 2.5 }],
    total: 5, change: 0, payments: [{ method: 'Dinheiro', amount: 5 }],
  }, token);
  check('reenvio marcado como repetida', rep.dados?.repetida === true);
  const estoqueDepois = (await req('GET', '/api/produtos?busca=Agua', undefined, token)).dados?.produtos?.[0]?.stock;
  // 10 - 2 (v1) - 1 (v2) = 7. O reenvio de v1 nao pode baixar de novo.
  check('estoque NAO baixou de novo', estoqueDepois === 7, 'estoque=' + estoqueDepois);

  console.log('\n10. Produto inexistente');
  const px = await req('POST', '/api/venda', {
    id: 'vX', seq: 1009, date: '2026-09-29T12:07:00.000Z',
    items: [{ id: 'nao-existe', name: 'Fantasma', qty: 1, price: 1 }],
    total: 1, change: 0, payments: [{ method: 'Dinheiro', amount: 1 }],
  }, token);
  check('produto inexistente -> 409', px.status === 409, JSON.stringify(px.dados));

  console.log('\n11. Collections genericas');
  check('GET /api/entries', (await req('GET', '/api/entries', undefined, token)).status === 200);
  const le = await req('POST', '/api/entries', { lista: [{ id: 'L900', date: '2026-09-29', type: 'Entrada', amount: 10, settled: false }] }, token);
  check('POST /api/entries 200', le.status === 200, JSON.stringify(le.dados));
  check('lancamento relido', (await req('GET', '/api/entries', undefined, token)).dados?.entries?.some((e) => e.id === 'L900'));
  const cf = await req('POST', '/api/config', { config: { storeName: 'E2E Editado' } }, token);
  check('POST /api/config 200', cf.status === 200);
  check('config persistiu', (await req('GET', '/api/config', undefined, token)).dados?.config?.storeName === 'E2E Editado');

  console.log('\n12. Estatico nao expoe banco');
  for (const p of ['/servidor/dados/e2e.db', '/servidor/banco.mjs', '/.git/config', '/servidor/dados/backup/']) {
    const r = await fetch(BASE + p);
    check('bloqueado ' + p, r.status === 403 || r.status === 404, 'status=' + r.status);
  }
  check('index.html servido', (await fetch(BASE + '/')).status === 200);
  const h = (await fetch(BASE + '/')).headers;
  check('CSP presente', !!h.get('content-security-policy'));

  console.log('\n13. seq e do servidor (5 caixas ao mesmo tempo)');
  /* O teste que faltava no papel: 5 caixas leem o mesmo proximoSeq e
     vendem no mesmo instante. Com o seq do cliente, a 2a gravacao morria
     no indice unico e a venda nao existia. */
  const base5 = await req('GET', '/api/base', undefined, token);
  const seqLido = base5.dados.proximoSeq;
  const paralelo = await Promise.all([1, 2, 3, 4, 5].map(function (n) {
    return req('POST', '/api/venda', {
      id: 'conc' + n, seq: seqLido, // todos mandam o MESMO seq, de proposito
      date: '2026-09-29T13:00:0' + n + '.000Z',
      items: [{ id: 'p9', name: 'Biscoito', qty: 1, price: 3 }],
      total: 3, change: 0, payments: [{ method: 'Dinheiro', amount: 3 }],
    }, token);
  }));
  check('as 5 vendas foram aceitas', paralelo.every((r) => r.status === 200),
    paralelo.map((r) => r.status).join(','));
  const seqs = paralelo.map((r) => r.dados && r.dados.venda && r.dados.venda.seq).sort((a, b) => a - b);
  check('seqs sao 5 numeros distintos', new Set(seqs).size === 5, 'seqs=' + JSON.stringify(seqs));
  check('seqs sao consecutivos', seqs.every((s, i) => i === 0 || s === seqs[i - 1] + 1), 'seqs=' + JSON.stringify(seqs));
  check('cliente nao dita o seq', paralelo.every((r) => r.dados.venda.seqDoCliente === seqLido),
    'o corpo mandava ' + seqLido);

  console.log('\n14. Teto de desconto por perfil');
  const dsc = await req('POST', '/api/venda', {
    id: 'desc1', date: '2026-09-29T13:10:00.000Z',
    items: [{ id: 'p9', name: 'Biscoito', qty: 1, price: 3 }],
    total: 3, discount: 99999, change: 0,
    payments: [{ method: 'Dinheiro', amount: 3 }],
  }, token);
  // admin nao tem teto, entao o desconto e limitado so pelo subtotal
  check('admin: desconto limitado ao subtotal', dsc.dados?.venda?.total === 0, 'total=' + dsc.dados?.venda?.total);
  check('admin: desconto nao passou do subtotal', dsc.dados?.venda?.discount === 3, 'desconto=' + dsc.dados?.venda?.discount);

  console.log('\n15. Estorno no servidor');
  /* Precisa rodar com a sessao viva: o logout e o rate limit vem DEPOIS. */
  const antesEst = (await req('GET', '/api/produtos?busca=Biscoito', undefined, token)).dados?.produtos?.[0]?.stock;
  const vE = await req('POST', '/api/venda', {
    id: 'est1', date: '2026-09-29T14:00:00.000Z',
    items: [{ id: 'p9', name: 'Biscoito', qty: 4, price: 3 }],
    total: 12, change: 0, payments: [{ method: 'Dinheiro', amount: 12 }],
    customerId: 'c1',
  }, token);
  check('venda para estornar registrada', vE.status === 200);
  const meio = (await req('GET', '/api/produtos?busca=Biscoito', undefined, token)).dados?.produtos?.[0]?.stock;
  check('estoque baixou 4', meio === antesEst - 4, 'antes=' + antesEst + ' meio=' + meio);

  const semMotivo = await req('POST', '/api/venda/estornar', { id: 'est1' }, token);
  check('estorno sem motivo -> 400', semMotivo.status === 400, JSON.stringify(semMotivo.dados));

  const est = await req('POST', '/api/venda/estornar', { id: 'est1', motivo: 'produto devolvido' }, token);
  check('estorno aceito', est.status === 200, JSON.stringify(est.dados));
  check('venda marcada como Estornada', est.dados?.venda?.status === 'Estornada');
  const depois = (await req('GET', '/api/produtos?busca=Biscoito', undefined, token)).dados?.produtos?.[0]?.stock;
  check('estoque voltou ao original', depois === antesEst, 'antes=' + antesEst + ' depois=' + depois);

  const est2 = await req('POST', '/api/venda/estornar', { id: 'est1', motivo: 'de novo' }, token);
  check('estorno repetido e idempotente', est2.dados?.repetida === true);
  const depois2 = (await req('GET', '/api/produtos?busca=Biscoito', undefined, token)).dados?.produtos?.[0]?.stock;
  check('estoque NAO voltou duas vezes', depois2 === antesEst, 'depois=' + depois2);

  const estInsum = await req('POST', '/api/venda/estornar', { id: 'inexistente99', motivo: 'x' }, token);
  check('estorno de venda inexistente -> 404', estInsum.status === 404, JSON.stringify(estInsum.dados));

  console.log('\n16. Sessao deslizante');
  /* A janela deslizante e o que impede o caixa de ver a sessao morrer no
     meio do expediente. Sem ela, 12 h apos o login a proxima venda cai em
     401 e vai para a fila -- numa venda que ja estava fechada na tela. */
  /* Precisa de uma conexao propria: o servidor tem a sua, e o WAL nao
     aparece para quem nao fez write lock. Abrir de novo e o caminho curto. */
  const dbSess = new DatabaseSync(DB);
  const expiraAntes = dbSess.prepare('SELECT expiraEm FROM sessoes WHERE token=?').get(token).expiraEm;

  // Token prestes a vencer (60 s): ainda vale, e a requisicao tem de empurrar
  // o vencimento para 12 h. E o que segura o caixa o expediente inteiro.
  dbSess.prepare('UPDATE sessoes SET expiraEm=? WHERE token=?')
    .run(new Date(Date.now() + 60_000).toISOString(), token);
  const aindaVivo = await req('GET', '/api/sessao', undefined, token);
  check('token prestes a vencer ainda vale', aindaVivo.status === 200, 'status=' + aindaVivo.status);
  const expiraDepois = dbSess.prepare('SELECT expiraEm FROM sessoes WHERE token=?').get(token).expiraEm;
  check('requisicao renovou a sessao', new Date(expiraDepois) > new Date(expiraAntes),
    'antes=' + expiraAntes + ' depois=' + expiraDepois);
  check('renovou para 12 h a frente', new Date(expiraDepois).getTime() > Date.now() + 11 * 3600 * 1000,
    'expira=' + expiraDepois);

  // E o inverso: token REALMENTE vencido tem de morrer, nao ser ressuscitado
  // pela renovacao. Se voltasse, um token de 3 dias atras voltaria a valer.
  const tokenMorto = 'deadbeef' + '0'.repeat(56);
  dbSess.prepare('INSERT INTO sessoes (token, usuario, criadoEm, expiraEm) VALUES (?,?,?,?)')
    .run(tokenMorto, 'admin', new Date(Date.now() - 86400_000).toISOString(),
         new Date(Date.now() - 3600_000).toISOString());
  const reviving = await req('GET', '/api/sessao', undefined, tokenMorto);
  check('token vencido nao e resuscitado', reviving.status === 401, 'status=' + reviving.status);
  dbSess.close();
  const sess = await req('GET', '/api/sessao', undefined, token);
  check('/api/sessao devolve o usuario', sess.dados?.usuario?.username === 'admin', JSON.stringify(sess.dados));
  check('/api/sessao nao vaza hash', !JSON.stringify(sess.dados || {}).includes('senhaHash'));

  console.log('\n17. Estorno reverte o financeiro (a entrada que sobrava)');
  /* A entrada de dinheiro era gravada com `settled: true` no ato da venda, e o
   * estorno pula o que esta `settled`. Resultado: o estoque voltava e o
   * dinheiro saia do gaveteiro esperado, mas a "Entrada" de R$ X continuava
   * no financeiro — o relatorio e a conferencia cebra discordavam do total. */
  await req('POST', '/api/caixa/abrir', { id: 'TR', opening: 0 }, token);
  const vd = await req('POST', '/api/venda', {
    id: 'vEst', items: [{ id: 'p1', name: 'Agua', qty: 1 }],
    shiftId: 'TR', payments: [{ method: 'Dinheiro', amount: 2.5 }],
  }, token);
  check('venda em dinheiro registrada', vd.status === 200, JSON.stringify(vd.dados));
  const lanAntes = (await req('GET', '/api/entries', undefined, token)).dados?.entries?.filter((e) => e.source === 'vEst').length;
  check('entrada gravada no financeiro', lanAntes === 1, 'lancamentos=' + lanAntes);
  check('entrada nasce NAO liquidada (settled=false)',
    (await req('GET', '/api/entries', undefined, token)).dados?.entries?.find((e) => e.source === 'vEst')?.settled === false);
  const estFin = await req('POST', '/api/venda/estornar', { id: 'vEst', motivo: 'e2e' }, token);
  check('estorno aceito', estFin.status === 200, JSON.stringify(estFin.dados));
  check('  gravou QUEM estornou', !!estFin.dados?.venda?.refundBy, JSON.stringify(estFin.dados?.venda?.refundBy));
  const lanDepois = (await req('GET', '/api/entries', undefined, token)).dados?.entries?.filter((e) => e.source === 'vEst').length;
  check('entrada saiu do financeiro junto com o estorno', lanDepois === 0, 'lancamentos=' + lanDepois);

  console.log('\n18. Papel do usuario (quem pode mexer no dinheiro da loja)');
  /* Cria um "caixa" de verdade no banco para testar o RBAC. */
  const bdR = new DatabaseSync(DB);
  const salR = randomBytes(16).toString('hex');
  const uCaixa = {
    id: 'uCaixa', username: 'caixa', name: 'Caixa', role: 'caixa', active: true,
    sal: salR, senhaHash: scryptSync('1234', salR, 64, { N: 16384 }).toString('hex'),
  };
  bdR.prepare('INSERT OR REPLACE INTO usuarios (id, username, name, role, active, json) VALUES (?,?,?,?,?,?)')
    .run(uCaixa.id, uCaixa.username, uCaixa.name, uCaixa.role, 1, JSON.stringify(uCaixa));
  bdR.close();
  const lCaixa = await req('POST', '/api/login', { usuario: 'caixa', senha: '1234' });
  check('login do perfil caixa', lCaixa.status === 200, JSON.stringify(lCaixa.dados));
  const tCaixa = lCaixa.dados?.token;

  const cfgCaixa = await req('POST', '/api/config', { config: { storeName: 'Hackeado' } }, tCaixa);
  check('caixa NAO altera a config da loja -> 403', cfgCaixa.status === 403, 'status=' + cfgCaixa.status);
  check('  e a config continua a de verdade',
    (await req('GET', '/api/config', undefined, token)).dados?.config?.storeName !== 'Hackeado');

  const prodNeg = await req('POST', '/api/produtos', { lista: [{ id: 'pneg', name: 'Preco negativo', price: -500, stock: 5 }] }, token);
  check('produto com preco negativo -> 400', prodNeg.status === 400, 'status=' + prodNeg.status);
  const prodNeg2 = await req('POST', '/api/produtos', { lista: [{ id: 'pneg2', name: 'Estoque negativo', price: 5, stock: -999 }] }, token);
  check('produto com estoque negativo -> 400', prodNeg2.status === 400, 'status=' + prodNeg2.status);
  check('  nenhum dos dois foi gravado',
    !(await req('GET', '/api/base', undefined, token)).dados?.produtos?.some((p) => p.id === 'pneg' || p.id === 'pneg2'));

  /* Estorno de venda alheia: gerente passa, caixa nao.
   *
   * A autoria da venda tem de vir da SESSAO. O corpo da requisicao pode
   * mandar `operatorId` a vontade -- e mandava -- e esse campo e o que decide
   * quem estorna. Sem o servidor sobrescrever, um caixa carimbava a venda com
   * o id de outro e a regra saia pela pessoa errada (ou a venda ficava "de
   * nobody", e ninguem podia estornar nem o proprio caixa). Entao o teste
   * manda um operatorId falso de proposito e confere que ele foi ignorado. */
  const bdR2 = new DatabaseSync(DB);
  const salR2 = randomBytes(16).toString('hex');
  const uCaixa2 = {
    id: 'uCaixa2', username: 'caixa2', name: 'Caixa Dois', role: 'caixa', active: true,
    sal: salR2, senhaHash: scryptSync('1234', salR2, 64, { N: 16384 }).toString('hex'),
  };
  bdR2.prepare('INSERT OR REPLACE INTO usuarios (id, username, name, role, active, json) VALUES (?,?,?,?,?,?)')
    .run(uCaixa2.id, uCaixa2.username, uCaixa2.name, uCaixa2.role, 1, JSON.stringify(uCaixa2));
  bdR2.close();
  const tCaixa2 = (await req('POST', '/api/login', { usuario: 'caixa2', senha: '1234' })).dados?.token;
  check('segundo caixa consegue entrar', !!tCaixa2);

  await req('POST', '/api/venda', {
    id: 'vAlheia', items: [{ id: 'p1', name: 'Agua', qty: 1 }],
    operatorId: 'uCaixa', operatorName: 'Caixa Um',   // <- tentativa de forjar
    payments: [{ method: 'Dinheiro', amount: 2.5 }],
  }, tCaixa2);
  const vAlheiaLida = (await req('GET', '/api/vendas', undefined, token)).dados?.vendas?.find((v) => v.id === 'vAlheia');
  check('operatorId do corpo foi ignorado (vem da sessao)',
    vAlheiaLida && vAlheiaLida.operatorId === 'uCaixa2', 'operatorId=' + vAlheiaLida?.operatorId);
  check('operatorName do corpo foi ignorado',
    vAlheiaLida && vAlheiaLida.operatorName === 'Caixa Dois', 'operatorName=' + vAlheiaLida?.operatorName);

  const estAlheio = await req('POST', '/api/venda/estornar', { id: 'vAlheia', motivo: 'eu quero' }, tCaixa);
  check('caixa NAO estorna venda de outro operador -> 403', estAlheio.status === 403, 'status=' + estAlheio.status);
  check('  e a venda continua valendo',
    (await req('GET', '/api/vendas', undefined, token)).dados?.vendas?.find((v) => v.id === 'vAlheia')?.status !== 'Estornada');

  /* Controle positivo: o dono da venda estorna a propria. Se isso falhasse,
   * o 403 acima provaria nada -- qualquer um estaria barrado. */
  await req('POST', '/api/venda', {
    id: 'vPropria', items: [{ id: 'p1', name: 'Agua', qty: 1 }],
    payments: [{ method: 'Dinheiro', amount: 2.5 }],
  }, tCaixa);
  const estPropria = await req('POST', '/api/venda/estornar', { id: 'vPropria', motivo: 'erro meu' }, tCaixa);
  check('caixa estorna a PROPRIA venda -> 200', estPropria.status === 200, 'status=' + estPropria.status);

  const estGerente = await req('POST', '/api/venda/estornar', { id: 'vAlheia', motivo: 'gerente pode' }, token);
  check('gerente estorna qualquer venda', estGerente.status === 200, JSON.stringify(estGerente.dados));

  console.log('\n19. Turno e limite de corpo');
  check('/api/base devolve os turnos (conferencia cebra)',
    Array.isArray((await req('GET', '/api/base', undefined, token)).dados?.turnos), JSON.stringify((await req('GET', '/api/base', undefined, token)).dados?.turnos?.map((t) => t.id)));
  const grande = await req('POST', '/api/produtos', { id: 'g', name: 'x'.repeat(3 * 1024 * 1024) }, token);
  check('corpo de 3 MB -> 413 (teto de 2 MB)', grande.status === 413, 'status=' + grande.status);
  check('  motivo nomeado', grande.dados?.codigo === 'corpo_grande', JSON.stringify(grande.dados));

  console.log('\n20. Logout (por ultimo: mata o token)');
  check('logout 200', (await req('POST', '/api/logout', {}, token)).status === 200);
  check('token morto apos logout', (await req('GET', '/api/base', undefined, token)).status === 401);

  console.log('\n21. Rate limit no login');
  /* A mesma conta, muitas vezes: e o ataque que importa (descobrir a senha
     de admin). A chave e IP+usuario de proposito -- os 5 caixas da loja
     saem do mesmo IP, e um limite so por IP trancaria o caixa legitimo. */
  let x429 = 0, x401 = 0;
  for (let i = 0; i < 12; i++) {
    const r = await req('POST', '/api/login', { usuario: 'admin', senha: 'errada' + i });
    if (r.status === 429) x429++;
    if (r.status === 401) x401++;
  }
  check('login repetido acaba barrado (429)', x429 > 0, '429=' + x429 + ' 401=' + x401);
  check('barreira veio depois de varias 401', x401 > 0 && x429 > 0, '401=' + x401 + ' 429=' + x429);

  /* Outro usuario do MESMO IP nao pode ser afetado pela barreira do
     admin: cada conta tem a sua propria janela. */
  const outro = await req('POST', '/api/login', { usuario: 'caixa1', senha: 'errada' });
  check('outra conta nao herda a barreira', outro.status === 401, 'status=' + outro.status);

  console.log('\n22. Token na URL so serve para leitura');
  /* O <img> de export nao manda cabecalho customizado, entao GET aceita o
   * token na query. POST nao: na URL o token vira log de acesso, historico
   * do navegador e "estado que mexe em dinheiro pela URL".
   * O token do admin foi morto na secao 20 e a secao 21 esgotou a janela de
   * tentativas dele, entao o teste usa a sessao do "caixa", que segue viva. */
  const tUrl = tCaixa;
  const tq = await req('GET', '/api/base?token=' + tUrl, undefined);
  check('GET aceita token na query (export por <img>)', tq.status === 200, 'status=' + tq.status);
  const tq2 = await req('POST', '/api/produtos?token=' + tUrl, { lista: [{ id: 'purl', name: 'Via URL', price: 1, stock: 1 }] });
  check('POST NAO aceita token na query -> 401', tq2.status === 401, 'status=' + tq2.status);
  check('  e nada foi gravado por URL',
    !(await req('GET', '/api/base', undefined, tUrl)).dados?.produtos?.some((p) => p.id === 'purl'));

  console.log('\n' + '='.repeat(46));
  console.log(`  ${ok} passaram, ${fail} falharam`);
  console.log('='.repeat(46));
} catch (e) {
  console.error('ERRO NO TESTE:', e);
  fail++;
} finally {
  srv.kill();
}

process.exit(fail ? 1 : 0);
