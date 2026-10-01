/* Teste de navegador: XSS e CSP nas TELAS REAIS.
 *
 * O `frontend-seguro.mjs` e uma guarda estatica: ele varre o codigo e falha se
 * um campo de dado entrar numa linha de markup sem `esc()`. Isso pega a
 * regressao no fonte, mas nao prova o que o navegador faz. Este teste sobe o
 * servidor de verdade, grava um produto e um cliente com payload de XSS, abre
 * o app num Chrome headless, faz login pela tela e caminha pelas paginas para
 * conferir DUAS coisas:
 *
 *   1. o dado do banco sai ESCAPADO -- nenhum elemento injetado aparece;
 *   2. o CSP (`script-src 'self'`, sem 'unsafe-inline') bloqueia `<script>`
 *      inline e handler inline (`onerror`), que e a segunda linha de defesa se
 *      o escape falhar.
 *
 * Fala com o Chrome pelo DevTools Protocol (WebSocket nativo do Node). Sem
 * dependencias: o projeto tem zero.
 *
 * Uso: node servidor/teste/navegador-seguro.mjs <pasta-temporaria> <raiz-servidor>
 */
import { spawn, execFileSync } from 'node:child_process';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';

const W = process.argv[2];
const RAIZ = process.argv[3];
const PORTA = 8799;
const DBG = 9223;
const BASE = `http://127.0.0.1:${PORTA}`;
const DB = join(W, 'navegador.db');
const PERFIL = join(W, 'chrome-perfil');

const CHROME = process.env.CHROME
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

let ok = 0, fail = 0;
function check(nome, cond, extra = '') {
  if (cond) { ok++; console.log('  PASS  ' + nome); }
  else { fail++; console.log('  FAIL  ' + nome + (extra ? ' :: ' + extra : '')); }
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* Mata a arvore do processo. No Windows o `child.kill()` nao derruba os filhos
 * do Chrome, e o processo fica escutando. taskkill /T resolve. */
function matar(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
    else child.kill('SIGKILL');
  } catch {}
}

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
  return { status: r.status, dados, headers: r.headers };
}

