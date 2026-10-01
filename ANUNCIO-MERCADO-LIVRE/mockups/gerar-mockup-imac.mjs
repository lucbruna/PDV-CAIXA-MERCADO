/*
 * Gera as imagens do anúncio com as telas do PDV dentro da MESMA moldura e do
 * MESMO fundo da foto de referência "Dashboard PDV no iMac em escritório
 * moderno.png".
 *
 * A foto de referência é a base: só a área útil da tela do iMac é substituída
 * pelas capturas. Assim todas as imagens ficam com moldura, iluminação, pé e
 * mesa idênticos, pixel a pixel.
 *
 * Uso:
 *   node gerar-mockup-imac.mjs
 *
 * Saídas:
 *   ../fotos-imac/            -> 1536x1024 (a foto inteira, sem cortes)
 *   ../fotos-imac-quadrado/   -> 1200x1200 (mesma cena, com fundo estendido)
 *
 * Não usa dependências externas: decodifica e codifica PNG em Node puro.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '..');
const REFERENCIA = path.join(raiz, 'fotos', 'Dashboard PDV no iMac em escritório moderno.png');
const SAIDA = path.join(raiz, 'fotos-imac');
const SAIDA_QUAD = path.join(raiz, 'fotos-imac-quadrado');

/* Área útil da tela do iMac medida na foto de referência (cantos em px).
 * Medido por varredura de borda: preto da moldaga -> luminância > 8. */
const TELA = {
  tl: [262, 54],
  tr: [1303, 53],
  br: [1303, 684],
  bl: [262, 680]
};
const FOLGA = 1; /* px de segurança para não encostar na moldura */

const itens = [
  { src: 'fotos/02-frente-de-caixa.png', out: '01-frente-de-caixa.png' },
  { src: 'fotos/03-produtos-e-estoque.png', out: '02-produtos-e-estoque.png' },
  { src: 'fotos/04-painel-inicial.png', out: '03-painel-inicial.png' },
  { src: 'fotos/Captura de tela 2026-09-29 112755.png', out: '04-tela-extra-1.png' },
  { src: 'fotos/Captura de tela 2026-09-29 112909.png', out: '05-tela-extra-2.png' }
];

/* ---------------------------------------------------------------- PNG I/O */

function decodificarPNG(file) {
  const b = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, prof = null;
  const idat = [], plte = [], trns = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    const data = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error(file + ': profundidade ' + data[8] + ' não suportada');
      prof = data[9];
    } else if (type === 'PLTE') plte.push(Buffer.from(data));
    else if (type === 'tRNS') trns.push(Buffer.from(data));
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const canais = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[prof];
  if (!canais) throw new Error(file + ': tipo de cor ' + prof + ' não suportado');
  const bpp = canais;
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  let off = 0;
  const paeth = (a, b2, c) => {
    const pp = a + b2 - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b2), pc = Math.abs(pp - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b2 : c;
  };
  for (let y = 0; y < h; y++) {
    const ft = raw[off++];
    for (let x = 0; x < stride; x++) {
      const cur = raw[off++];
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const up = y > 0 ? px[(y - 1) * stride + x] : 0;
      const ul = y > 0 && x >= bpp ? px[(y - 1) * stride + x - bpp] : 0;
      let v;
      if (ft === 0) v = cur;
      else if (ft === 1) v = cur + a;
      else if (ft === 2) v = cur + up;
      else if (ft === 3) v = cur + ((a + up) >> 1);
      else if (ft === 4) v = cur + paeth(a, up, ul);
      else throw new Error(file + ': filtro ' + ft + ' desconhecido');
      px[y * stride + x] = v & 0xff;
    }
  }
  /* converte para RGB de 8 bits */
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0, n = w * h; i < n; i++) {
    let r, g, bl;
    if (prof === 3) {
      const idx = px[i];
      const pal = plte[0] || Buffer.alloc(3);
      r = pal[idx * 3]; g = pal[idx * 3 + 1]; bl = pal[idx * 3 + 2];
    } else if (canais >= 3) {
      r = px[i * bpp]; g = px[i * bpp + 1]; bl = px[i * bpp + 2];
    } else {
      r = g = bl = px[i * bpp];
    }
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = bl;
  }
  return { w, h, rgb };
}

