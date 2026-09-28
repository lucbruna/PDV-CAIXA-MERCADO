import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2]);
const svgPath = path.join(root, 'icone', 'sudam-pdv.svg');
const outPath = path.join(root, 'icone', 'sudam-pdv.ico');
const tmp = 'C:/Users/tomga/AppData/Local/Temp/opencode/ico';

// Tamanhos que o shell do Windows pede em diferentes DPI/escalas.
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
// GDI+ (System.Drawing e afins) nao decodifica PNG dentro de .ico de forma
// confiavel. O formato classico e BMP/DIB, que todos os componentes do Windows
// entendem. PNG so no 256, onde o DIB custaria ~256 KB e o Windows Vista+ ja
// le nativamente.
const PNG_ONLY = new Set([256]);

const svg = fs.readFileSync(svgPath, 'utf8');

const problems = [];
if (!svg.includes('viewBox="0 0 512 512"')) problems.push('viewBox ausente ou errado');
for (const bad of [/<text/i, /<tspan/i, /<image/i, /<foreignObject/i, /<style/i, /url\(['"]?https?:/i, /@font-face/i]) {
  if (bad.test(svg)) problems.push(`elemento proibido: ${bad}`);
}
if (problems.length) { console.error('SVG REPROVADO:\n  ' + problems.join('\n  ')); process.exit(1); }

fs.mkdirSync(tmp, { recursive: true });
const browser = await chromium.launch();

const images = [];
for (const size of SIZES) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><meta charset="utf-8">
     <style>html,body{margin:0;padding:0;background:transparent;width:${size}px;height:${size}px;overflow:hidden}
     svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    { waitUntil: 'load' }
  );
  const png = await page.screenshot({ omitBackground: true, type: 'png' });
  // pixels crus RGBA (top-down) straight do canvas
  const rgba = await page.evaluate(async (size) => {
    const svgText = document.querySelector('svg').outerHTML;
    const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)));
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, size, size);
    return Array.from(x.getImageData(0, 0, size, size).data);
  }, size);
  await page.close();
  images.push({ size, png, rgba: Uint8Array.from(rgba) });
}

/* ---- entrada DIB (BMP de 32 bits dentro do .ico) ----
   BITMAPINFOHEADER com biHeight = 2*altura (XOR + AND mask),
   linhas de baixo para cima, canais BGRA, e a AND mask zerada
   (a transparencia ja vem no canal alfa do XOR). */
function dib(rgba, w, h) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);          // biSize
  header.writeInt32LE(w, 4);            // biWidth
  header.writeInt32LE(h * 2, 8);        // biHeight = imagem + mascara
  header.writeUInt16LE(1, 12);          // biPlanes
  header.writeUInt16LE(32, 14);         // biBitCount
  header.writeUInt32LE(0, 16);          // BI_RGB
  header.writeUInt32LE(w * h * 4, 20);  // biSizeImage

  const xor = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = (h - 1 - y) * w * 4;     // DIB e de baixo para cima
    const dy = y * w * 4;
    for (let x = 0; x < w; x++) {
      const s = sy + x * 4, d = dy + x * 4;
      xor[d + 0] = rgba[s + 2];         // B
      xor[d + 1] = rgba[s + 1];         // G
      xor[d + 2] = rgba[s + 0];         // R
      xor[d + 3] = rgba[s + 3];         // A
    }
  }
  const maskStride = Math.ceil(w / 32) * 4;
  const and = Buffer.alloc(maskStride * h); // zerada: alfa cuida da transparencia
  return Buffer.concat([header, xor, and]);
}
await browser.close();

for (const img of images) {
  img.data = PNG_ONLY.has(img.size) ? img.png : dib(img.rgba, img.size, img.size);
  img.fmt = PNG_ONLY.has(img.size) ? 'PNG' : 'DIB';
  delete img.rgba;
}

const count = images.length;
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(count, 4);

const dir = Buffer.alloc(16 * count);
let offset = 6 + 16 * count;
images.forEach((img, i) => {
  const b = i * 16;
  dir.writeUInt8(img.size >= 256 ? 0 : img.size, b + 0);
  dir.writeUInt8(img.size >= 256 ? 0 : img.size, b + 1);
  dir.writeUInt8(0, b + 2);
  dir.writeUInt8(0, b + 3);
  dir.writeUInt16LE(1, b + 4);
  dir.writeUInt16LE(32, b + 6);
  dir.writeUInt32LE(img.data.length, b + 8);
  dir.writeUInt32LE(offset, b + 12);
  offset += img.data.length;
});

fs.writeFileSync(outPath, Buffer.concat([header, dir, ...images.map(i => i.data)]));
console.log(`ICO gravado: ${outPath} (${fs.statSync(outPath).size} bytes, ${count} tamanhos)`);
for (const i of images) console.log(`  ${String(i.size).padStart(3)}px  ${i.fmt}  ${String(i.data.length).padStart(6)} bytes`);

// ---- leitura de volta ----
const back = fs.readFileSync(outPath);
let bad = 0;
console.log(`\nLeitura: tipo=${back.readUInt16LE(2)} entradas=${back.readUInt16LE(4)}`);
for (let i = 0; i < back.readUInt16LE(4); i++) {
  const b = 6 + i * 16;
  const w = back.readUInt8(b) || 256, h = back.readUInt8(b + 1) || 256;
  const len = back.readUInt32LE(b + 8), off = back.readUInt32LE(b + 12);
  const isPng = back[off] === 0x89 && back[off + 1] === 0x50;
  const wantPng = PNG_ONLY.has(w);
  const expectLen = wantPng ? -1 : 40 + w * h * 4 + Math.ceil(w / 32) * 4 * h;
  const ok = w === h && (wantPng ? isPng : !isPng && len === expectLen) && off + len <= back.length;
  if (!ok) { bad++; console.log(`  ENTRADA ${i} INVALIDA ${w}x${h} fmt=${isPng ? 'PNG' : 'DIB'} len=${len} esperado=${expectLen}`); }
}
console.log(bad === 0 ? `  Todas as ${count} entradas estruturalmente corretas.` : `  ${bad} invalida(s).`);
process.exit(bad === 0 ? 0 : 1);
