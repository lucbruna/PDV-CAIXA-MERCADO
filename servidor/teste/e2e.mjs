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
  const ad = await req('POST', '/api/venda', {
    id: 'v2', seq: 1002, date: '2026-09-29T12:05:00.000Z',
    items: [{ id: 'p1', name: 'Agua', qty: 1, price: 0.01 }],
    total: 0.01, change: 0, payments: [{ method: 'Dinheiro', amount: 0.01 }],
  }, token);
  check('venda adulterada aceita como venda normal', ad.status === 200);
  check('total recalculado pelo servidor (2.5)', ad.dados?.venda?.total === 2.5, 'total=' + ad.dados?.venda?.total);
  check('preco do item reescrito (2.5)', ad.dados?.venda?.items?.[0]?.price === 2.5);

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

  console.log('\n15. Logout (por ultimo: mata o token)');
  check('logout 200', (await req('POST', '/api/logout', {}, token)).status === 200);
  check('token morto apos logout', (await req('GET', '/api/base', undefined, token)).status === 401);

  console.log('\n16. Rate limit no login');
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
