/* Teste da reconciliacao de estoque (js/store.js + js/api.js).
 *
 * O servidor decide preco e estoque; o caixa guarda uma copia de trabalho.
 * Sem reconciliacao, dois caixas que mexem no mesmo produto fora do fluxo
 * normal ficam divergentes ate alguem reparar. Este teste roda os arquivos
 * REAIS num sandbox (localStorage e fetch falsos, como o api-fila.mjs) e
 * confere:
 *   1. estoque e preco do servidor entram no produto local;
 *   2. produto que existe so no servidor entra no local;
 *   3. cadastro local AINDA NAO enviado NAO e sobrescrito;
 *   4. depois que a fila esvazia, a reconciliacao volta a aplicar.
 *
 * Uso: node servidor/teste/estoque-reconcilia.mjs <raiz-do-projeto>
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const RAIZ = process.argv[2] || process.cwd();
const CODIGO_API = readFileSync(join(RAIZ, 'js', 'api.js'), 'utf8');
const CODIGO_STORE = readFileSync(join(RAIZ, 'js', 'store.js'), 'utf8');

let ok = 0, fail = 0;
function check(nome, cond, extra = '') {
  if (cond) { ok++; console.log('  PASS  ' + nome); }
  else { fail++; console.log('  FAIL  ' + nome + (extra ? ' :: ' + extra : '')); }
}

/* ---------------- sandbox ---------------- */
function novoCliente() {
  const storage = new Map();
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { storage.set(k, String(v)); },
    removeItem: (k) => { storage.delete(k); },
    _raw: storage,
  };

  /* Servidor falso: `noAr` derruba a rede, `produtos` e o catalogo que a rota
   * /api/produtos devolve. */
  const servidor = { noAr: false, produtos: [] };

  function fetch(caminho, opcoes) {
    if (servidor.noAr) return Promise.reject(new TypeError('Failed to fetch'));
    const rota = String(caminho).split('?')[0];
    if (rota === '/api/produtos' && (!opcoes || opcoes.method === 'GET')) {
      return Promise.resolve(resposta(200, { produtos: servidor.produtos }));
    }
    return Promise.resolve(resposta(200, { gravados: 1, venda: {} }));
  }

  function resposta(status, corpo) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (n) => (n === 'X-Sessao-Expira' ? '2026-09-29T23:00:00.000Z' : null) },
      json: () => Promise.resolve(corpo || {}),
    };
  }

  const sandbox = {
    localStorage, fetch, document: { hidden: false },
    AbortController, setTimeout, clearTimeout, setInterval, clearInterval,
    console, JSON, Math, Date, isNaN, parseInt, parseFloat,
    encodeURIComponent, decodeURIComponent, encodeURI,
    Object, Array, String, Number, Promise, Error, RegExp, Boolean,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CODIGO_API, sandbox, { filename: 'api.js' });
  vm.runInContext(CODIGO_STORE, sandbox, { filename: 'store.js' });
  return { API: sandbox.API, Store: sandbox.Store, localStorage, servidor };
}

