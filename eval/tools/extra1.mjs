// _extra1.mjs — 大規模に TOK1 レコードを走査し、flag/extra の統計を取る
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const K2K = path.resolve(__dirname, '../..');
const { createDict } = await import('../../core/engine.js');
const dict = createDict(fs.readFileSync(path.join(K2K, 'work/aqdic.bin')));
const bytes = dict.bytes, u32 = dict.u32, mapOff = dict.mapOff, tokOff = dict.tokOff, tokSize = dict.tokSize;
const H = (b) => b.toString(16).padStart(2, '0');

const flagHist = new Map();
const flagPos = new Map();   // flag -> Map(pos -> count)
const extraByFlag = new Map(); // flag -> Map(extraPattern -> count)
let nrec = 0;
const n = dict.trie.numKeys();
for (let id = 0; id < n; id++) {
  const rel = u32(mapOff + id * 4), rel2 = u32(mapOff + (id + 1) * 4);
  const end = Math.min(tokOff + rel2, tokOff + tokSize);
  let p = tokOff + rel;
  while (p + 7 <= end) {
    const flag = bytes[p + 4], mb = bytes[p + 5];
    const mora = mb & 0x1f;
    const extra = (flag === 0x44 || flag === 0x45) ? (flag & 0x0f) - 1 : (flag & 0x0f);
    const len = 7 + mora + extra;
    if (p + len > end) break;
    const pos = bytes[p] | (bytes[p + 1] << 8);
    flagHist.set(flag, (flagHist.get(flag) || 0) + 1);
    if (!flagPos.has(flag)) flagPos.set(flag, new Map());
    const fp = flagPos.get(flag); fp.set(pos, (fp.get(pos) || 0) + 1);
    const ex = [...bytes.slice(p + 7 + mora, p + len)];
    const pat = ex.length ? ex.map(H).join(' ') : '(none)';
    if (!extraByFlag.has(flag)) extraByFlag.set(flag, new Map());
    const ep = extraByFlag.get(flag); ep.set(pat, (ep.get(pat) || 0) + 1);
    nrec++;
    p += len;
  }
}
console.log(`keys=${n} records=${nrec}`);
const flags = [...flagHist.keys()].sort((a, b) => a - b);
for (const f of flags) {
  const cnt = flagHist.get(f);
  const posSet = [...flagPos.get(f).entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const pats = [...extraByFlag.get(f).entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log(`flag=0x${H(f)} (bin ${f.toString(2).padStart(8, '0')}) n=${cnt}  topPos=${posSet.map(([p, c]) => p + ':' + c).join(',')}`);
  console.log(`    topExtra=${pats.map(([p, c]) => `[${p}]×${c}`).join('  ')}`);
}
