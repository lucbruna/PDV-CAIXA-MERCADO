/* Teste da fila de reenvio do cliente (js/api.js).
 *
 * A fila de reenvio e a promessa central do sistema: a venda NUNCA e perdida
 * por causa do servidor, ela fica guardada e sobe quando a rede volta. O bug
 * que estes testes cobrem era silencioso e total -- o `reenviar()` testava
 * `p.ok` em cima de uma Promise (que da `undefined` sempre), entao nenhum item
 * contava como enviado, o loop parava no primeiro e devolvia o registro para a
 * FRENTE da fila. A fila nao esvaziava nunca e a tela dizia que ja tinha
 * sincronizado.
 *
 * O arquivo roda de verdade aqui: carregado num sandbox com localStorage e
 * fetch falsos. Nao e reimplementacao -- e o codigo de producao.
 *
 * Uso: node servidor/teste/api-fila.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const RAIZ = process.argv[2] || process.cwd();
const CODIGO = readFileSync(join(RAIZ, 'js', 'api.js'), 'utf8');

let ok = 0, fail = 0;
function check(nome, cond, extra = '') {
  if (cond) { ok++; console.log('  PASS  ' + nome); }
  else { fail++; console.log('  FAIL  ' + nome + (extra ? ' :: ' + extra : '')); }
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- sandbox ---------------- */
function novoCliente() {
  const storage = new Map();

  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => { storage.set(k, String(v)); },
    removeItem: (k) => { storage.delete(k); },
    _raw: storage,
  };

  /* O servidor falso. `roteador` decide a resposta por rota e pode esta
   * "fora do ar", que e o estado status 0 que a fila precisa tratar. */
  const servidor = { noAr: true, roteador: () => ({ status: 200, corpo: {} }) };

  function fetch(caminho, opcoes) {
    if (servidor.noAr) {
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    const r = servidor.roteador(caminho, opcoes);
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (n) => (n === 'X-Sessao-Expira' ? '2026-09-29T23:00:00.000Z' : null) },
      json: () => Promise.resolve(r.corpo || {}),
    });
  }

  const sandbox = {
    localStorage, fetch, document: { hidden: false },
    AbortController, setTimeout, clearTimeout, setInterval, clearInterval,
    console, JSON, Math, Date, isNaN, parseInt, parseFloat, encodeURIComponent, Object, Array, String, Number, Promise, Error,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CODIGO, sandbox, { filename: 'api.js' });

  return { API: sandbox.API, localStorage, storage, servidor };
}

function venda(id, total = 10) {
  return {
    id, seq: 1, items: [{ id: 'p1', name: 'P', qty: 1, price: total }],
    total, change: 0, payments: [{ method: 'Dinheiro', amount: total }],
  };
}

