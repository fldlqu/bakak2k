// seq.mjs — 公式(オラクル)の語列を取得し、我々のコストモデルで公式が argmin になっているか検証
// 用法: node --no-warnings seq.mjs [--n 40]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const K2K = path.resolve(__dirname, '../..');
const { createDict, CODE2KANA } = await import('../../core/engine.js');
const dict = createDict(fs.readFileSync(path.join(K2K, 'work/aqdic.bin')));
const bytes = dict.bytes, u32 = dict.u32, mapOff = dict.mapOff, tokOff = dict.tokOff, tokSize = dict.tokSize;
const { convert, patch, readPatched } = await import('./official_mut.mjs');
const u16 = (o) => bytes[o] | (bytes[o + 1] << 8);
const i16 = (o) => (u16(o) << 16) >> 16;
const MOFF = 0x9650 + 4, W = u16(0x9650);
const MCELL = (r, c) => i16(MOFF + (r * W + c) * 2);
const idx = (pos) => pos & 0x7fff;

function recordsForId(id) {
  const rel = u32(mapOff + id * 4), rel2 = u32(mapOff + (id + 1) * 4);
  const end = Math.min(tokOff + rel2, tokOff + tokSize);
  const out = []; let p = tokOff + rel;
  while (p + 7 <= end) {
    const flag = bytes[p + 4], mb = bytes[p + 5];
    const mora = mb & 0x1f, extra = (flag === 0x44 || flag === 0x45) ? (flag & 0x0f) - 1 : (flag & 0x0f), len = 7 + mora + extra;
    if (p + len > end) break;
    let text = '';
    const isE7 = bytes[p] === 0xe7 && bytes[p + 1] === 0x83;
    const kanaStart = isE7 ? p + len - 1 - mora : p + 7;
    for (let j = 0; j < mora; j++) text += CODE2KANA[bytes[kanaStart + j]] ?? '';
    out.push({ off: p, pos: bytes[p] | (bytes[p + 1] << 8), cost: bytes[p + 2] | (bytes[p + 3] << 8), mora, len, text, flag, kanaOff: kanaStart, isE7 });
    p += len;
  }
  return out;
}

// official record sequence (with surface positions)
export function officialSeq(sent) {
  const base = convert(sent).out;
  const cands = [];
  for (let i = 0; i < sent.length; i++) for (let L = 1; L <= Math.min(dict.maxLen, sent.length - i); L++) {
    const s = sent.slice(i, i + L);
    const e = dict.bySurface.get(s);
    if (e) cands.push({ i, s, id: e[0].id });
  }
  const hits = [];
  for (const c of cands) {
    const recs = recordsForId(c.id);
    for (let ri = 0; ri < recs.length; ri++) {
      const r = recs[ri];
      const orig = readPatched(r.kanaOff, r.mora);
      patch(r.kanaOff, new Uint8Array(r.mora).fill(0x8c)); // ツ
      const out = convert(sent).out;
      patch(r.kanaOff, orig);
      const occ = (out.match(/ツ/g) || []).length - (base.match(/ツ/g) || []).length;
      if (occ > 0) hits.push({ i: c.i, len: c.s.length, surface: c.s, ri, rec: r, n: occ });
    }
  }
  return { base, hits };
}

if (process.argv[1] && process.argv[1].endsWith('seq.mjs')) {
  const sent = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '十年前';
  const { base, hits } = officialSeq(sent);
  console.log(`${sent} => ${base}`);
  for (const h of hits) console.log(`  @${h.i} ${h.surface} #${h.ri} 読=${h.rec.text} pos=0x${h.rec.pos.toString(16)}(idx ${idx(h.rec.pos)}) cost=${h.rec.cost} m${h.rec.mora}`);
}
export { MCELL, idx, recordsForId, W };