let tabelaCRC = null;
function crc32(buf) {
  if (!tabelaCRC) {
    tabelaCRC = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabelaCRC[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = tabelaCRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function bloco(tipo, dados) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dados.length, 0);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo), 0);
  return Buffer.concat([len, corpo, crc]);
}

function codificarPNG(w, h, rgb) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1);
    raw[o] = y === 0 ? 0 : 2; /* linha 0 sem filtro, demais "Up" */
    const cur = y * stride, ant = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      raw[o + 1 + x] = y === 0 ? rgb[cur + x] : (rgb[cur + x] - rgb[ant + x]) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr),
    bloco('IDAT', zlib.deflateSync(raw, { level: 9 })),
    bloco('IEND', Buffer.alloc(0))
  ]);
}

/* ------------------------------------------------------------ homografia */

function resolver8(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    if (Math.abs(A[p][i]) < 1e-12) throw new Error('sistema singular');
    [A[i], A[p]] = [A[p], A[i]];
    [b[i], b[p]] = [b[p], b[i]];
    for (let k = i + 1; k < n; k++) {
      const f = A[k][i] / A[i][i];
      for (let j = i; j < n; j++) A[k][j] -= f * A[i][j];
      b[k] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
    x[i] = s / A[i][i];
  }
  return x;
}

