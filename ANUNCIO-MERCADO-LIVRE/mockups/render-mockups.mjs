/*
 * Gera as imagens do anúncio com as telas do PDV dentro de uma moldura de
 * MacBook (estilo usado por vendedores no Mercado Livre).
 *
 * Uso:
 *   node render-mockups.mjs
 *
 * Requer o Chrome instalado. Saída em ../fotos-mockup/*.png (1200x1200).
 * Para apontar para outro Chrome: defina a variável CHROME.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
/* Estilo da moldura:
 *   node render-mockups.mjs            -> MacBook  (fotos-mockup/)
 *   node render-mockups.mjs macos       -> janela de navegador no macOS
 *                                          (fotos-mockup-macos/) */
const estilo = (process.argv[2] || 'macbook').toLowerCase();
const MACOS = estilo === 'macos';
const HTML = path.join(aqui, MACOS ? 'gerar-mockup-macos.html' : 'gerar-mockup.html');
const SAIDA = path.resolve(aqui, '..', MACOS ? 'fotos-mockup-macos' : 'fotos-mockup');

const CHROME = process.env.CHROME
  || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const LARGURA = 1200;
const ALTURA = 1200;

const itens = [
  {
    src: 'fotos/02-frente-de-caixa.png',
    out: 'mockup-01-frente-de-caixa.png',
    t: 'Frente de caixa',
    s: 'Busca, carrinho, pagamentos e troco em uma única tela',
    r: 'Sudam Gestão PDV · programa para Windows'
  },
  {
    src: 'fotos/03-produtos-e-estoque.png',
    out: 'mockup-02-produtos-e-estoque.png',
    t: 'Produtos e estoque',
    s: 'Cadastro, preços, custo, estoque mínimo e validade',
    r: 'Sudam Gestão PDV · programa para Windows'
  },
  {
    src: 'fotos/04-painel-inicial.png',
    out: 'mockup-03-painel-inicial.png',
    t: 'Painel inicial',
    s: 'Resumo do dia e atalhos para toda a operação',
    r: 'Sudam Gestão PDV · programa para Windows'
  },
  {
    src: 'fotos/Captura de tela 2026-09-29 112755.png',
    out: 'mockup-04-tela-extra-1.png',
    r: 'Sudam Gestão PDV · programa para Windows'
  },
  {
    src: 'fotos/Captura de tela 2026-09-29 112909.png',
    out: 'mockup-05-tela-extra-2.png',
    r: 'Sudam Gestão PDV · programa para Windows'
  }
];

if (!fs.existsSync(CHROME)) {
  console.error('Chrome não encontrado em: ' + CHROME);
  console.error('Defina a variável CHROME com o caminho do executável.');
  process.exit(1);
}

fs.mkdirSync(SAIDA, { recursive: true });

const base = pathToFileURL(HTML).href;
let ok = 0;

for (const item of itens) {
  const foto = path.resolve(aqui, '..', item.src);
  if (!fs.existsSync(foto)) {
    console.warn('SKIP (não existe): ' + item.src);
    continue;
  }

  const q = new URLSearchParams();
  q.set('f', pathToFileURL(foto).href);
  if (item.t) q.set('t', item.t);
  if (item.s) q.set('s', item.s);
  if (item.m !== undefined) q.set('m', item.m);
  if (item.r) q.set('r', item.r);
  /* Titulo da janela (so o estilo macOS usa). */
  q.set('j', item.t ? 'Sudam Gestão PDV — ' + item.t : 'Sudam Gestão PDV');

  const destino = path.join(SAIDA, item.out);
  const url = base + '?' + q.toString();

  execFileSync(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--force-device-scale-factor=1',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=4000',
    '--window-size=' + LARGURA + ',' + ALTURA,
    '--screenshot=' + destino,
    url
  ], { stdio: 'pipe', timeout: 90000 });

  const kb = (fs.statSync(destino).size / 1024).toFixed(0);
  console.log('OK  ' + item.out + '  (' + kb + ' KB)');
  ok++;
}

console.log('\n' + ok + ' mockup(s) gerado(s) em ' + SAIDA);
