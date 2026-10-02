// _extra2.mjs — flag 0x42/0x43 (可変長 extra) の全レコードを一覧し、extra の意味を探る
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const K2K = path.resolve(__dirname, '../..');
const { createDict, CODE2KANA } = await import('../../core/engine.js');
const dict = createDict(fs.readFileSync(path.join(K2K, 'work/aqdic.bin')));
const bytes = dict.bytes, u32 = dict.u32, mapOff = dict.mapOff, tokOff = dict.tokOff, tokSize = dict.tokSize;
const H = (b) => b.toString(16).padStart(2, '0');
const byFlag = new Map();
for (let id = 0; id < dict.trie.numKeys(); id++) {
  const key = dict.key(id);
  const rel = u32(mapOff + id * 4), rel2 = u32(mapOff + (id + 1) * 4);
  const end = Math.min(tokOff + rel2, tokOff + tokSize);
  let p = tokOff + rel;
  while (p + 7 <= end) {
    const flag = bytes[p + 4], mb = bytes[p + 5];
    const mora = mb & 0x1f, extra = (flag === 0x44 || flag === 0x45) ? (flag & 0x0f) - 1 : (flag & 0x0f), len = 7 + mora + extra;
    if (p + len > end) break;
    const isE7 = bytes[p] === 0xe7 && bytes[p + 1] === 0x83;
    const ks = isE7 ? p + len - 1 - mora : p + 7;
    let text = ''; for (let j = 0; j < mora; j++) text += CODE2KANA[bytes[ks + j]] ?? '';
    const pos = bytes[p] | (bytes[p + 1] << 8), cost = bytes[p + 2] | (bytes[p + 3] << 8), acc = bytes[p + 6] & 0x1f;
    if (flag === 0x42 || flag === 0x43) {
      if (!byFlag.has(flag)) byFlag.set(flag, []);
      byFlag.get(flag).push(`${key} 読=${text} a${acc} m${mora} pos=${pos}(0x${pos.toString(16)}) cost=${cost} ex=[${[...bytes.slice(p + 7 + mora, p + len)].map(H).join(' ')}]${isE7 ? ' E7' : ''}`);
    }
    p += len;
  }
}
for (const f of [0x42, 0x43]) {
  const list = byFlag.get(f) || [];
  console.log(`\n===== flag 0x${H(f)} : ${list.length} records =====`);
  for (const x of list.slice(0, 90)) console.log('  ' + x);
}
