/* Confere o caminho de sincronizacao de cadastro: o que o app envia quando
   o caixa cadastra um cliente/produto tem de chegar ao servidor, e um
   segundo "caixa" tem de enxergar. Roda contra um banco descartavel. */
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { scryptSync, randomBytes } from 'node:crypto';

const W = process.argv[2];
const PORTA = 8787;
const BASE = `http://127.0.0.1:${PORTA}`;
const DB = join(W, 'sync.db');
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
const check = (n, c, e = '') => { if (c) { ok++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (e ? ' :: ' + e : '')); } };

async function req(metodo, caminho, corpo, token) {
  const headers = {};
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(BASE + caminho, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  let d = null; try { d = await r.json(); } catch {}
  return { status: r.status, dados: d };
}

try {
  // seed: bootstrap migration + scrypt admin
  await req('POST', '/api/migrar', { products: [], customers: [], config: { storeName: 'Sync' } });
  const sal = randomBytes(16).toString('hex');
  const u = { id: 'u1', name: 'Admin', username: 'admin', sal, senhaHash: scryptSync('1234', sal, 64, { N: 16384 }).toString('hex'), role: 'admin', active: true };
  const bd = new DatabaseSync(DB);
  bd.prepare('INSERT OR REPLACE INTO usuarios (id, username, name, role, active, json) VALUES (?,?,?,?,?,?)')
    .run('u1', 'admin', 'Admin', 'admin', 1, JSON.stringify(u));
  bd.close();

  const login = await req('POST', '/api/login', { usuario: 'admin', senha: '1234' });
  check('login', login.status === 200, JSON.stringify(login.dados));
  const t = login.dados.token;

  console.log('\n1. Cadastro de cliente sobe');
  const c = await req('POST', '/api/customers', { lista: [{ id: 'c1', name: 'Cliente Sincronizado', cpf: '12345678901', debt: 0, points: 0 }] }, t);
  check('POST /api/customers 200', c.status === 200, JSON.stringify(c.dados));
  check('gravou 1', c.dados?.gravados === 1);
  const base = await req('GET', '/api/base', undefined, t);
  check('cliente visivel no /api/base', base.dados?.clientes?.some((x) => x.id === 'c1'));
  check('CPF preservado', base.dados?.clientes?.find((x) => x.id === 'c1')?.cpf === '12345678901');

  console.log('\n2. Cadastro de produto sobe (preco e estoque decidedos no servidor)');
  const p = await req('POST', '/api/products', { lista: [{ id: 'p1', code: '999', name: 'Produto Sinc', price: 4.5, cost: 2, stock: 10, category: 'bebidas' }] }, t);
  check('POST /api/products 200', p.status === 200, JSON.stringify(p.dados));
  const prod = (await req('GET', '/api/base', undefined, t)).dados?.produtos?.find((x) => x.id === 'p1');
  check('preco no servidor', prod?.price === 4.5, 'preco=' + prod?.price);
  check('estoque no servidor', prod?.stock === 10, 'estoque=' + prod?.stock);

  console.log('\n3. Reenvio do mesmo cadastro nao duplica (upsert por id)');
  await req('POST', '/api/customers', { lista: [{ id: 'c1', name: 'Cliente Editado', cpf: '12345678901', debt: 0 }] }, t);
  const cs = (await req('GET', '/api/base', undefined, t)).dados?.clientes?.filter((x) => x.id === 'c1');
  check('ainda 1 registro', cs?.length === 1, 'qtd=' + cs?.length);
  check('nome atualizado', cs?.[0]?.name === 'Cliente Editado', cs?.[0]?.name);

  console.log('\n4. Estorno devolve estoque e baixa a divida do cliente');
  const cli = { id: 'c2', name: 'Devedor', debt: 0, points: 0 };
  // com token: sem ele o POST e recusado com 401 e o cliente nem existe
  const cr = await req('POST', '/api/customers', { lista: [cli] }, t);
  check('cliente devedor criado', cr.status === 200, JSON.stringify(cr.dados));
  const v = await req('POST', '/api/venda', {
    id: 'v1', date: '2026-09-29T15:00:00.000Z',
    items: [{ id: 'p1', name: 'Produto Sinc', qty: 3, price: 4.5 }],
    total: 13.5, change: 0, customerId: 'c2',
    payments: [{ method: 'Crediário', amount: 13.5 }],
  }, t);
  check('venda a prazo registrada', v.status === 200, JSON.stringify(v.dados));
  const dev = (await req('GET', '/api/base', undefined, t)).dados?.clientes?.find((x) => x.id === 'c2');
  check('divida subiu 13.5', dev?.debt === 13.5,
    'debt=' + JSON.stringify(dev?.debt) + ' | venda.payments=' + JSON.stringify(v.dados?.venda?.payments));
  const est = await req('POST', '/api/venda/estornar', { id: 'v1', motivo: 'devolucao' }, t);
  check('estorno aceito', est.status === 200, JSON.stringify(est.dados));
  const dev2 = (await req('GET', '/api/base', undefined, t)).dados?.clientes?.find((x) => x.id === 'c2');
  check('divida voltou a 0', dev2?.debt === 0, 'debt=' + dev2?.debt);
  const prod2 = (await req('GET', '/api/base', undefined, t)).dados?.produtos?.find((x) => x.id === 'p1');
  check('estoque voltou a 10', prod2?.stock === 10, 'estoque=' + prod2?.stock);

  console.log('\n' + '='.repeat(46));
  console.log(`  ${ok} passaram, ${fail} falharam`);
  console.log('='.repeat(46));
} catch (e) {
  console.error('ERRO:', e);
  fail++;
} finally { srv.kill(); }
process.exit(fail ? 1 : 0);
