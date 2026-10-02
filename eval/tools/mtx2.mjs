// _mtx2.mjs — verify 1182x1182 matrix; correlate pos bytes with matrix indices
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const K2K = path.resolve(__dirname, '../..');
const { createDict } = await import('../../core/engine.js');
const dict = createDict(fs.readFileSync(path.join(K2K, 'work/aqdic.bin')));
const bytes = dict.bytes, u32 = dict.u32, mapOff = dict.mapOff, tokOff = dict.tokOff, tokSize = dict.tokSize;
const u16 = (o) => bytes[o] | (bytes[o + 1] << 8);
const i16 = (o) => (u16(o) << 16) >> 16;

// MTX1 data at 0x9650
const M = 0x9650;
const n1 = u16(M), n2 = u16(M + 2);
console.log(`MTX header: ${n1} x ${n2}  then ${(2794252 - 4) / 2} values (n1*n2=${n1 * n2})`);
const MAT = M + 4;
const cell = (r, c) => i16(MAT + (r * n1 + c) * 2);

// distinct pos values
const posSet = new Map();
let maxLow = 0, maxHigh = 0;
const highHist = new Map();
for (let id = 0; id < dict.trie.numKeys(); id++) {
  const rel = u32(mapOff + id * 4), rel2 = u32(mapOff + (id + 1) * 4);
  const end = Math.min(tokOff + rel2, tokOff + tokSize);
  let p = tokOff + rel;
  while (p + 7 <= end) {
    const flag = bytes[p + 4], mb = bytes[p + 5];
    const mora = mb & 0x1f, extra = (flag === 0x44 || flag === 0x45) ? (flag & 0x0f) - 1 : (flag & 0x0f);
    const len = 7 + mora + extra;
    if (p + len > end) break;
    const pos = bytes[p] | (bytes[p + 1] << 8);
    posSet.set(pos, (posSet.get(pos) || 0) + 1);
    if ((pos & 0xff) > maxLow) maxLow = pos & 0xff;
    if ((pos >> 8) > maxHigh) maxHigh = pos >> 8;
    highHist.set(pos >> 8, (highHist.get(pos >> 8) || 0) + 1);
    p += len;
  }
}
console.log(`distinct pos=${posSet.size}  maxLowByte=${maxLow}  maxHighByte=${maxHigh}`);
console.log('high byte histogram:', [...highHist.entries()].sort((a, b) => b[1] - a[1]).map(([v, c]) => `0x${v.toString(16)}:${c}`).join(' '));
// print the pos values sorted
const ps = [...posSet.keys()].sort((a, b) => a - b);
console.log('some pos values:', ps.filter((x) => x < 2000).slice(0, 60).join(' '));
console.log('count pos<32768:', ps.filter((x) => x < 32768).length, ' >=32768:', ps.filter((x) => x >= 32768).length);
// distribution of the low byte
const lowHist = new Map();
for (const [pos, c] of posSet) lowHist.set(pos & 0xff, (lowHist.get(pos & 0xff) || 0) + c);
console.log(`distinct low bytes=${lowHist.size}  max=${Math.max(...lowHist.keys())}`);
// Sample matrix rows
console.log('matrix row 0 cols 0..9:', Array.from({ length: 10 }, (_, c) => cell(0, c)).join(' '));
console.log('matrix row 1 cols 0..9:', Array.from({ length: 10 }, (_, c) => cell(1, c)).join(' '));
console.log('matrix col 0 rows 0..9:', Array.from({ length: 10 }, (_, r) => cell(r, 0)).join(' '));
