









const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];


function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const root = EXP[i];
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];                    
      next[j + 1] ^= gmul(poly[j], root);    
    }
    poly = next;
  }
  return poly;
}


function rsEncode(data, degree) {
  const gen = rsGenerator(degree);
  const buf = data.concat(new Array(degree).fill(0));
  for (let i = 0; i < data.length; i++) {
    const f = buf[i];
    if (f !== 0) for (let j = 0; j < degree; j++) buf[i + 1 + j] ^= gmul(gen[j + 1], f);
  }
  return buf.slice(data.length);
}



const VERSIONS_L = [
  { v: 1, data: 19, ecc: 7, blocks: 1 }, { v: 2, data: 34, ecc: 10, blocks: 1 },
  { v: 3, data: 55, ecc: 15, blocks: 1 }, { v: 4, data: 80, ecc: 20, blocks: 1 },
  { v: 5, data: 108, ecc: 26, blocks: 1 }, { v: 6, data: 136, ecc: 18, blocks: 2 },
  { v: 7, data: 156, ecc: 20, blocks: 2 }, { v: 8, data: 194, ecc: 24, blocks: 2 },
  { v: 9, data: 232, ecc: 30, blocks: 2 }
];

const ALIGN = { 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46] };


class BitBuf {
  constructor() { this.bytes = []; this.bits = 0; }
  put(value, length) { for (let i = length - 1; i >= 0; i--) this.putBit((value >>> i) & 1); }
  putBit(bit) {
    if (this.bits % 8 === 0) this.bytes.push(0);
    if (bit) this.bytes[this.bytes.length - 1] |= (0x80 >>> (this.bits % 8));
    this.bits++;
  }
}


function makeCodewords(text, spec) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const bb = new BitBuf();
  bb.put(4, 4);                    
  bb.put(bytes.length, 8);         
  for (const b of bytes) bb.put(b, 8);
  const capacityBits = spec.data * 8;
  for (let i = 0; i < 4 && bb.bits < capacityBits; i++) bb.putBit(0); 
  while (bb.bits % 8 !== 0) bb.putBit(0);
  const pads = [0xec, 0x11];
  let pi = 0;
  while (bb.bytes.length < spec.data) bb.bytes.push(pads[pi++ % 2]);
  
  const per = spec.data / spec.blocks;
  const dataBlocks = [], eccBlocks = [];
  for (let b = 0; b < spec.blocks; b++) {
    const blk = bb.bytes.slice(b * per, (b + 1) * per);
    dataBlocks.push(blk);
    eccBlocks.push(rsEncode(blk, spec.ecc));
  }
  const out = [];
  for (let i = 0; i < per; i++) for (const blk of dataBlocks) out.push(blk[i]);
  for (let i = 0; i < spec.ecc; i++) for (const blk of eccBlocks) out.push(blk[i]);
  return out;
}




function buildMatrix(version, codewords) {
  const size = 17 + 4 * version;
  const m = Array.from({ length: size }, () => new Array(size).fill(0));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, v) => { m[y][x] = v ? 1 : 0; fn[y][x] = true; };

  
  const finder = (fx, fy) => {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
      const x = fx + dx, y = fy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const dark = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 &&
        (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      set(x, y, dark ? 1 : 0);
    }
  };
  finder(0, 0); finder(size - 7, 0); finder(0, size - 7);

  
  for (let i = 8; i < size - 8; i++) {
    set(i, 6, i % 2 === 0 ? 1 : 0);
    set(6, i, i % 2 === 0 ? 1 : 0);
  }

  
  const pos = ALIGN[version] || [];
  for (const cy of pos) for (const cx of pos) {
    if ((cx < 9 && cy < 9) || (cx > size - 10 && cy < 9) || (cx < 9 && cy > size - 10)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      set(cx + dx, cy + dy, (Math.abs(dx) === 2 || Math.abs(dy) === 2 || (dx === 0 && dy === 0)) ? 1 : 0);
    }
  }

  
  for (let i = 0; i < 9; i++) { set(i, 8, 0); set(8, i, 0); }
  for (let i = 0; i < 8; i++) { set(size - 1 - i, 8, 0); set(8, size - 1 - i, 0); }
  
  set(8, size - 8, 1);

  
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | (rem & 0xfff);
    for (let i = 0; i < 18; i++) {
      const bit = (bits >>> i) & 1;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      set(a, b, bit);           
      set(b, a, bit);           
    }
  }

  
  
  const totalBits = codewords.length * 8;
  let bitIndex = 0;
  let goingUp = true;
  for (let x = size - 1; x >= 1; x -= 2) {
    if (x === 6) x = 5; 
    for (let vert = 0; vert < size; vert++) {
      const y = goingUp ? size - 1 - vert : vert;
      for (const px of [x, x - 1]) {
        if (!fn[y][px]) {
          m[y][px] = bitIndex < totalBits ? (codewords[bitIndex >> 3] >>> (7 - (bitIndex & 7))) & 1 : 0;
          bitIndex++;
        }
      }
    }
    goingUp = !goingUp;
  }
  return { m, fn };
}


