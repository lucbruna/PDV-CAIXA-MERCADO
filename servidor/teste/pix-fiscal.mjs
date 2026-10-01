/* Teste do Pix (BR Code) e dos dados fiscais.
 *
 * Duas frentes, porque sao duas coisas diferentes:
 *
 *   1. CLIENTE -- o payload "copia e cola" e o QR sao gerados em js/ui.js e
 *      js/qr.js. Aqui o payload EMV e conferido campo a campo contra a spec
 *      (TLV, moeda, valor, nome/cidade, txid) e o CRC16 contra o vetor padrao
 *      CRC-16/CCITT-FALSE ("123456789" -> 29B1), que e o algoritmo do Pix.
 *      O gerador de QR e checado por sanidade (SVG valido, modulos coerentes,
 *      saida deterministica) -- um leitor de verdade nao cabe aqui.
 *
 *   2. SERVIDOR -- os campos fiscais (NCM/CFOP/CSOSN/CST/CEST/origem) e a
 *      config fiscal (CRT, CNAE, codigo IBGE, Pix) precisam sobreviver ao
 *      vai-e-volta do SQLite com o JSON. Se o cadastro perde o NCM, "preparar
 *      os campos fiscais" e promessa vazia. Este bloco sobe o servidor de
 *      verdade, migra um produto com fiscal completo e le /api/base de volta.
 *
 * O que este teste NAO faz -- de proposito: emitir NFC-e. O sistema declara
 * que nao emite (ver CHECKLIST-PDV.md 2.1); o que da para garantir e o
 * armazenamento correto do dado fiscal e o comprovante auxiliar.
 *
 * Uso: node servidor/teste/pix-fiscal.mjs <pasta-temporaria> <raiz-servidor>
 */
import { spawn, execFileSync } from 'node:child_process';
import { rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { hashAntigo } from '../auth.mjs';

const W = process.argv[2];
const RAIZ = process.argv[3];
const PORTA = 8796;
const BASE = `http://127.0.0.1:${PORTA}`;
const DB = join(W, 'pix-fiscal.db');

let ok = 0, fail = 0;
function check(nome, cond, extra = '') {
  if (cond) { ok++; console.log('  PASS  ' + nome); }
  else { fail++; console.log('  FAIL  ' + nome + (extra ? ' :: ' + extra : '')); }
}

/* CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) -- o CRC do BR Code.
   Escrito aqui de novo, de proposito: se o helper do ui.js regredir, o teste
   ainda tem uma implementacao independente para comparar. */
function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return ('0000' + crc.toString(16).toUpperCase()).slice(-4);
}

/* ---------------- 1. Pix no cliente ---------------- */

console.log('\n1. Payload Pix (BR Code) em js/ui.js');
/* ui.js e um IIFE que fecha sobre `window`; carregamos com um window falso e
   um Store minimo. Nenhuma funcao de DOM roda no load. */
globalThis.window = globalThis;
globalThis.Store = { db: { config: { storeName: 'Mercado Teste', pix: { pixKey: '', city: '' } } } };
const uiSrc = readFileSync(join(RAIZ, '..', 'js', 'ui.js'), 'utf8');
(0, eval)(uiSrc);
const UI = globalThis.UI;
check('UI carregou (pixPayload exposto)', !!UI && typeof UI.pixPayload === 'function');

check('CRC16/CCITT-FALSE bate o vetor padrao', crc16('123456789') === '29B1', 'crc=' + crc16('123456789'));

const cfg = globalThis.Store.db.config;
cfg.pix.pixKey = '12345678000199';   // CNPJ, 14 digitos
cfg.pix.city = 'SAO PAULO';

check('chave CNPJ nao ganha DDI', UI.normalizePixKey('12345678000199') === '12345678000199',
  UI.normalizePixKey('12345678000199'));
check('CPF de 11 digitos fica igual', UI.normalizePixKey('12345678901') === '12345678901');
check('CNPJ mascarado perde a mascara', UI.normalizePixKey('12.345.678/0001-99') === '12345678000199',
  UI.normalizePixKey('12.345.678/0001-99'));
check('telefone E.164 nao leva +55 duplicado', UI.normalizePixKey('+5511999999999') === '+5511999999999',
  UI.normalizePixKey('+5511999999999'));
check('telefone sem "+" recebe o +55', UI.normalizePixKey('5511999999999') === '+5511999999999',
  UI.normalizePixKey('5511999999999'));
check('email passa intacto', UI.normalizePixKey('loja@email.com') === 'loja@email.com');

const p = UI.pixPayload(25.5, 'ABC123');
check('comeca com payload format indicator 000201', p.startsWith('000201'), p.slice(0, 12));
check('template 26 com a GUI do Pix', p.includes('BR.GOV.BCB.PIX'));
check('chave no subcampo 01 do template 26', p.includes('011412345678000199'));
check('moeda 986 (BRL)', p.includes('5303986'));
check('valor no campo 54 (25.50)', p.includes('540525.50'));
check('pais BR', p.includes('5802BR'));
check('nome do recebedor (campo 59)', p.includes('5913MERCADO TESTE'));
check('cidade do recebedor (campo 60)', p.includes('6009SAO PAULO'));
check('txid no adicional 62/05', p.includes('62100506ABC123'), p);
check('CRC fecha em 6304 + 4 digitos', p.slice(-8, -4) === '6304');
check('CRC confere com a implementacao independente', p.slice(-4) === crc16(p.slice(0, -4)),
  'ui=' + p.slice(-4) + ' esperado=' + crc16(p.slice(0, -4)));