/* H que leva src -> dst com quatro correspondências. */
function homografia(pares) {
  const A = [], b = [];
  for (const [sx, sy, dx, dy] of pares) {
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]); b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]); b.push(dy);
  }
  const h = resolver8(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/* ---------------------------------------------------------- composição */

const clamp = (v, a, b2) => v < a ? a : v > b2 ? b2 : v;

function amostrarBilinear(img, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const xa = clamp(x0, 0, img.w - 1), xb = clamp(x0 + 1, 0, img.w - 1);
  const ya = clamp(y0, 0, img.h - 1), yb = clamp(y0 + 1, 0, img.h - 1);
  const i00 = (ya * img.w + xa) * 3, i10 = (ya * img.w + xb) * 3;
  const i01 = (yb * img.w + xa) * 3, i11 = (yb * img.w + xb) * 3;
  const r = [];
  for (let c = 0; c < 3; c++) {
    const a = img.rgb[i00 + c] * (1 - fx) + img.rgb[i10 + c] * fx;
    const d = img.rgb[i01 + c] * (1 - fx) + img.rgb[i11 + c] * fx;
    r[c] = a * (1 - fy) + d * fy;
  }
  return r;
}

/* Insere `tela` na área da tela do iMac de `base`.
 * Devolve o retângulo colado (para conferência). */
function colarNaTela(base, tela, quad) {
  const tl = [quad.tl[0] + FOLGA, quad.tl[1] + FOLGA];
  const tr = [quad.tr[0] - FOLGA, quad.tr[1] + FOLGA];
  const br = [quad.br[0] - FOLGA, quad.br[1] - FOLGA];
  const bl = [quad.bl[0] + FOLGA, quad.bl[1] - FOLGA];
  const W = ((tr[0] - tl[0]) + (br[0] - bl[0])) / 2;
  const H = ((br[1] - tr[1]) + (bl[1] - tl[1])) / 2;
  const cx = (tl[0] + tr[0] + br[0] + bl[0]) / 4;
  const cy = (tl[1] + tr[1] + br[1] + bl[1]) / 4;

  const escalaCobrir = Math.max(W / tela.w, H / tela.h);
  const escalaConter = Math.min(W / tela.w, H / tela.h);
  /* quanto da captura é cortado ao preencher a tela inteira */
  const corteX = Math.max(0, 1 - W / (escalaCobrir * tela.w));
  const corteY = Math.max(0, 1 - H / (escalaCobrir * tela.h));
  const corte = Math.max(corteX, corteY);
  /* "cobre" só quando o corte é imperceptível (<= 4%); caso contrário mantém a
   * tela inteira e deixa a faixa restante da foto original (fundo da tela). */
  const cobre = corte <= 0.04;
  const esc = cobre ? escalaCobrir : escalaConter;
  const dw = tela.w * esc, dh = tela.h * esc;

  const x0 = cx - dw / 2, y0 = cy - dh / 2;
  const pares = [
    [0, 0, x0, y0],
    [tela.w, 0, x0 + dw, y0],
    [tela.w, tela.h, x0 + dw, y0 + dh],
    [0, tela.h, x0, y0 + dh]
  ];
  const Hinv = homografia(pares.map(([sx, sy, dx, dy]) => [dx, dy, sx, sy]));

  /* área realmente pintada: ao preencher, é a tela inteira; ao manter a
   * captura inteira, é o retângulo centralizado dentro da tela. */
  const area = cobre
    ? { x0: cx - W / 2, y0: cy - H / 2, x1: cx + W / 2, y1: cy + H / 2 }
    : { x0, y0, x1: x0 + dw, y1: y0 + dh };
  const aw = area.x1 - area.x0, ah = area.y1 - area.y0;

  /* teste de ponto dentro do quad (para nunca pintar a moldura) */
  const dentroQuad = (X, Y) => {
    const c = [[tl[0], tl[1]], [tr[0], tr[1]], [br[0], br[1]], [bl[0], bl[1]]];
    let dentro = true;
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = c[i], [bx, by] = c[(i + 1) % 4];
      const cr = (bx - ax) * (Y - ay) - (by - ay) * (X - ax);
      if (cr < -0.01) dentro = false;
    }
    return dentro;
  };

  const ix0 = Math.floor(area.x0) - 1, iy0 = Math.floor(area.y0) - 1;
  const ix1 = Math.ceil(area.x1) + 1, iy1 = Math.ceil(area.y1) + 1;
  let pintados = 0;
  for (let py = iy0; py <= iy1; py++) {
    for (let px = ix0; px <= ix1; px++) {
      const X = px + 0.5, Y = py + 0.5;
      if (!dentroQuad(X, Y)) continue;
      const den = Hinv[6] * X + Hinv[7] * Y + Hinv[8];
      const sx = (Hinv[0] * X + Hinv[1] * Y + Hinv[2]) / den;
      const sy = (Hinv[3] * X + Hinv[4] * Y + Hinv[5]) / den;
      if (sx < 0 || sy < 0 || sx > tela.w - 1 || sy > tela.h - 1) continue;
      pintados++;

      const [r, g, b] = amostrarBilinear(tela, sx, sy);

      /* efeito de vidro: sombra na borda da tela + reflexo suave no alto à
       * esquerda + leve escurecimento do ambiente. */
      const u = (px - area.x0) / aw, v = (py - area.y0) / ah;
      const borda = Math.min(Math.min(u, 1 - u) * aw, Math.min(v, 1 - v) * ah);
      const e = clamp(borda / 11, 0, 1);
      const k = 0.94 * (0.72 + 0.28 * e * e);
      const gl = 15 * (1 - u) * (1 - v) * e;
      const i = (py * base.w + px) * 3;
      base.rgb[i] = clamp(r * k * 0.995 + gl, 0, 255);
      base.rgb[i + 1] = clamp(g * k + gl * 0.98, 0, 255);
      base.rgb[i + 2] = clamp(b * k * 1.02 + gl * 1.12, 0, 255);
    }
  }
  return {
    x0: Math.round(area.x0), y0: Math.round(area.y0),
    x1: Math.round(area.x1), y1: Math.round(area.y1),
    pintados, cobre, corte: (corte * 100).toFixed(1) + '%',
    faixaV: Math.max(0, (H - dh) / 2).toFixed(0), faixaH: Math.max(0, (W - dw) / 2).toFixed(0)
  };
}

/* ------------------------------------------- variante quadrada 1200x1200 */

function reduzir(img, w, h) {
  const out = Buffer.alloc(w * h * 3);
  const sx = img.w / w, sy = img.h / h;
  for (let y = 0; y < h; y++) {
    const cy = (y + 0.5) * sy - 0.5;
    for (let x = 0; x < w; x++) {
      const c = amostrarBilinear(img, clamp((x + 0.5) * sx - 0.5, 0, img.w - 1), clamp(cy, 0, img.h - 1));
      const i = (y * w + x) * 3;
      out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2];
    }
  }
  return { w, h, rgb: out };
}

