// _extra6.mjs — extra の各バイトを 0..255 全走査し、公式出力のアクセント挙動を写像する
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const K2K = path.resolve(__dirname, '../..');
const { createDict } = await import('../../core/engine.js');
const dict = createDict(fs.readFileSync(path.join(K2K, 'work/aqdic.bin')));
const bytes = dict.bytes, u32 = dict.u32, mapOff = dict.mapOff, tokOff = dict.tokOff, tokSize = dict.tokSize;
const { convert, patch, readPatched } = await import('./official_mut.mjs');
const H = (b) => b.toString(16).padStart(2, '0');
function recsOf(surface) {
  const e = dict.get(surface); if (!e) return [];
  const rel = u32(mapOff + e[0].id * 4), rel2 = u32(mapOff + (e[0].id + 1) * 4);
  const end = Math.min(tokOff + rel2, tokOff + tokSize);
  const out = []; let p = tokOff + rel;
  while (p + 7 <= end) {
    const flag = bytes[p + 4], mb = bytes[p + 5];
    const mora = mb & 0x1f, extra = (flag === 0x44 || flag === 0x45) ? (flag & 0x0f) - 1 : (flag & 0x0f), len = 7 + mora + extra;
    if (p + len > end) break;
    out.push({ off: p, flag, mora, extra, pos: bytes[p] | (bytes[p + 1] << 8), cost: bytes[p + 2] | (bytes[p + 3] << 8), acc: bytes[p + 6] & 0x1f, exOff: p + 7 + mora });
    p += len;
  }
  return out;
}
const target = process.argv[2];
const sents = process.argv.slice(3).filter((a) => !a.startsWith('--'));
const recs = recsOf(target);
console.log(`# ${target}`);
recs.forEach((r, i) => console.log(`  rec#${i} flag=0x${H(r.flag)} ex=[${[...bytes.slice(r.exOff, r.exOff + r.extra)].map(H).join(' ')}] a${r.acc} m${r.mora} pos=0x${r.pos.toString(16)} cost=${r.cost}`));
for (const s of sents) {
  console.log(`\n## ${s}   base=${convert(s).out}`);
  for (let ri = 0; ri < recs.length; ri++) {
    const r = recs[ri];
    if (r.extra === 0) continue;
    const orig = readPatched(r.exOff, r.extra);
    for (let bi = 0; bi < r.extra; bi++) {
      const map = new Map();
      for (let v = 0; v < 256; v++) {
        const arr = new Uint8Array(orig); arr[bi] = v;
        patch(r.exOff, arr);
        const out = convert(s).out;
        patch(r.exOff, orig);
        if (!map.has(out)) map.set(out, []);
        map.get(out).push(v);
      }
      console.log(`  rec#${ri} byte#${bi} (orig 0x${H(orig[bi])}) -> ${map.size} distinct:`);
      for (const [out, vs] of map) console.log(`      ${out.padEnd(22)} ${vs.length > 24 ? `${vs.length} values` : vs.map((v) => H(v)).join(',')}`);
    }
  }
}