check('sem chave configurada nao gera payload',
  UI.pixPayload(10, 'X') !== '' && (function () {
    const g = globalThis.Store.db.config.pix.pixKey;
    globalThis.Store.db.config.pix.pixKey = '';
    const vazio = UI.pixPayload(10, 'X') === '';
    globalThis.Store.db.config.pix.pixKey = g;
    return vazio;
  })());

console.log('\n2. Gerador de QR (js/qr.js)');
const require = createRequire(import.meta.url);
const QR = require(join(RAIZ, '..', 'js', 'qr.js'));
const enc = QR.encode(p);
check('encode devolve matriz quadrada', enc.size === enc.modules.length && enc.size > 0,
  'size=' + enc.size);
check('versao valida (1..40)', enc.version >= 1 && enc.version <= 40, 'v=' + enc.version);
const enc2 = QR.encode(p);
check('saida deterministica', JSON.stringify(enc.modules) === JSON.stringify(enc2.modules));
const svg = QR.toSVG(p, { tamanho: 200 });
check('toSVG gera <svg>...</svg>', svg.startsWith('<svg') && svg.endsWith('</svg>'));
const elFalso = { innerHTML: '' };
check('render escreve o SVG no elemento e devolve true',
  QR.render(elFalso, p) === true && elFalso.innerHTML.startsWith('<svg'));

/* ---------------- 3. Dados fiscais no servidor ---------------- */

const PRODUTO_FISCAL = {
  id: 'pfisc', code: 'f1', name: 'Refrigerante 2L', category: 'bebidas',
  price: 9.9, cost: 6, stock: 10, active: true,
  ncm: '22021000', cfop: '5102', csosn: '102', cest: '0300100', origin: '0',
  cst: '102', pisCst: '01', cofinsCst: '01',
};
const CONFIG_FISCAL = {
  storeName: 'Fiscal Teste',
  cnpj: '12345678000199', ie: '110042490114',
  crt: '1', cnae: '4711302', municipalityCode: '3550308',
  municipalRegistration: '1234567', zipCode: '01000-000', state: 'SP', city: 'SAO PAULO',
  fiscalPhone: '1133334444', fiscalEmail: 'fiscal@loja.com',
  pix: { pixKey: 'loja@email.com', city: 'SAO PAULO' },
};

for (const s of ['', '-wal', '-shm']) { try { rmSync(DB + s); } catch {} }
const srv = spawn(process.execPath, ['servidor.mjs'], {
  cwd: RAIZ,
  env: { ...process.env, SUDAM_DB: DB, SUDAM_PORTA: String(PORTA), SUDAM_HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));

async function req(metodo, caminho, corpo, token) {
  const headers = {};
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(BASE + caminho, {
    method: metodo, headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  let dados = null;
  try { dados = await r.json(); } catch {}
  return { status: r.status, dados };
}

try {
  await new Promise((r) => setTimeout(r, 1500));

  console.log('\n3. Dado fiscal sobrevive ao /api/migrar -> /api/base');
  const mig = await req('POST', '/api/migrar', {
    products: [PRODUTO_FISCAL],
    customers: [],
    /* `passHash` legado de verdade para '1234': a migracao exige um passHash
       para reconhecer o admin ativo, e o login converte esse hash FNV em
       scrypt na primeira autenticacao (servidor.mjs, rota /api/login). */
    auth: { users: [{ id: 'u1', name: 'Admin', username: 'admin', passHash: hashAntigo('1234'), role: 'admin', active: true }] },
    config: CONFIG_FISCAL,
  });
  check('migracao aceita', mig.status === 200, JSON.stringify(mig.dados));

  const login = await req('POST', '/api/login', { usuario: 'admin', senha: '1234' });
  check('login ok (hash legado convertido)', login.status === 200 && !!login.dados?.token,
    login.status + ' ' + JSON.stringify(login.dados));
  const token = login.dados?.token;

  const base = await req('GET', '/api/base', undefined, token);
  const prod = (base.dados?.produtos || []).find((x) => x.id === 'pfisc');
  check('produto voltou do servidor', !!prod);
  for (const campo of ['ncm', 'cfop', 'csosn', 'cest', 'origin', 'cst', 'pisCst', 'cofinsCst']) {
    check('  produto.' + campo + ' preservado', prod && prod[campo] === PRODUTO_FISCAL[campo],
      prod && prod[campo]);
  }

  const c = base.dados?.config || {};
  for (const campo of ['crt', 'cnae', 'municipalityCode', 'municipalRegistration', 'zipCode', 'state', 'fiscalEmail', 'fiscalPhone']) {
    check('  config.' + campo + ' preservado', c[campo] === CONFIG_FISCAL[campo], JSON.stringify(c[campo]));
  }
  check('  config.pix.pixKey preservado', c.pix && c.pix.pixKey === 'loja@email.com', JSON.stringify(c.pix));
  check('  config.pix.city preservado', c.pix && c.pix.city === 'SAO PAULO', JSON.stringify(c.pix));
} catch (e) {
  fail++;
  console.log('  FAIL  excecao no teste: ' + e.message);
} finally {
  /* No Windows o kill() simples pode disparar a assercao do libuv ao fechar;
     taskkill /T derruba a arvore de processos como nos outros testes. */
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/F', '/T', '/PID', String(srv.pid)], { stdio: 'ignore' });
    else srv.kill('SIGKILL');
  } catch {}
}

console.log('\n' + '='.repeat(46));
console.log(`  ${ok} passaram, ${fail} falharam`);
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
