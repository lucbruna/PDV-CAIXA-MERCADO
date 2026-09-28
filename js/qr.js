/* ==========================================================================
   qr.js — Gerador de QR Code (ISO/IEC 18004) em JavaScript puro.

   Substitui o qrcode-vendor.js, que estava TRUNCADO: o arquivo trazia apenas
   os auxiliares de codificacao de string e NAO os metodos que constroem a
   matriz (addData, make, isDark, createSVGTag). Como o app chamava
   `new global.QRCode(...)`, que nunca existiu, o `if` de guarda nao entrava e
   o Pix caia sempre no "copiar codigo", sem imagem.

   Escopo: nivel M, modo Byte, versao 1..40. Suficiente para BR Code Pix
   (payload de ~150-260 chars) e sem nenhuma dependencia externa.

   Uso:  QR.render(elemento, texto, { tamanho: 220, escuro: '#0d1520' })
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------------- 1. Campo de Galois GF(256), polinômio 0x11D ---------------- */

  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function initGF() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;   /* módulo irreduzível do QR */
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  /* Polinômio gerador de Reed-Solomon para `degree` words de correção. */
  function rsGeneratorPoly(degree) {
    var poly = [1];
    for (var d = 0; d < degree; d++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var i = 0; i < poly.length; i++) {
        next[i] ^= poly[i];
        next[i + 1] ^= gfMul(poly[i], EXP[d]);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    var gen = rsGeneratorPoly(ecLen);
    var res = new Array(ecLen).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ res[0];
      res.shift();
      res.push(0);
      if (factor !== 0) {
        for (var j = 0; j < ecLen; j++) {
          res[j] ^= gfMul(gen[j + 1], factor);
        }
      }
    }
    return res;
  }

  /* ---------------- 2. Capacidade por versão (nível M) ----------------
     [dataCodewords, ecPerBlock, group1Blocks, group1Data, group2Blocks, group2Data]
     Fonte: ISO/IEC 18004, tabela 13/14. */
  var SPEC_M = {
    1:  [16, 10, 1, 16, 0, 0],   2:  [28, 16, 1, 28, 0, 0],   3:  [44, 26, 1, 44, 0, 0],
    4:  [64, 18, 2, 32, 0, 0],   5:  [86, 24, 2, 43, 0, 0],   6:  [108, 16, 4, 27, 0, 0],
    7:  [124, 18, 4, 31, 0, 0],  8:  [154, 22, 2, 38, 2, 39],  9:  [182, 22, 3, 36, 2, 37],
    10: [216, 26, 4, 43, 1, 44],  11: [254, 30, 1, 50, 4, 51], 12: [290, 22, 6, 36, 2, 37],
    13: [334, 22, 8, 37, 1, 38],  14: [365, 24, 4, 40, 5, 41], 15: [415, 24, 5, 41, 5, 42],
    16: [453, 28, 7, 45, 3, 46],  17: [507, 28, 10, 46, 1, 47], 18: [563, 26, 9, 43, 4, 44],
    19: [627, 26, 3, 44, 11, 45], 20: [669, 26, 3, 41, 13, 42], 21: [714, 26, 17, 42, 0, 0],
    22: [782, 28, 17, 46, 0, 0],  23: [860, 28, 4, 47, 14, 48], 24: [914, 28, 6, 45, 14, 46],
    25: [1000, 28, 8, 47, 13, 48],26: [1062, 28, 19, 46, 4, 47],27: [1128, 28, 22, 45, 3, 46],
    28: [1193, 28, 3, 45, 23, 46],29: [1267, 28, 21, 45, 7, 46], 30: [1373, 28, 19, 47, 10, 48],
    31: [1455, 28, 2, 46, 29, 47],32: [1541, 28, 10, 46, 23, 47],33: [1631, 28, 14, 46, 21, 47],
    34: [1725, 28, 14, 46, 23, 47],35: [1812, 28, 12, 47, 26, 48],36: [1914, 28, 6, 47, 34, 48],
    37: [1992, 28, 29, 46, 14, 47],38: [2102, 28, 13, 46, 32, 47],39: [2216, 28, 40, 47, 7, 48],
    40: [2334, 28, 18, 47, 31, 48]
  };

  /* ---------------- 3. Tabelas de versão ---------------- */
  function sizeOf(ver) { return ver * 4 + 17; }

  /* nível de correção em bits (00=M, 01=L, 10=H, 11=Q) */
  var EC_BITS_M = 0;

  var ALIGN_POS = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50], 11: [6, 30, 54],
    12: [6, 32, 58], 13: [6, 34, 62], 14: [6, 26, 46, 66], 15: [6, 26, 48, 70],
    16: [6, 26, 50, 74], 17: [6, 30, 54, 78], 18: [6, 30, 56, 82], 19: [6, 30, 58, 86],
    20: [6, 34, 62, 90], 21: [6, 28, 50, 72, 94], 22: [6, 26, 50, 74, 98],
    23: [6, 30, 54, 78, 102], 24: [6, 28, 54, 80, 106], 25: [6, 32, 58, 84, 110],
    26: [6, 30, 58, 86, 114], 27: [6, 34, 62, 90, 118], 28: [6, 26, 50, 74, 98, 122],
    29: [6, 30, 54, 78, 102, 126], 30: [6, 26, 52, 78, 104, 130], 31: [6, 30, 56, 82, 108, 134],
    32: [6, 34, 60, 86, 112, 138], 33: [6, 30, 58, 86, 114, 142], 34: [6, 34, 62, 90, 118, 146],
    35: [6, 30, 54, 78, 102, 126, 150], 36: [6, 24, 50, 76, 102, 128, 154],
    37: [6, 28, 54, 80, 106, 132, 158], 38: [6, 32, 58, 84, 110, 136, 162],
    39: [6, 26, 54, 82, 110, 138, 166], 40: [6, 30, 58, 86, 114, 142, 170]
  };

  /* Bits de versão (18 bits) para versões 7..40 — pré-computados pela spec. */
  var VERSION_BITS = {};
  (function buildVersionBits() {
    for (var v = 7; v <= 40; v++) {
      var rem = v, bits = 0;
      for (var i = 0; i < 12; i++) { bits = (bits << 1) | ((rem >> i) & 1); }
      var bch = 0x1f25;
      var data = v << 12;
      while (bch << 5 <= data) bch <<= 5;
      VERSION_BITS[v] = ((data | (bch ^ data)) >>> 0) & 0x3ffff;
    }
  })();

  /* ---------------- 4. Montagem dos módulos ---------------- */

  function QrMatrix(ver) {
    this.ver = ver;
    this.size = sizeOf(ver);
    this.mods = [];       /* null = livre, 0/1 = fixo */
    this.reserved = [];
    for (var r = 0; r < this.size; r++) {
      this.mods.push(new Array(this.size).fill(null));
      this.reserved.push(new Array(this.size).fill(false));
    }
  }

  QrMatrix.prototype.set = function (r, c, v) {
    this.mods[r][c] = v;
    this.reserved[r][c] = true;
  };

  QrMatrix.prototype.isFree = function (r, c) { return !this.reserved[r][c]; };

  /* padrões de busca 7x7 nos 3 cantos */
  QrMatrix.prototype.drawFinder = function (r0, c0) {
    for (var dr = -1; dr <= 7; dr++) {
      for (var dc = -1; dc <= 7; dc++) {
        var r = r0 + dr, c = c0 + dc;
        if (r < 0 || c < 0 || r >= this.size || c >= this.size) continue;
        var on = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
                 (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
                 (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
        this.set(r, c, on ? 1 : 0);
      }
    }
  };

  QrMatrix.prototype.drawFunctionPatterns = function () {
    var s = this.size, i;
    /* separadores + padrões de busca */
    this.drawFinder(0, 0);
    this.drawFinder(0, s - 7);
    this.drawFinder(s - 7, 0);
    /* padrões de temporização: linha e coluna 6, de 8 até s-9.
       Inclui (6,8) e (8,6) — são células de temporização válidas; o dark
       module é (s-8,8) e fica em outro lugar. */
    for (i = 8; i < s - 8; i++) {
      var v = (i % 2 === 0) ? 1 : 0;
      this.set(6, i, v);
      this.set(i, 6, v);
    }
    /* padrões de alinhamento */
    var pos = ALIGN_POS[this.ver];
    for (i = 0; i < pos.length; i++) {
      for (var j = 0; j < pos.length; j++) {
        var r = pos[i], c = pos[j];
        /* pula os três cantos ocupados pelos padrões de busca */
        if ((r === 6 && c === 6) || (r === 6 && c === s - 7) || (r === s - 7 && c === 6)) continue;
        this.drawAlign(r, c);
      }
    }
    /* módulo escuro fixo */
    this.set(s - 8, 8, 1);
    /* bits de versão */
    if (this.ver >= 7) {
      var vb = VERSION_BITS[this.ver];
      for (i = 0; i < 18; i++) {
        var bit = (vb >> i) & 1;
        var rr = Math.floor(i / 3), cc = i % 3;
        this.set(rr, this.size - 11 + cc, bit);
        this.set(this.size - 11 + cc, rr, bit);
      }
    }
    this.drawFormatBits(0, 0);
  };

  QrMatrix.prototype.drawAlign = function (r, c) {
    for (var dr = -2; dr <= 2; dr++) {
      for (var dc = -2; dc <= 2; dc++) {
        var on = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
        this.set(r + dr, c + dc, on ? 1 : 0);
      }
    }
  };

  /* BCH(15,5) dos format bits: divisor 0x537, XOR final 0x5412.
     A divisao nao e um numero fixo de voltas: o resto e reduzido ate caber em
     10 bits e quantas voltas sao necessarias depende do valor de entrada.
     Usar "5 voltas" (o tamanho do resto) produz bits diferentes da spec — o
     leitor passa a recusar o QR inteiro. */
  function bchFormat(data) {
    var d = data << 10;
    var b = d;
    while (b > 0x3ff) {
      b ^= 0x537 << (32 - Math.clz32(b) - 11);
    }
    return ((d | (b & 0x3ff)) ^ 0x5412) & 0x7fff;
  }

  QrMatrix.prototype.drawFormatBits = function (mask, err) {
    var bits = bchFormat((err << 3) | mask);

    /* Placement LSB-first da ISO 18004:
         vertical  i<6 -> (i, 8) | i<8 -> (i+1, 8) | resto -> (size-15+i, 8)
         horizontal j<8 -> (8, size-1-j) | resto -> (8, 15-j)
       Ler os bits na ordem contraria produz um QR que nenhum leitor decodifica. */
    var s = this.size, i;
    for (i = 0; i < 15; i++) {
      var v = (bits >> i) & 1;
      if (i < 6) this.set(i, 8, v);
      else if (i < 8) this.set(i + 1, 8, v);
      else this.set(s - 15 + i, 8, v);
    }
    for (i = 0; i < 15; i++) {
      var v2 = (bits >> i) & 1;
      if (i < 8) this.set(8, s - 1 - i, v2);
      else this.set(8, 15 - i, v2);
    }
    /* modulo escuro fixo (nao e format bit) */
    this.set(s - 8, 8, 1);
  };

  /* ---------------- 5. Codificação dos dados ---------------- */

  function toBytes(str) {
    var out = [], i, c;
    /* UTF-8 manual: o payload Pix é ASCII, mas o EMV merchant name pode vir
       com acento e não pode virar lixo. */
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(i + 1);
        var cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        i++;
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  function pickVersion(byteLen) {
    for (var v = 1; v <= 40; v++) {
      var spec = SPEC_M[v];
      var lenBits = v < 10 ? 8 : 16;
      var total = 4 + lenBits + byteLen * 8;
      if (spec[0] * 8 >= total) return v;
    }
    throw new Error('qr.js: payload longo demais para QR (' + byteLen + ' bytes)');
  }

  function buildCodewords(bytes, ver) {
    var spec = SPEC_M[ver];
    var capacityBits = spec[0] * 8;
    var lenBits = ver < 10 ? 8 : 16;
    var bits = [];

    function push(val, n) {
      for (var i = n - 1; i >= 0; i--) bits.push((val >> i) & 1);
    }

    push(0b0100, 4);                  /* modo Byte */
    push(bytes.length, lenBits);
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);

    /* terminador */
    var term = Math.min(4, capacityBits - bits.length);
    push(0, term);
    /* preenche até múltiplo de 8 */
    while (bits.length % 8 !== 0) bits.push(0);
    /* bytes de preenchimento */
    var pad = [0xec, 0x11];
    var pi = 0;
    while (bits.length < capacityBits) { push(pad[pi++ % 2], 8); }

    /* bytes */
    var data = [];
    for (var b = 0; b < bits.length; b += 8) {
      var v = 0;
      for (var k = 0; k < 8; k++) v = (v << 1) | bits[b + k];
      data.push(v);
    }
    return data;
  }

  /* divide em blocos, gera ECC de cada um e intercala */
  function interleave(data, ver) {
    var spec = SPEC_M[ver];
    var ecLen = spec[1];
    var g1b = spec[2], g1d = spec[3], g2b = spec[4], g2d = spec[5];

    var blocks = [], ecBlocks = [], idx = 0, i;
    for (i = 0; i < g1b; i++) {
      var d1 = data.slice(idx, idx + g1d); idx += g1d;
      blocks.push(d1); ecBlocks.push(rsEncode(d1, ecLen));
    }
    for (i = 0; i < g2b; i++) {
      var d2 = data.slice(idx, idx + g2d); idx += g2d;
      blocks.push(d2); ecBlocks.push(rsEncode(d2, ecLen));
    }

    /* interleave de dados */
    var maxD = Math.max(g1d, g2d);
    var out = [];
    for (var col = 0; col < maxD; col++) {
      for (i = 0; i < blocks.length; i++) {
        if (col < blocks[i].length) out.push(blocks[i][col]);
      }
    }
    /* interleave de ECC */
    for (var e = 0; e < ecLen; e++) {
      for (i = 0; i < ecBlocks.length; i++) out.push(ecBlocks[i][e]);
    }
    return out;
  }

  /* ---------------- 6. Posicionamento em zigue-zague + máscara ---------------- */

  QrMatrix.prototype.placeData = function (bytes) {
    var s = this.size;
    var bitIdx = 0, dirUp = true, col, row, r, c;

    for (col = s - 1; col > 0; col -= 2) {
      if (col === 6) col--;             /* pula a coluna de temporização */
      for (var n = 0; n < s; n++) {
        row = dirUp ? s - 1 - n : n;
        for (var k = 0; k < 2; k++) {
          c = col - k;
          if (!this.isFree(row, c)) continue;
          var bit = 0;
          if (bitIdx < bytes.length * 8) {
            bit = (bytes[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
          }
          this.mods[row][c] = bit;
          bitIdx++;
        }
      }
      dirUp = !dirUp;
    }
    void r;
  };

  function maskFn(id, r, c) {
    switch (id) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
  }

  function applyMask(m, reserved, id) {
    for (var r = 0; r < m.size; r++) {
      for (var c = 0; c < m.size; c++) {
        if (reserved[r][c]) continue;
        if (maskFn(id, r, c)) m.mods[r][c] ^= 1;
      }
    }
  }

  /* penalidades da spec (regras 1-4) */
  function penalty(m) {
    var s = m.size, p = 0, r, c, i, run, dark = 0;

    /* regra 1 — 5+ módulos iguais em linha/coluna */
    for (r = 0; r < s; r++) {
      run = 1;
      for (c = 1; c < s; c++) {
        if (m.mods[r][c] === m.mods[r][c - 1]) { run++; }
        else { if (run >= 5) p += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) p += 3 + (run - 5);
    }
    for (c = 0; c < s; c++) {
      run = 1;
      for (r = 1; r < s; r++) {
        if (m.mods[r][c] === m.mods[r - 1][c]) { run++; }
        else { if (run >= 5) p += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) p += 3 + (run - 5);
    }
    /* regra 2 — blocos 2x2 */
    for (r = 0; r < s - 1; r++) {
      for (c = 0; c < s - 1; c++) {
        var v = m.mods[r][c];
        if (v === m.mods[r][c + 1] && v === m.mods[r + 1][c] && v === m.mods[r + 1][c + 1]) p += 3;
      }
    }
    /* regra 3 — padrão 10111010000 */
    var pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    var pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function match(get, n) {
      var a = 0, b = 0;
      for (i = 0; i + 11 <= n; i++) {
        var okA = true, okB = true;
        for (var k = 0; k < 11; k++) {
          var val = get(i + k);
          if (val !== pat1[k]) okA = false;
          if (val !== pat2[k]) okB = false;
        }
        if (okA) a++;
        if (okB) b++;
      }
      return a + b;
    }
    for (r = 0; r < s; r++) {
      (function (rr) {
        p += 40 * match(function (i) { return m.mods[rr][i]; }, s);
      })(r);
    }
    for (c = 0; c < s; c++) {
      (function (cc) {
        p += 40 * match(function (i) { return m.mods[i][cc]; }, s);
      })(c);
    }
    /* regra 4 — desvio de 50% de escuros */
    for (r = 0; r < s; r++) for (c = 0; c < s; c++) if (m.mods[r][c]) dark++;
    var pct = (dark * 100) / (s * s);
    p += 10 * Math.floor(Math.abs(pct - 50) / 5);
    return p;
  }

  /* ---------------- 7. API pública ---------------- */

  function encode(text) {
    var bytes = toBytes(String(text));
    var ver = pickVersion(bytes.length);
    var codewords = interleave(buildCodewords(bytes, ver), ver);

    var best = null, bestPenalty = Infinity, bestMask = 0;
    for (var mask = 0; mask < 8; mask++) {
      var m = new QrMatrix(ver);
      m.drawFunctionPatterns();
      m.placeData(codewords);
      applyMask(m, m.reserved, mask);
      m.drawFormatBits(mask, EC_BITS_M);
      var p = penalty(m);
      if (p < bestPenalty) { bestPenalty = p; best = m; bestMask = mask; }
    }
    return { size: best.size, modules: best.mods, version: ver, mask: bestMask };
  }

  /* Desenha como SVG inline (escala por viewBox, nítido em qualquer tamanho). */
  function toSVG(text, opts) {
    opts = opts || {};
    var dark = opts.escuro || '#0d1520';
    var light = opts.claro || '#ffffff';
    var quiet = opts.quiet == null ? 4 : opts.quiet;
    var qr = encode(text);
    var n = qr.size;
    var dim = n + quiet * 2;

    var rects = [];
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.modules[r][c]) rects.push('M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z');
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim + '" ' +
      'width="' + (opts.tamanho || 220) + '" height="' + (opts.tamanho || 220) + '" ' +
      'shape-rendering="crispEdges" role="img" aria-label="QR Code Pix">' +
      '<rect width="' + dim + '" height="' + dim + '" fill="' + light + '"/>' +
      '<path d="' + rects.join('') + '" fill="' + dark + '"/>' +
      '</svg>';
  }

  /* API para o app: substitui o antigo `new global.QRCode(el, {...})`. */
  function render(el, text, opts) {
    if (!el) return false;
    try {
      el.innerHTML = toSVG(text, opts);
      return true;
    } catch (err) {
      el.innerHTML = '';
      if (global.console) console.error('[qr.js] falha ao gerar QR:', err);
      return false;
    }
  }

  var api = { encode: encode, toSVG: toSVG, render: render, version: '1.0 (ISO/IEC 18004, nivel M)' };

  global.QR = api;
  /* alias legado: o app chamava global.QRCode — mantido para compatibilidade */
  if (!global.QRCode) global.QRCode = { render: render, toSVG: toSVG };

  /* Node (require) e AMD: sem isso, quem chama require('qr.js') recebe {} porque
     o IIFE acima roda com `global` = window, inexistente fora do navegador. */
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof define === 'function' && define.amd) define(function () { return api; });

})(typeof window !== 'undefined' ? window : globalThis);
