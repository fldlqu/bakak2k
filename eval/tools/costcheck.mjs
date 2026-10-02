// _costcheck.mjs — 公式が選んだ語列 vs 我々の Viterbi の語列のコストを連接行列で比較
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const K2K = path.resolve(__dirname, '../..');
const { createDict } = await import('../../core/engine.js');
const dict = createDict(fs.readFileSync(path.join(K2K, 'work/aqdic.bin')));
const { MCELL, idx } = await import('./seq.mjs');
const H = (b) => b.toString(16).padStart(2, '0');
const bytes = dict.bytes, u32 = dict.u32, mapOff = dict.mapOff, tokOff = dict.tokOff, tokSize = dict.tokSize;
function recsOf(surface) {
  const e = dict.get(surface); if (!e) return [];
  const rel = u32(mapOff + e[0].id * 4), rel2 = u32(mapOff + (e[0].id + 1) * 4);
  const end = Math.min(tokOff + rel2, tokOff + tokSize);
  const out = []; let p = tokOff + rel;
  while (p + 7 <= end) {
    const flag = bytes[p + 4], mb = bytes[p + 5];
    const mora = mb & 0x1f, extra = (flag === 0x44 || flag === 0x45) ? (flag & 0x0f) - 1 : (flag & 0x0f), len = 7 + mora + extra;
    if (p + len > end) break;
    out.push({ flag: `0x${H(flag)}`, mora, extra, ex: [...bytes.slice(p + 7 + mora, p + len)].map(H).join(' '), pos: bytes[p] | (bytes[p + 1] << 8), cost: bytes[p + 2] | (bytes[p + 3] << 8), acc: bytes[p + 6] & 0x1f });
    p += len;
  }
  return out;
}
const S = process.argv[2] || '入れすぎた';
console.log(`# ${S}`);
for (const w of process.argv.slice(3)) {
  console.log(` ${w}:`);
  recsOf(w).forEach((r, i) => console.log(`   #${i} cost=${r.cost} pos=0x${r.pos.toString(16)}(idx ${idx(r.pos)}) a${r.acc} m${r.mora} flag=${r.flag} ex=[${r.ex}]`));
}
// 我々の分かち書き
const walk = dict.segment(S);
console.log(' 我々:', walk.map((w) => `${w.surface}(${w.reading?.text ?? '?'},c${w.reading?.cost ?? '-'},idx${w.reading?.pos != null ? idx(w.reading.pos) : '-'})`).join(' + '));
let tot = 0; let prev = null;
for (const w of walk) {
  const c = w.reading?.cost ?? 0; tot += c;
  if (prev) { const cv = MCELL(idx(w.reading.pos), idx(prev.reading.pos)); tot += cv; console.log(`   ${prev.surface}->${w.surface} conn=${cv}`); }
  prev = w;
}
console.log(` 我々の合計 = ${tot}`);
