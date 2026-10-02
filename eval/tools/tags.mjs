// _tags.mjs — scan the dictionary for 4-byte ASCII section tags and sizes
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dictPath = path.resolve(__dirname, '../aqdic.bin');
const bytes = new Uint8Array(fs.readFileSync(dictPath));
const u32 = (o) => (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
const isTag = (o) => {
  if (o + 4 > bytes.length) return false;
  for (let i = 0; i < 4; i++) { const c = bytes[o + i]; if (c < 0x30 || c > 0x5a) return false; }
  return true;
};
const tags = [];
for (let o = 0; o + 8 <= bytes.length; o++) {
  if (!isTag(o)) continue;
  const sz = u32(o + 4);
  const t = String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  tags.push({ o, t, sz, end: o + 8 + sz });
}
// keep only those whose end <= next tag offset or file size, and that are "plausible"
for (const x of tags) {
  if (x.sz > bytes.length) continue;
  console.log(`0x${x.o.toString(16).padStart(7, '0')}  ${x.t}  size=${x.sz}  ->next 0x${(x.o + 8 + x.sz).toString(16)}`);
}
