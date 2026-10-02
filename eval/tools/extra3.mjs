// _extra3.mjs — extra バイトは公式の出力に影響するか? 全 flag0x41/42/43 の extra を書き換えて比較
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const K2K = path.resolve(__dirname, '../..');
const { createDict } = await import('../../core/engine.js');
const dict = createDict(fs.readFileSync(path.join(K2K, 'work/aqdic.bin')));
const bytes = dict.bytes, u32 = dict.u32, mapOff = dict.mapOff, tokOff = dict.tokOff, tokSize = dict.tokSize;
const { convert, patch, readPatched } = await import('./official_mut.mjs');

// collect extra byte spans
const spans = [];
for (let id = 0; id < dict.trie.numKeys(); id++) {
  const rel = u32(mapOff + id * 4), rel2 = u32(mapOff + (id + 1) * 4);
  const end = Math.min(tokOff + rel2, tokOff + tokSize);
  let p = tokOff + rel;
  while (p + 7 <= end) {
    const flag = bytes[p + 4], mb = bytes[p + 5];
    const mora = mb & 0x1f, extra = (flag === 0x44 || flag === 0x45) ? (flag & 0x0f) - 1 : (flag & 0x0f), len = 7 + mora + extra;
    if (p + len > end) break;
    if (extra > 0) spans.push({ off: p + 7 + mora, n: extra, flag });
    p += len;
  }
}
console.log(`extra spans: ${spans.length}`);
const sents = fs.readFileSync(path.join(K2K, 'eval/corpus_dev140.txt'), 'utf8').split('\n').filter(Boolean)
  .concat(fs.readFileSync(path.join(K2K, 'eval/corpus_holdout87.txt'), 'utf8').split('\n').filter(Boolean));
const base = sents.map((s) => convert(s).out);
// overwrite every extra byte with 0xff
for (const sp of spans) patch(sp.off, new Uint8Array(sp.n).fill(0xff));
const after = sents.map((s) => convert(s).out);
let diff = 0;
for (let i = 0; i < sents.length; i++) if (base[i] !== after[i]) { diff++; if (diff <= 8) console.log(`CHANGED: ${sents[i]}\n  base: ${base[i]}\n  ff  : ${after[i]}`); }
console.log(`\nextra bytes -> 0xff : ${diff}/${sents.length} 文が変化`);
// restore
for (const sp of spans) patch(sp.off, new Uint8Array(sp.n).fill(0x00));
const zeros = sents.map((s) => convert(s).out);
let d2 = 0; for (let i = 0; i < sents.length; i++) if (base[i] !== zeros[i]) d2++;
console.log(`extra bytes -> 0x00 : ${d2}/${sents.length} 文が変化`);
for (const sp of spans) patch(sp.off, new Uint8Array(sp.n).fill(0xff));
const allf = sents.map((s) => convert(s).out);
console.log(`(sanity) restore-all-to-0xff count diff = ${allf.filter((x, i) => x !== after[i]).length}`);
