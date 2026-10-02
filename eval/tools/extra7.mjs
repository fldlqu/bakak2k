// _extra7.mjs — 16x16 グリッドで byte -> 核位置 を可視化し、ビット構造を探す
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
  const e = dict.get(surface);
  const rel = u32(mapOff + e[0].id * 4), rel2 = u32(mapOff + (e[0].id + 1) * 4);
  const end = Math.min(tokOff + rel2, tokOff + tokSize);
  const out = []; let p = tokOff + rel;
  while (p + 7 <= end) {
    const flag = bytes[p + 4], mb = bytes[p + 5];
    const mora = mb & 0x1f, extra = (flag === 0x44 || flag === 0x45) ? (flag & 0x0f) - 1 : (flag & 0x0f), len = 7 + mora + extra;
    if (p + len > end) break;
    out.push({ off: p, flag, mora, extra, pos: bytes[p] | (bytes[p + 1] << 8), acc: bytes[p + 6] & 0x1f, exOff: p + 7 + mora });
    p += len;
  }
  return out;
}
// mora position of the nucleus in the phrase (ignoring '/')
function nucPos(kana, reading) {
  const clean = kana.replace(/[。、_+]/g, '');
  const i = clean.indexOf("'");
  if (i < 0) return 0;
  let m = 0;
  for (let k = 0; k < i; k++) if (!'ャュョァィゥェォ'.includes(clean[k])) m++;
  return m;
}
const target = process.argv[2], sent = process.argv[3];
const r = recsOf(target)[0];
const orig = readPatched(r.exOff, r.extra);
console.log(`# ${target} extra=${r.extra} in "${sent}"`);
const grid = [];
for (let v = 0; v < 256; v++) {
  const arr = new Uint8Array(orig); arr[0] = v;
  patch(r.exOff, arr);
  const out = convert(sent).out;
  patch(r.exOff, orig);
  const sep = out.includes('/') || out.includes('+') ? 'S' : '';
  grid[v] = sep + nucPos(out, null);
}
console.log('     ' + Array.from({ length: 16 }, (_, i) => H(i).padStart(3)).join(''));
for (let hi = 0; hi < 16; hi++) {
  let line = `0x${H(hi << 4)}: `;
  for (let lo = 0; lo < 16; lo++) {
    const v = (hi << 4) | lo;
    line += String(grid[v]).padStart(4);
  }
  console.log(line);
}
console.log(`base P = ${nucPos(convert(sent).out)}`);