/* Estende o fundo para cima e para baixo com um degradê sem costura, para
 * manter a cena inteira num quadro quadrado. */
function quadrado(img, L) {
  const w = img.w, h = img.h, out = Buffer.alloc(L * L * 3);
  for (let y = 0; y < L; y++) {
    const dentro = y >= (L - h) / 2 && y < (L - h) / 2 + h;
    for (let x = 0; x < L; x++) {
      let r, g, b;
      if (dentro) {
        const i = ((y - ((L - h) / 2)) * w + x) * 3;
        r = img.rgb[i]; g = img.rgb[i + 1]; b = img.rgb[i + 2];
      } else {
        /* cor da faixa = média das 24 linhas da borda, misturada até a emenda */
        const topo = y < (L - h) / 2;
        const base = topo ? h - 1 : 0;
        const faixa = topo ? 0 : h - 1;
        let mr = 0, mg = 0, mb = 0, n = 0;
        for (let d = 0; d < 24; d++) {
          const yy = topo ? base - d : faixa + d;
          const i = (clamp(yy, 0, h - 1) * w + x) * 3;
          mr += img.rgb[i]; mg += img.rgb[i + 1]; mb += img.rgb[i + 2]; n++;
        }
        const dist = topo ? ((L - h) / 2 - y) : (y - ((L - h) / 2 + h - 1));
        const t = clamp(1 - dist / ((L - h) / 2), 0, 1);
        const i = ((topo ? 0 : h - 1) * w + x) * 3;
        r = (mr / n) * (1 - t) + img.rgb[i] * t;
        g = (mg / n) * (1 - t) + img.rgb[i + 1] * t;
        b = (mb / n) * (1 - t) + img.rgb[i + 2] * t;
      }
      const o = (y * L + x) * 3;
      out[o] = r; out[o + 1] = g; out[o + 2] = b;
    }
  }
  return { w: L, h: L, rgb: out };
}

/* --------------------------------------------------------------- main */

if (!fs.existsSync(REFERENCIA)) {
  console.error('Foto de referência não encontrada: ' + REFERENCIA);
  process.exit(1);
}
fs.mkdirSync(SAIDA, { recursive: true });
fs.mkdirSync(SAIDA_QUAD, { recursive: true });

const base = decodificarPNG(REFERENCIA);
console.log('referência ' + base.w + 'x' + base.h);
console.log('tela do iMac: ' + JSON.stringify(TELA));
console.log('');

let ok = 0;
for (const item of itens) {
  const arquivo = path.join(raiz, item.src);
  if (!fs.existsSync(arquivo)) { console.warn('SKIP (não existe): ' + item.src); continue; }
  const tela = decodificarPNG(arquivo);

  /* cópia da referência para não alterar a base entre itens */
  const img = { w: base.w, h: base.h, rgb: Buffer.from(base.rgb) };
  const info = colarNaTela(img, tela, TELA);

  const destino = path.join(SAIDA, item.out);
  fs.writeFileSync(destino, codificarPNG(img.w, img.h, img.rgb));
  const kb = (fs.statSync(destino).size / 1024).toFixed(0);

  const q = quadrado(reduzir(img, 1200, Math.round(1200 * img.h / img.w)), 1200);
  const destinoQ = path.join(SAIDA_QUAD, item.out);
  fs.writeFileSync(destinoQ, codificarPNG(q.w, q.h, q.rgb));

  console.log(
    'OK  ' + item.out.padEnd(30) +
    ' captura ' + tela.w + 'x' + tela.h +
    '  colado ' + (info.x1 - info.x0) + 'x' + (info.y1 - info.y0) + ' px (' + info.pintados + ' pixels)' +
    '  ' + (info.cobre ? 'preenche a tela (corte ' + info.corte + ')' : 'tela inteira (faixas ' + info.faixaV + 'px vert / ' + info.faixaH + 'px lat)') +
    '  ' + kb + ' KB'
  );
  ok++;
}
console.log('\n' + ok + ' imagem(ns) gerada(s).');
console.log('  ' + SAIDA);
console.log('  ' + SAIDA_QUAD);