try {
  const c = novoCliente();
  c.Store.load();
  c.localStorage.setItem('sudam_token', 't'.repeat(64));

  /* Catalogo local de trabalho: p1 com estoque e preco velhos; p3 com uma
   * edicao local que ainda nao subiu. */
  c.Store.db.products = [
    { id: 'p1', name: 'Arroz', price: 5, cost: 3, stock: 10, min: 2, active: true, category: 'mercearia' },
    { id: 'p3', name: 'Feijao', price: 8, cost: 5, stock: 4, min: 1, active: true, category: 'mercearia' },
  ];

  console.log('\n1. Estoque e preco do servidor entram no local');
  c.servidor.produtos = [
    { id: 'p1', name: 'Arroz', price: 5.5, cost: 3, stock: 7, min: 2, active: true, category: 'mercearia' },
  ];
  let r = await c.Store.reconciliarEstoque();
  check('reconciliacao ok', r.ok === true, JSON.stringify(r));
  check('reconciliou 1 produto', r.atualizados === 1, 'atualizados=' + r.atualizados);
  const p1 = c.Store.db.products.find((p) => p.id === 'p1');
  check('estoque local virou 7', p1.stock === 7, 'stock=' + p1.stock);
  check('preco local virou 5,5', p1.price === 5.5, 'price=' + p1.price);
  check('gravou no localStorage', JSON.parse(c.localStorage.getItem(c.Store.STORAGE_KEY)).products.find((p) => p.id === 'p1').stock === 7);

  console.log('\n2. Produto que existe so no servidor entra no local');
  c.servidor.produtos = [
    { id: 'p1', name: 'Arroz', price: 5.5, cost: 3, stock: 7, min: 2, active: true, category: 'mercearia' },
    { id: 'p2', name: 'Sabao', price: 3.25, cost: 2, stock: 20, min: 3, active: true, category: 'limpeza' },
  ];
  r = await c.Store.reconciliarEstoque();
  check('entrou 1 produto novo', r.novos === 1, 'novos=' + r.novos);
  check('p2 existe no local', !!c.Store.db.products.find((p) => p.id === 'p2'));

  console.log('\n3. Cadastro local pendente NAO e sobrescrito');
  /* O servidor ainda acha que p3 tem 4; o local tem uma edicao para 9 que
   * ainda nao subiu (fila). A reconciliacao precisa ESPERAR. */
  const p3local = c.Store.db.products.find((p) => p.id === 'p3');
  p3local.stock = 9;
  c.servidor.noAr = true;
  await c.API.salvar('products', [p3local]);      // sem rede: vai para a fila
  check('a fila tem 1 pendencia', c.API.pendentes() === 1, 'pendentes=' + c.API.pendentes());
  check('temPendencia(products) verdadeiro', c.API.temPendencia('products') === true);

  c.servidor.noAr = false;
  c.servidor.produtos = [
    { id: 'p3', name: 'Feijao', price: 8, cost: 5, stock: 4, min: 1, active: true, category: 'mercearia' },
  ];
  r = await c.Store.reconciliarEstoque();
  check('reconciliacao foi adiada', r.ok === false && r.motivo === 'cadastro local pendente', JSON.stringify(r));
  check('o estoque local continua 9 (nao foi sobrescrito)',
    c.Store.db.products.find((p) => p.id === 'p3').stock === 9,
    'stock=' + c.Store.db.products.find((p) => p.id === 'p3').stock);

  console.log('\n4. Fila vazia: a reconciliacao volta a aplicar');
  const env = await c.API.reenviar();
  check('a fila esvaziou', c.API.pendentes() === 0, 'pendentes=' + c.API.pendentes() + ' enviados=' + env.enviados);

  /* Agora o servidor ja tem a edicao (estoque 9) e mudou de novo para 6:
   * o valor novo precisa chegar. */
  c.servidor.produtos = [
    { id: 'p3', name: 'Feijao', price: 8, cost: 5, stock: 6, min: 1, active: true, category: 'mercearia' },
  ];
  r = await c.Store.reconciliarEstoque();
  check('voltou a reconciliar', r.ok === true, JSON.stringify(r));
  check('estoque local virou 6', c.Store.db.products.find((p) => p.id === 'p3').stock === 6,
    'stock=' + c.Store.db.products.find((p) => p.id === 'p3').stock);

  console.log('\n5. Servidor fora do ar nao quebra nem inventa dado');
  c.servidor.noAr = true;
  r = await c.Store.reconciliarEstoque();
  check('devolve falha neutra', r.ok === false, JSON.stringify(r));
  check('o local segue intacto', c.Store.db.products.find((p) => p.id === 'p3').stock === 6);
} catch (e) {
  fail++;
  console.log('  FAIL  excecao: ' + e.message + '\n' + (e.stack || ''));
}

console.log('\n' + '='.repeat(46));
console.log(`  ${ok} passaram, ${fail} falharam`);
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
