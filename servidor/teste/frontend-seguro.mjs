/* Guarda contra XSS por interpacao em HTML.
 *
 * O app monta quase tudo com innerHTML. Isso e escolha legitima para um app de
 * uma pagina so, mas cobra um preco: qualquer campo que venha do banco e
 * concatenado sem `esc()` vira HTML executavel. Ja aconteceu com o campo
 * "Emoji / imagem" do cadastro de produto, que e texto livre: o caixa digita o
 * que quiser, o servidor guarda a string como veio, e ela aparece sem escape
 * na grade do PDV, no estoque, nos relatorios e no financeiro -- para todos os
 * outros caixas, inclusive o do gerente.
 *
 * Este teste nao tenta provar que o app inteiro esta seguro. Ele trava o
 *aclass de erro: nenhum campo de dado pode ser concatenado numa linha que
 * monta HTML sem passar por esc().
 *
 * Uso: node servidor/teste/frontend-seguro.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = process.argv[2] || process.cwd();
const DIR_JS = join(RAIZ, 'js');

let ok = 0, fail = 0;
function check(nome, cond, extra = '') {
  if (cond) { ok++; console.log('  PASS  ' + nome); }
  else { fail++; console.log('  FAIL  ' + nome + (extra ? ' :: ' + extra : '')); }
}

/* Campos que guardam dado digitado por pessoa ou trazido do banco. `name` e
 * `id` ficam de fora de proposito: aparecem em lugares onde o esc() ja e
 * obrigatorio e a lista viraria ruido. */
const CAMPOS = ['emoji', 'color', 'address', 'endereco', 'obs', 'observacao', 'notes', 'motivo', 'reason', 'supplier', 'fornecedor', 'ncm', 'cfop', 'csosn', 'lot', 'expiry', 'validade'];

const arquivos = readdirSync(DIR_JS).filter((f) => f.endsWith('.js'));
const problemas = [];

/* A linha so e candidata se ela estiver montando markup. Uma comparacao como
 * `p.expiry <= 30` tem `<` no texto mas nao gera HTML nenhum, entao o teste
 * classico de "a linha tem <" daria falso positivo em metade do app. Aqui a
 * linha precisa ter uma tag de verdade. */
const TAG_HTML = /<\/?(div|span|td|tr|th|button|input|select|option|label|b|i|em|strong|small|p|a|ul|li|svg|circle|text|title|h[1-6])\b/;