const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
  (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0
];

function penalty(m) {
  const size = m.length;
  let score = 0;
  const runScore = (getter) => {
    let s = 0;
    for (let i = 0; i < size; i++) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        if (getter(i, j) === getter(i, j - 1)) { run++; if (run === 5) s += 3; else if (run > 5) s += 1; }
        else run = 1;
      }
    }
    return s;
  };
  score += runScore((i, j) => m[i][j]);
  score += runScore((i, j) => m[j][i]);
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = m[y][x];
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
  }
  const pat = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const line = (getter) => {
    let s = 0;
    for (let i = 0; i < size; i++) {
      const row = [];
      for (let j = 0; j < size; j++) row.push(getter(i, j));
      for (let j = 0; j + 11 <= size; j++) {
        let m1 = true, m2 = true;
        for (let k = 0; k < 11; k++) {
          if (row[j + k] !== pat[k]) m1 = false;
          if (row[j + k] !== pat2[k]) m2 = false;
        }
        if (m1) s += 40;
        if (m2) s += 40;
      }
    }
    return s;
  };
  score += line((i, j) => m[i][j]);
  score += line((i, j) => m[j][i]);
  let dark = 0;
  for (const row of m) for (const c of row) if (c === 1) dark++;
  const pct = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

function applyMask(matrix, mask) {
  const { m, fn } = matrix;
  const size = m.length;
  const out = m.map(r => r.slice());
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!fn[y][x] && mask(x, y)) out[y][x] ^= 1;
  }
  return out;
}

function placeFormat(m, maskIndex) {
  const size = m.length;
  
  const data = (1 << 3) | maskIndex;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
  const bit = i => (bits >>> i) & 1;
  
  for (let i = 0; i <= 5; i++) m[i][8] = bit(i);
  m[7][8] = bit(6); m[8][8] = bit(7); m[8][7] = bit(8);
  for (let i = 9; i <= 14; i++) m[8][14 - i] = bit(i);
  
  for (let i = 0; i <= 7; i++) m[8][size - 1 - i] = bit(i);
  for (let i = 8; i <= 14; i++) m[size - 15 + i][8] = bit(i);
  m[size - 8][8] = 1; 
}


export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(text);
  const spec = VERSIONS_L.find(s => s.data >= bytes.length + 2);
  if (!spec) throw new Error(`QR payload too long (${bytes.length} bytes; max 232)`);
  const codewords = makeCodewords(text, spec);
  const matrix = buildMatrix(spec.v, codewords);
  let best = null, bestScore = Infinity;
  for (let i = 0; i < 8; i++) {
    const masked = applyMask(matrix, MASKS[i]);
    placeFormat(masked, i);
    const score = penalty(masked);
    if (score < bestScore) { bestScore = score; best = masked; }
  }
  return best;
}

export function qrSvg(text, size = 280) {
  const m = qrMatrix(text);
  const cells = m.length;
  const cs = size / cells;
  const quiet = Math.ceil(cs * 4); 
  const total = size + quiet * 2;
  let rects = "";
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    if (m[y][x] === 1) rects += `<rect x="${(quiet + x * cs).toFixed(2)}" y="${(quiet + y * cs).toFixed(2)}" width="${cs.toFixed(2)}" height="${cs.toFixed(2)}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" class="qr-code" role="img" aria-label="QR code" style="background:#fff;color:#000;border-radius:12px;box-sizing:content-box;width:${total}px;height:${total}px"><rect width="${total}" height="${total}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}


if (typeof module !== "undefined" && module.exports) {
  module.exports = { qrMatrix, qrSvg };
}
