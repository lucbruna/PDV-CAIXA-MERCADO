/* Inspeciona um PNG: dimensões e variação de cor na região central (a tela). */
import fs from 'node:fs';
import zlib from 'node:zlib';

function decode(file) {
  const b = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, bd = 0, ct = 0;
  const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    const data = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : 1;
  const stride = w * ch;
  const pixels = Buffer.alloc(h * stride);
  let off = 0;
  const paeth = (a, bb, c) => {
    const pp = a + bb - c, pa = Math.abs(pp - a), pb = Math.abs(pp - bb), pc = Math.abs(pp - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? bb : c;
  };
  for (let y = 0; y < h; y++) {
    const ft = raw[off++];
    for (let x = 0; x < stride; x++) {
      const cur = raw[off++];
      const a = x >= ch ? pixels[y * stride + x - ch] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const ul = y > 0 && x >= ch ? pixels[(y - 1) * stride + x - ch] : 0;
      let v;
      if (ft === 0) v = cur;
      else if (ft === 1) v = cur + a;
      else if (ft === 2) v = cur + up;
      else if (ft === 3) v = cur + ((a + up) >> 1);
      else v = cur + paeth(a, up, ul);
      pixels[y * stride + x] = v & 0xff;
    }
  }
  return { w, h, ch, stride, pixels };
}

for (const file of process.argv.slice(2)) {
  const { w, h, ch, stride, pixels } = decode(file);
  const cores = new Set();
  let min = 255, max = 0;
  const y0 = Math.floor(h * 0.30), y1 = Math.floor(h * 0.70);
  const x0 = Math.floor(w * 0.20), x1 = Math.floor(w * 0.80);
  for (let y = y0; y < y1; y += 3) {
    for (let x = x0; x < x1; x += 3) {
      const i = y * stride + x * ch;
      cores.add((pixels[i] >> 3) + ',' + (pixels[i + 1] >> 3) + ',' + (pixels[i + 2] >> 3));
      const lum = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
      if (lum < min) min = lum;
      if (lum > max) max = lum;
    }
  }
  console.log(file.split(/[\\/]/).pop() + '  ' + w + 'x' + h + '  cores=' + cores.size + '  luminância ' + min + '..' + max);
}
