#!/usr/bin/env node
/* Fonte unica da versao do Sudam Gestao PDV.
 *
 * O arquivo VERSION (uma linha, ex.: 2.0.0) e a verdade. O servidor le dele
 * para responder em /api/status e este helper mantem o instalador em
 * sincronia e ajuda a subir a versao a cada commit.
 *
 *   node versao.mjs              mostra a versao
 *   node versao.mjs sync         reescreve #define AppVersion no instalador.iss
 *   node versao.mjs bump patch   sobe o patch (2.0.0 -> 2.0.1) e sincroniza
 *   node versao.mjs bump minor   sobe o minor (2.0.0 -> 2.1.0)
 *   node versao.mjs bump major   sobe o major (2.0.0 -> 3.0.0)
 *
 * Convencao: cada commit sobe a versao; a tag `vX.Y.Z` marca o commit no
 * GitHub (.github/workflows/versao.yml cria a tag a cada push na main).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = dirname(fileURLToPath(import.meta.url));
const CAMINHO_VERSION = join(raiz, 'VERSION');
const CAMINHO_ISS = join(raiz, 'instalador.iss');

function ler() {
  return readFileSync(CAMINHO_VERSION, 'utf8').trim();
}

function validar(v) {
  if (!/^\d+\.\d+\.\d+$/.test(v)) {
    console.error('Versao invalida em VERSION: "' + v + '". Use MAJOR.MINOR.PATCH.');
    process.exit(1);
  }
  return v;
}

function sincronizar() {
  const v = validar(ler());
  /* O instalador.iss fica fora do git (.gitignore); num clone limpo ele nao
     existe, e isso nao e erro -- so nao ha o que sincronizar. */
  if (!existsSync(CAMINHO_ISS)) {
    console.log('instalador.iss ausente (nao versionado); nada a sincronizar.');
    return v;
  }
  const iss = readFileSync(CAMINHO_ISS, 'utf8');
  const novo = iss.replace(/^#define AppVersion .*$/m, '#define AppVersion "' + v + '"');
  if (novo !== iss) writeFileSync(CAMINHO_ISS, novo);
  console.log('instalador.iss -> AppVersion "' + v + '"');
  return v;
}

function subir(parte) {
  const [a, b, c] = validar(ler()).split('.').map(Number);
  const proxima = parte === 'major' ? (a + 1) + '.0.0'
    : parte === 'minor' ? a + '.' + (b + 1) + '.0'
    : a + '.' + b + '.' + (c + 1);
  writeFileSync(CAMINHO_VERSION, proxima + '\n');
  console.log('VERSION -> ' + proxima);
  sincronizar();
}

const [cmd, arg] = process.argv.slice(2);
if (!cmd) {
  console.log(ler());
} else if (cmd === 'sync') {
  sincronizar();
} else if (cmd === 'bump') {
  if (arg !== 'major' && arg !== 'minor' && arg !== 'patch') {
    console.error('Use: node versao.mjs bump <major|minor|patch>');
    process.exit(1);
  }
  subir(arg);
} else {
  console.error('Comandos: (vazio) | sync | bump <major|minor|patch>');
  process.exit(1);
}