try {
  /* ---------------- 1. fila enche com o servidor fora do ar ---------------- */
  console.log('\n1. Venda com servidor fora do ar entra na fila');
  let c = novoCliente();
  c.API.estado.online = true;
  c.localStorage.setItem('sudam_token', 't'.repeat(64));

  const r1 = await c.API.venda(venda('v1'));
  check('venda nao confirma ok', r1.ok === false);
  check('venda foi enfileirada', r1.enfileirada === true);
  check('fila tem 1 item', c.API.pendentes() === 1, 'pendentes=' + c.API.pendentes());

  await c.API.salvar('produtos', [{ id: 'p9', name: 'X', price: 1 }]);
  check('gravacao tambem foi enfileirada', c.API.pendentes() === 2, 'pendentes=' + c.API.pendentes());

  /* ---------------- 2. com o servidor de volta, a fila ESVAZIA ---------------- */
  console.log('\n2. Servidor volta: a fila tem que esvaziar de verdade');
  const enviados = [];
  c.servidor.noAr = false;
  c.servidor.roteador = (caminho, op) => {
    enviados.push(caminho);
    return { status: 200, corpo: { venda: { id: 'x' }, gravados: 1, contagem: {} } };
  };

  const r2 = await c.API.reenviar();
  check('reenviar conta os 2 itens', r2.enviados === 2, 'enviados=' + r2.enviados);
  check('fila ficou vazia', c.API.pendentes() === 0, 'pendentes=' + c.API.pendentes());
  check('restam = 0', r2.restam === 0, 'restam=' + r2.restam);
  check('nenhum rejeitado', c.API.rejeitados() === 0);
  check('os 2 foram mesmo enviados', enviados.length === 2, enviados.join(','));

  /* Este e o teste que quebrava antes: uma segunda rodada nao pode reencravar. */
  const r3 = await c.API.reenviar();
  check('rodar de novo com fila vazia nao quebra', r3.ok === true && r3.enviados === 0,
    'ok=' + r3.ok + ' enviados=' + r3.enviados);

  /* ---------------- 3. peca envenenada nao trava a fila ---------------- */
  console.log('\n3. Registro recusado de vez NAO pode bloquear os outros');
  c = novoCliente();
  c.localStorage.setItem('sudam_token', 't'.repeat(64));
  c.servidor.noAr = false;
  /* O primeiro da fila e recusado com 400 (produto apagado, total invalido).
   * Os dois seguintes sao válidos e PRECISAM subir. */
  c.servidor.roteador = (caminho, op) => {
    let id = null;
    try { id = JSON.parse(op.body).id; } catch (e) {}
    if (id === 'venenosa') {
      return { status: 400, corpo: { erro: 'Produto não existe mais no servidor.', codigo: 'produto_inexistente' } };
    }
    return { status: 200, corpo: { venda: { id }, gravados: 1 } };
  };

  /* Enfileira na ordem: a venenosa primeiro, como aconteceria na vida real. */
  c.servidor.noAr = true;
  await c.API.venda(venda('venenosa'));
  await c.API.venda(venda('boa1'));
  await c.API.venda(venda('boa2'));
  check('3 itens na fila', c.API.pendentes() === 3, 'pendentes=' + c.API.pendentes());

  c.servidor.noAr = false;
  const r4 = await c.API.reenviar();
  check('as 2 vendas boas subiram mesmo com a ruim na frente', r4.enviados === 2, 'enviados=' + r4.enviados);
  check('a fila esvaziou', c.API.pendentes() === 0, 'pendentes=' + c.API.pendentes());
  check('a recusa foi contabilizada', r4.recusados === 1, 'recusados=' + r4.recusados);
  check('o registro recusado foi guardado para o gerente', c.API.rejeitados() === 1, 'rejeitados=' + c.API.rejeitados());

  const guardados = JSON.parse(c.localStorage.getItem('sudam_rejeitados') || '[]');
  check('o motivo da recusa ficou gravado', /não existe mais/i.test(guardados[0]?.motivo || ''),
    guardados[0]?.motivo);
  check('o dado da venda nao foi perdido', guardados[0]?.dados?.id === 'venenosa',
    JSON.stringify(guardados[0]?.dados?.id));

  /* ---------------- 4. servidor cai no MEIO do reenvio ---------------- */
  console.log('\n4. Servidor cai no meio: nada pode ser perdido');
  c = novoCliente();
  c.localStorage.setItem('sudam_token', 't'.repeat(64));
  c.servidor.noAr = true;
  await c.API.venda(venda('off1'));
  await c.API.venda(venda('off2'));
  await c.API.venda(venda('off3'));
  check('3 na fila antes', c.API.pendentes() === 3);

  /* O primeiro responde 200 e o resto o servidor ja foi embora. */
  let chamadas = 0;
  c.servidor.noAr = false;
  c.servidor.roteador = () => {
    chamadas++;
    if (chamadas === 1) return { status: 200, corpo: { venda: {} } };
    c.servidor.noAr = true;   // caiu agora
    return { status: 200, corpo: { venda: {} } };
  };

  const r5 = await c.API.reenviar();
  check('mandou so o que deu', r5.enviados >= 1, 'enviados=' + r5.enviados);
  /* Nenhum registro pode sumir: os que subiram sairam da fila de proposito, os
   * que nao subiram tem de estar em algum lugar. A conta fecha em 3. */
  check('nenhum registro foi perdido',
    r5.enviados + c.API.pendentes() + c.API.rejeitados() === 3,
    'enviados=' + r5.enviados + ' na fila=' + c.API.pendentes() + ' rejeitados=' + c.API.rejeitados());
  check('o que nao subiu esta na fila para a proxima', c.API.pendentes() >= 1,
    'pendentes=' + c.API.pendentes());
  check('parou ao perceber que o servidor caiu (nao tentou os 500)', chamadas <= 3,
    'chamadas=' + chamadas);

  /* ---------------- 5. sessao expirada no meio ---------------- */
  console.log('\n5. Sessao expirada: para e devolve, sem perder');
  c = novoCliente();
  c.localStorage.setItem('sudam_token', 't'.repeat(64));
  c.servidor.noAr = true;
  await c.API.venda(venda('sess1'));
  await c.API.venda(venda('sess2'));
  c.servidor.noAr = false;
  let n401 = 0;
  c.servidor.roteador = () => {
    n401++;
    if (n401 === 1) return { status: 200, corpo: { venda: {} } };
    return { status: 401, corpo: { erro: 'Sessao expirada ou ausente.' } };
  };
  const r6 = await c.API.reenviar();
  check('parou ao receber 401', c.API.pendentes() >= 1, 'pendentes=' + c.API.pendentes());
  check('nada foi para a lista de rejeitados (401 nao e recusa do dado)',
    c.API.rejeitados() === 0, 'rejeitados=' + c.API.rejeitados());
  check('o token foi limpo', c.localStorage.getItem('sudam_token') === null);

  /* ---------------- 6. sem token, nao faz nada ---------------- */
  console.log('\n6. Sem sessao a fila nao e tocada');
  c = novoCliente();
  c.servidor.noAr = true;
  await c.API.venda(venda('nt1'));
  const antes = c.API.pendentes();
  const r7 = await c.API.reenviar();
  check('nao tentou reenviar', r7.ok === false, 'ok=' + r7.ok);
  check('a fila continua intacta', c.API.pendentes() === antes, 'pendentes=' + c.API.pendentes());
} catch (e) {
  fail++;
  console.log('  FAIL  excecao: ' + e.message + '\n' + (e.stack || ''));
}

console.log('\n==============================================');
console.log('  ' + ok + ' passaram, ' + fail + ' falharam');
console.log('==============================================');
process.exit(fail ? 1 : 0);