/* ---------------- cliente minimo do DevTools Protocol ---------------- */
class CDP {
  constructor(ws) { this.ws = ws; this.n = 0; this.pend = new Map(); this.eventos = []; }
  static async conectar(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout no WebSocket do Chrome')), 10000);
      ws.onopen = () => { clearTimeout(t); res(); };
      ws.onerror = (e) => { clearTimeout(t); rej(new Error('erro no WebSocket: ' + (e.message || ''))); };
    });
    const c = new CDP(ws);
    ws.onmessage = (ev) => c._msg(JSON.parse(ev.data));
    return c;
  }
  _msg(m) {
    if (m.id && this.pend.has(m.id)) {
      const { res, rej } = this.pend.get(m.id);
      this.pend.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    } else if (m.method) {
      this.eventos.push(m);
    }
  }
  send(method, params = {}) {
    const id = ++this.n;
    return new Promise((res, rej) => {
      this.pend.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expressao) {
    const r = await this.send('Runtime.evaluate', { expression: expressao, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error('excecao na pagina: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result?.value;
  }
  async ate(expressao, ms = 8000) {
    const prazo = Date.now() + ms;
    for (;;) {
      try { if (await this.eval(expressao)) return true; } catch {}
      if (Date.now() > prazo) return false;
      await espera(150);
    }
  }
  fechar() { try { this.ws.close(); } catch {} }
}

for (const s of ['', '-wal', '-shm']) { try { rmSync(DB + s); } catch {} }
rmSync(PERFIL, { recursive: true, force: true });
mkdirSync(PERFIL, { recursive: true });

const PAYLOAD_IMG = '<img src=x onerror="window.__xss=1">';
const PAYLOAD_SVG = '<svg onload="window.__xss=2">';

let srv = null, chrome = null, cdp = null;

try {
  console.log('\n1. Sobe o servidor com banco descartavel');
  srv = spawn(process.execPath, ['servidor.mjs'], {
    cwd: RAIZ,
    env: { ...process.env, SUDAM_DB: DB, SUDAM_PORTA: String(PORTA), SUDAM_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', () => {});
  srv.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));
  await espera(1800);
  check('servidor respondeu', (await req('GET', '/api/status')).status === 200);

  console.log('\n2. Grava dado com payload de XSS (o que o navegador vai renderizar)');
  const sal = randomBytes(16).toString('hex');
  const senhaHash = scryptSync('1234', sal, 64, { N: 16384 }).toString('hex');
  const mig = await req('POST', '/api/migrar', {
    products: [
      { id: 'pxss', code: 'xss1', name: 'Produto <b>Perigo</b>', category: 'teste',
        emoji: PAYLOAD_IMG, price: 9.9, stock: 5, active: true,
        promoPrice: 5.5, promoFrom: '2000-01-01', promoTo: '2099-12-31' },
    ],
    customers: [
      { id: 'cxss', name: PAYLOAD_SVG + 'Cliente Perigo', cpf: '12345678901', debt: 0, obs: PAYLOAD_IMG },
    ],
    /* Dois campos com proposito distinto. A migracao exige `u.passHash`
       (hash legado FNV) para reconhecer um administrador ativo; sem ele o
       /api/migrar responde 400 e o app acaba subindo o seed local por cima.
       O login, porem, confere em scrypt: `sal` + `senhaHash` (servidor/
       servidor.mjs, rota /api/login). Por isso os dois aparecem aqui. */
    auth: { users: [{ id: 'u1', name: 'Admin', username: 'admin', sal, senhaHash, passHash: 'legado', role: 'admin', active: true }] },
    config: { storeName: 'Teste Navegador', pix: { pixKey: 'loja@email.com', city: 'SAO PAULO' } },
  });
  check('migracao com payload aceita', mig.status === 200, JSON.stringify(mig.dados));

  console.log('\n3. O cabecalho CSP chega no documento');
  const html = await fetch(BASE + '/');
  const csp = html.headers.get('content-security-policy') || '';
  check('CSP presente no index.html', csp.includes("script-src 'self'"), csp);
  check('CSP sem unsafe-inline em script', !/script-src[^;]*unsafe-inline/.test(csp), csp);

  console.log('\n4. Abre o Chrome headless');
  chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + DBG, '--remote-allow-origins=*',
    '--user-data-dir=' + PERFIL, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let alvo = null;
  for (let i = 0; i < 40 && !alvo; i++) {
    await espera(250);
    try {
      alvo = await fetch(`http://127.0.0.1:${DBG}/json/new?${encodeURIComponent(BASE + '/')}`, { method: 'PUT' }).then((r) => r.json());
    } catch {}
  }
  check('Chrome com alvo de depuracao', !!(alvo && alvo.webSocketDebuggerUrl),
    JSON.stringify(alvo && Object.keys(alvo)));
  if (!alvo) throw new Error('sem alvo do Chrome');

  cdp = await CDP.conectar(alvo.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Log.enable').catch(() => {});

  console.log('\n5. Faz login pela tela real');
  const carregou = await cdp.ate("!!document.getElementById('authUser')", 15000);
  check('tela de login aparece', carregou);
  await cdp.eval("document.getElementById('authUser').value='admin';document.getElementById('authPass').value='1234';document.getElementById('authGo').click();");
  /* A tela de login e o overlay #authScreen; o sistema montado fica atras
     dele. O sinal de "entrou" e o overlay sumir (class hidden). */
  const entrou = await cdp.ate("(function(){var a=document.getElementById('authScreen');return !!(a && a.classList.contains('hidden') && document.querySelector('.rail-btn'));})()", 20000);
  check('login pela tela entrou no sistema', entrou);

  console.log('\n6. CSP bloqueia script e handler inline');
  await cdp.eval("window.__inline=undefined;var s=document.createElement('script');s.textContent='window.__inline=1';document.head.appendChild(s);");
  await espera(300);
  check('`<script>` inline nao executa', (await cdp.eval('window.__inline')) === undefined);

  await cdp.eval("window.__h=undefined;var i=document.createElement('img');i.setAttribute('onerror','window.__h=1');i.src='http://127.0.0.1:1/nao-existe';document.body.appendChild(i);");
  await espera(600);
  check('handler inline (onerror) nao executa', (await cdp.eval('window.__h')) === undefined);

  console.log('\n7. O dado do banco sai escapado nas telas reais');
  /* Primeiro prova que o detector funciona: injetado cru, o payload vira
     elemento. Depois confere que a renderizacao do app nao produz nenhum. */
  const detector = await cdp.eval("(function(){var d=document.createElement('div');d.innerHTML='<img src=x onerror=\"window.__xss=9\">';document.body.appendChild(d);var achou=!!document.querySelector('img[src=\"x\"]');d.remove();return achou;})()");
  check('detector de XSS funciona (controle)', detector === true);

  for (const pagina of ['dashboard', 'pdv', 'sales', 'products', 'purchases', 'customers', 'finance', 'payables', 'reports', 'settings']) {
    await cdp.eval("location.hash='" + pagina + "'");
    await espera(700);
    const injetado = await cdp.eval("document.querySelectorAll('img[src=\"x\"]').length");
    check('pagina ' + pagina + ': nenhum elemento injetado', injetado === 0, 'imgs=' + injetado);
    const crashou = await cdp.eval("!!document.querySelector('.crash-box')");
    check('pagina ' + pagina + ': renderizou sem tela de erro', crashou === false);
  }

  const xss = await cdp.eval('window.__xss');
  check('nenhum payload executou (window.__xss)', xss === undefined, 'xss=' + xss);

  console.log('\n7b. Ferramenta de precos (Ajustes) abre e calcula');
  await cdp.eval("location.hash='settings'");
  await espera(500);
  await cdp.eval("document.querySelector('[data-price-tool]').click()");
  await espera(350);
  check('modal de precos abre',
    (await cdp.eval("!!document.querySelector('.overlay .modal')")) === true);
  const ativos = await cdp.eval("Store.db.products.filter(function(p){return p.active;}).length");
  await cdp.eval("var q=document.querySelector('[name=qtd]'); q.value='10'; q.dispatchEvent(new Event('input',{bubbles:true}));");
  await espera(200);
  const prev = await cdp.eval("(document.querySelector('#pricePreview')||{}).textContent||''");
  check('preview reage ao valor digitado',
    ativos > 0 ? /→/.test(prev) : /Nenhum produto/.test(prev),
    'ativos=' + ativos + ' preview=' + prev);
  await cdp.eval("var b=document.querySelector('.overlay [data-close]'); if(b) b.click();");
  await espera(250);

  /* O payload tem de aparecer como TEXTO -- escapado, nao removido. Se o app
     simplesmente nao mostrasse o campo, o teste de "nenhum elemento" passaria
     sem provar nada. Volta para as telas que exibem o produto e o cliente. */
  let texto = '';
  for (const pagina of ['products', 'pdv', 'customers']) {
    await cdp.eval("location.hash='" + pagina + "'");
    await espera(700);
    texto += ' ' + (await cdp.eval('document.body.innerText'));
  }
  check('o payload aparece como TEXTO (foi escapado, nao removido)',
    texto.includes('<img src=x') || texto.includes('<svg onload'),
    'trecho=' + texto.replace(/\s+/g, ' ').slice(0, 160));

  console.log('\n7c. Preco promocional por produto (cadastro e carrinho)');
  const promo = await cdp.eval("(function(){var p=(Store.db.products||[]).filter(function(x){return x.id==='pxss';})[0]; if(!p) return null; return {vig:!!Store.promoVigente(p), preco:Store.precoVigente(p), promo:p.promoPrice, normal:p.price};})()");
  check('promocao vigente troca o preco pelo promocional',
    !!promo && promo.vig === true && promo.preco === promo.promo,
    JSON.stringify(promo));
  const fora = await cdp.eval("(function(){var p={price:10,promoPrice:3,promoFrom:'2000-01-01',promoTo:'2000-12-31'}; return Store.precoVigente(p)===10 && Store.promoVigente(p)===false;})()");
  check('promocao fora da janela cai no preco normal', fora === true);
  const noCart = await cdp.eval("(function(){PDV.clearSale(); PDV.addProduct('pxss', true); var l=(PDV.cart||[]).filter(function(i){return i.id==='pxss';})[0]; return l?l.price:null;})()");
  check('carrinho do PDV aplica o preco promocional', noCart === 5.5, 'preco=' + noCart);

  console.log('\n7d. Pix por valor parcial com confirmacao de recebimento');
  await cdp.eval("location.hash='pdv'");
  await espera(700);
  check('frente de caixa montou', (await cdp.eval("!!document.getElementById('btnPix')")) === true);
  check('chave Pix configurada chegou do servidor',
    (await cdp.eval("!!(Store.db.config.pix && Store.db.config.pix.pixKey)")) === true);

  /* Carrinho com um item (preco promocional 5,50) e uma parte de Pix digitada
     de 5,00: o QR tem de cobrar a PARTE, nao o total da venda. */
  await cdp.eval("PDV.clearSale(false); PDV.addProduct('pxss', true);");
  await cdp.eval("(function(){var i=document.getElementById('payInput'); i.value='5'; i.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await cdp.eval("document.getElementById('btnPix').click()");
  await espera(450);
  check('QR do Pix renderiza', (await cdp.eval("!!document.querySelector('#pixQrBox svg')")) === true);
  const corpoPix = await cdp.eval("(function(){var b=document.querySelector('.overlay .modal-body'); return b ? b.innerText : '';})()");
  check('QR cobra o valor parcial digitado (R$ 5,00)', corpoPix.includes('5,00'), corpoPix.replace(/\s+/g, ' ').slice(0, 120));
  check('QR nao cobra o total da venda (R$ 5,50)', !corpoPix.includes('5,50'), corpoPix.replace(/\s+/g, ' ').slice(0, 120));

  await cdp.eval("document.getElementById('btnConfirmPix').click()");
  await espera(450);
  const partesTxt = await cdp.eval("document.getElementById('payParts').innerText");
  check('parte de Pix lancada com o valor parcial', partesTxt.includes('5,00'), partesTxt.replace(/\s+/g, ' '));
  check('parte de Pix marcada como recebida', /recebido/i.test(partesTxt), partesTxt.replace(/\s+/g, ' '));
  check('dialogo do Pix fechou', (await cdp.eval("!document.querySelector('.overlay')")) === true);

  /* Dois Pix na mesma venda (duas pessoas pagando): o segundo QR abre e cobra
     o que ainda falta, nao o total de novo. */
  await cdp.eval("document.getElementById('btnPix').click()");
  await espera(400);
  check('segundo Pix abre outro QR',
    (await cdp.eval("!!document.querySelector('#pixQrBox svg')")) === true);
  const corpoPix2 = await cdp.eval("(function(){var b=document.querySelector('.overlay .modal-body'); return b ? b.innerText : '';})()");
  check('segundo QR cobra o restante (R$ 0,50)', corpoPix2.includes('0,50'), corpoPix2.replace(/\s+/g, ' ').slice(0, 120));
  await cdp.eval("document.getElementById('btnConfirmPix').click()");
  await espera(400);
  const doisPix = await cdp.eval("(document.getElementById('payParts').innerText.match(/Pix/g)||[]).length");
  check('duas partes de Pix lancadas', doisPix === 2, 'pix=' + doisPix);

  console.log('\n7e. Versao na tela e painel de prontidao fiscal');
  const versaoApi = await cdp.eval("((API.estado||{}).versao)||''");
  check('servidor reporta a versao', /^\d+\.\d+\.\d+$/.test(versaoApi), 'versao=' + versaoApi);
  await cdp.eval("location.hash='settings'"); await espera(600);
  const subSettings = await cdp.eval("(function(){var p=document.querySelector('.page-head p'); return p?p.textContent:'';})()");
  check('Ajustes mostra a versao', subSettings.indexOf(versaoApi) > -1, subSettings);

  await cdp.eval("location.hash='products'"); await espera(700);
  await cdp.eval("Array.prototype.find.call(document.querySelectorAll('.page-head button'),function(b){return /Fiscal NFC-e/.test(b.textContent);}).click()");
  await espera(400);
  const painelTxt = await cdp.eval("(function(){var m=document.querySelector('.overlay .modal-body'); return m?m.innerText:'';})()");
  check('painel de prontidao fiscal abre', /pendentes/i.test(painelTxt), painelTxt.replace(/\s+/g, ' ').slice(0, 120));
  check('rotulo dos KPI aparece (regressao do kpiEl)', /produtos prontos/i.test(painelTxt), painelTxt.replace(/\s+/g, ' ').slice(0, 80));
  check('produto sem campo fiscal aparece como pendente', /Falta:/.test(painelTxt), painelTxt.replace(/\s+/g, ' ').slice(0, 160));
  await cdp.eval("var b=document.querySelector('[data-defaults]'); if(b) b.click();");
  await espera(400);
  const csosn = await cdp.eval("(Store.db.products.filter(function(p){return p.id==='pxss';})[0]||{}).csosn");
  const cfop = await cdp.eval("(Store.db.products.filter(function(p){return p.id==='pxss';})[0]||{}).cfop");
  check('padroes seguros preenchem CFOP e CSOSN', cfop === '5102' && csosn === '102', 'cfop=' + cfop + ' csosn=' + csosn);

  console.log('\n8. Nenhuma excecao nao tratada na pagina');
  const excecoes = cdp.eventos.filter((e) => e.method === 'Runtime.exceptionThrown');
  check('sem excecao de runtime', excecoes.length === 0,
    excecoes.slice(0, 3).map((e) => JSON.stringify(e.params)).join(' | '));
} catch (e) {
  fail++;
  console.log('  FAIL  excecao no teste: ' + e.message);
} finally {
  if (cdp) cdp.fechar();
  matar(chrome);
  matar(srv);
}

console.log('\n' + '='.repeat(46));
console.log(`  ${ok} passaram, ${fail} falharam`);
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