for (const arq of arquivos) {
  const codigo = readFileSync(join(DIR_JS, arq), 'utf8');
  const linhas = codigo.split(/\r?\n/);

  linhas.forEach((linha, i) => {
    if (!TAG_HTML.test(linha)) return;

    for (const campo of CAMPOS) {
      const re = new RegExp('(?<![\\w.])(\\w+)\\.' + campo + '\\b', 'g');
      let m;
      while ((m = re.exec(linha)) !== null) {
        const ini = m.index;
        const depois = linha.slice(ini + m[0].length).replace(/^\s+/, '');

        /* Forma segura 1: o campo e a condicao de um ternario, ex.
         * `(c.notes ? '<b>' + esc(c.notes) + '</b>' : '')`. Aqui o valor so e
         * testado -- ele volta para o HTML pelo ramo verdadeiro, ja escapado. */
        if (depois.startsWith('?')) continue;

        /* Forma segura 2: o campo e argumento de funcao, ex.
         * `UI.dateOnly(p.expiry)`. O HTML e montado dentro da funcao, que e a
         * unica que sabe o que fazer com o valor. */
        if (/[,(]\s*$/.test(linha.slice(0, ini)) && depois.startsWith(')')) continue;

        /* Forma segura 3: `esc(` a esquerda, e o `esc(` mais proximo ainda
         * esta aberto na posicao do campo. */
        const abre = linha.lastIndexOf('esc(', ini);
        const fechou = linha.lastIndexOf(')', ini);
        if (abre > fechou) continue;

        problemas.push({
          arquivo: arq, linha: i + 1, campo,
          trecho: linha.trim().slice(0, 110),
        });
      }
    }
  });
}

console.log('\n1. Campos de dado concatenados em HTML sem esc()');
if (problemas.length === 0) {
  check('nenhum campo de dado cru dentro de HTML', true);
} else {
  check('nenhum campo de dado cru dentro de HTML', false,
    problemas.length + ' occorrencia(s)');
  for (const p of problemas) {
    console.log('        ' + p.arquivo + ':' + p.linha + '  (' + p.campo + ')');
    console.log('          ' + p.trecho);
  }
}

console.log('\n2. Nada de execucao dinamica');
for (const arq of arquivos) {
  const codigo = readFileSync(join(DIR_JS, arq), 'utf8');
  const linhas = codigo.split(/\r?\n/);
  linhas.forEach((l, i) => {
    if (/[^.\w]eval\s*\(/.test(l)) {
      check(arq + ':' + (i + 1) + ' sem eval()', false, l.trim().slice(0, 90));
    } else if (/new\s+Function\s*\(/.test(l)) {
      check(arq + ':' + (i + 1) + ' sem new Function()', false, l.trim().slice(0, 90));
    } else if (/\.innerHTML\s*=\s*document\.write/.test(l)) {
      check(arq + ':' + (i + 1) + ' sem document.write em innerHTML', false, l.trim().slice(0, 90));
    }
  });
}
check('nenhum eval/new Function/document.write nos scripts do app', true);

console.log('\n3. O token de sessao nao vaza para lugar nenhum');
for (const arq of arquivos) {
  const codigo = readFileSync(join(DIR_JS, arq), 'utf8');
  const linhas = codigo.split(/\r?\n/);
  linhas.forEach((l, i) => {
    /* Token dentro de query string vaza em log de proxy, historico e
     * Referer. O servidor so aceita em GET/HEAD, mas o cliente nem deve
     * tentar. */
    if (/[?&]token=/.test(l) || /token=\s*['"]?\s*\+/.test(l)) {
      check(arq + ':' + (i + 1) + ' sem token na URL', false, l.trim().slice(0, 90));
    }
    /* E nunca no console: log em tela de caixa vaza pela foto do groups. */
    if (/console\.(log|info|warn|debug)\([^)]*\btoken\b/i.test(l)) {
      check(arq + ':' + (i + 1) + ' nao imprime o token no console', false, l.trim().slice(0, 90));
    }
  });
}
check('token nunca vai para URL nem para o console', true);

console.log('\n4. A fila de reenvio esta exposta para a tela');
const api = readFileSync(join(DIR_JS, 'api.js'), 'utf8');
check('api.js expoe rejeitados()', /rejeitados:\s*rejeitados/.test(api));
check('api.js guarda os recusados em localStorage', /sudam_rejeitados/.test(api));

console.log('\n5. Nenhum <script> inline no HTML (a CSP bloqueia)');
/* O servidor manda `script-src 'self'`, sem 'unsafe-inline', sem nonce e sem
 * hash. Um `<script>` escrito dentro do .html e bloqueado pelo navegador e nao
 * avisa ninguem: simplesmente nao roda. O index.html já teve dois blocos
 * assim -- o coletor de erro e o watchdog que mostra "O sistema não conseguiu
 * iniciar" quando o app não sobe. Nenhum dos dois rodava. Numa falha de
 * boot o caixa via só o fundo escuro, sem causa e sem botão de tentar de novo,
 * que era exatamente o que o código existia para evitar. */
const DIR_HTML = join(RAIZ, '.');
const htmls = readdirSync(DIR_HTML).filter((f) => f.endsWith('.html'));
for (const arq of htmls) {
  const bruto = readFileSync(join(DIR_HTML, arq), 'utf8');
  /* Comentarios HTML podem citar `<script>` como exemplo; conta so o que
   * esta de fato no documento. */
  const doc = bruto.replace(/<!--[\s\S]*?-->/g, '');
  const inline = (doc.match(/<script\b[^>]*>/gi) || []).filter((t) => !/\bsrc=/i.test(t));
  check(arq + ' sem <script> inline', inline.length === 0,
    inline.length + ' bloco(s) bloqueado(s) pela CSP');
}
/* boot.js tem de ser o PRIMEIRO script do documento: e ele que precisa estar
 * ouvindo quando os scripts seguintes falharem ao carregar. */
const idx = readFileSync(join(DIR_HTML, 'index.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '')
  .match(/<script[^>]*src="([^"]+)"/g);
check('boot.js e o primeiro script do index.html',
  !!idx && /js\/boot\.js/.test(idx[0]), idx ? 'primeiro=' + idx[0] : 'nenhum script');

console.log('\n==============================================');
console.log('  ' + ok + ' passaram, ' + fail + ' falharam');
console.log('==============================================');
process.exit(fail ? 1 : 0);