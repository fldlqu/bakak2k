// aq_user.dic (user dictionary) reader.
// Format is the same MARISA family as aqdic.bin but wrapped in an HDR1 header:
//   [HDR1][4-byte size=80][80-byte name block]
//   [TRI1][size][marisa-size][marisa data ("We love Marisa.")]
//   [MAP1][size][id -> TOK1 offset table]
//   [TOK1][size][token records]
// Parsing rules mirror tools/aqkuser.mjs which was validated against the SDK.
import { Marisa } from './marisa.js';
import { CODE2KANA } from './kana.js';

function parseTokRecords(rec) {
  const out = [];
  let i = 0;
  const n = rec.length;
  while (i + 7 <= n) {
    if (rec[i] === 0) break;
    const pos = rec[i] | (rec[i + 1] << 8);
    const b2 = rec[i + 2], b3 = rec[i + 3], b4 = rec[i + 4];
    const moraByte = rec[i + 5];
    const accentByte = rec[i + 6];
    const mora = moraByte & 0x7f;
    if (i + 7 + mora > n) break;
    let text = '';
    for (let j = 0; j < mora; j++) {
      const c = rec[i + 7 + j];
      text += CODE2KANA[c] ?? `?${c.toString(16)}`;
    }
    out.push({ pos, text, accent: accentByte - 0x80, mora, raw: [b2, b3, b4] });
    i += 7 + mora;
  }
  return out;
}

// Returns a Map: surface -> [{ text, accent, mora } ...]
export function parseUserDict(bytes) {
  const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const u32 = (o) => dv.getUint32(o, true);
  const HDR = 8 + 80; // 'HDR1' + size word + 80-byte name

  const marisa = new Marisa(d.subarray(HDR + 12, HDR + 12 + u32(HDR + 8)));
  const trie = marisa.trie;

  let o = HDR + 8 + u32(HDR + 4);
  let map = null, tok = null;
  while (o + 8 <= d.length) {
    const magic = String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3]);
    if (!/^[A-Za-z0-9]{4}$/.test(magic)) break;
    const size = u32(o + 4);
    if (magic === 'MAP1') map = new Uint32Array(d.buffer, d.byteOffset + o + 8, size >> 2);
    if (magic === 'TOK1') tok = d.subarray(o + 8, o + 8 + size);
    o += 8 + size;
  }
  if (!map || !tok) throw new Error('aq_user.dic: MAP1/TOK1 section missing');

  const n = trie.numKeys();
  const out = new Map();
  for (let id = 0; id < n; id++) {
    const surface = trie.key(id);
    const off = map[id];
    const end = id + 1 < n ? map[id + 1] : tok.length;
    if (end <= off) continue;
    const records = parseTokRecords(tok.subarray(off, end));
    if (records.length) out.set(surface, records);
  }
  return out;
}