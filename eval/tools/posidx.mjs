// _posidx.mjs — search for the projection of pos that yields exactly 1182 classes
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const K2K = path.resolve(__dirname, '../..');
const { createDict } = await import('../../core/engine.js');
const dict = createDict(fs.readFileSync(path.join(K2K, 'work/aqdic.bin')));
const bytes = dict.bytes, u32 = dict.u32, mapOff = dict.mapOff, tokOff = dict.tokOff, tokSize = dict.tokSize;

const posCount = new Map();
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
    posCount.set(pos, (posCount.get(pos) || 0) + 1);
    p += len;
  }
}
const posList = [...posCount.keys()].sort((a, b) => a - b);
console.log(`distinct pos=${posList.length}`);
const proj = (f) => new Set(posList.map(f)).size;
const cands = {
  'pos & 0x7fff': (p) => p & 0x7fff,
  'pos': (p) => p,
  'pos & 0xff': (p) => p & 0xff,
  'pos >> 8': (p) => p >> 8,
  'pos & 0x0fff': (p) => p & 0x0fff,
  'pos & 0x1fff': (p) => p & 0x1fff,
  'pos & 0x3fff': (p) => p & 0x3fff,
  'pos & 0x7f': (p) => p & 0x7f,
  'pos & 0x7ff': (p) => p & 0x7ff,
  'pos & 0x7fff /2': (p) => (p & 0x7fff) >> 1,
  'pos>>>0': (p) => p,
};
for (const [k, f] of Object.entries(cands)) console.log(`  ${k}: ${proj(f)}`);
// distinct bases and how many collide across the 0x8000 flag
const baseSet = new Set(posList.map((p) => p & 0x7fff));
console.log(`distinct (pos & 0x7fff) = ${baseSet.size}`);
const both = posList.filter((p) => baseSet.has(p) && (p & 0x8000) === 0);
console.log(`non-flag15 pos count=${both.length}`);
// how many base values are used by BOTH flag15 and non-flag15?
const lo = new Set(), hi = new Set();
for (const p of posList) { if (p & 0x8000) hi.add(p & 0x7fff); else lo.add(p & 0x7fff); }
const inter = [...lo].filter((x) => hi.has(x));
console.log(`base used by both = ${inter.length}; only-lo=${[...lo].filter(x=>!hi.has(x)).length}; only-hi=${[...hi].filter(x=>!lo.has(x)).length}`);
console.log('maxBase=', Math.max(...baseSet));
// Check: does the *record count* per pos look like a 品詞? print pos 981's surfaces
const byPos = new Map();
for (const [pos, c] of posCount) byPos.set(pos, c);
console.log('top pos by count:', [...byPos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([p, c]) => `${p}(${c})`).join(' '));
