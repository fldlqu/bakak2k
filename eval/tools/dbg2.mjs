import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { createDict } = await import('../../core/engine.js');
const dict = createDict(fs.readFileSync(path.resolve(__dirname, '../aqdic.bin')));
const bytes = dict.bytes, u32 = dict.u32, mapOff = dict.mapOff, tokOff = dict.tokOff, tokSize = dict.tokSize;
const H = (b) => b.toString(16).padStart(2, '0');
for (const w of ['度', '年']) {
  const e = dict.get(w);
  console.log(`\n=== ${w} ===`);
  for (const ent of e) {
    const rel = u32(mapOff + ent.id * 4), rel2 = u32(mapOff + (ent.id + 1) * 4);
    console.log(` id=${ent.id} rel=${rel} rel2=${rel2} len=${rel2 - rel} end=${tokOff + rel2}`);
    let p = tokOff + rel;
    while (p + 7 <= tokOff + rel2) {
      const flag = bytes[p + 4], mb = bytes[p + 5];
      const mora = mb & 0x1f, extra = flag & 0x0f, len = 7 + mora + extra;
      console.log(`   p-tokOff=${p - tokOff} flag=0x${H(flag)} mb=0x${H(mb)} mora=${mora} extra=${extra} len=${len} need=${p + len - tokOff - rel2}`);
      p += len;
    }
    console.log(`   final p-tokOff=${p - tokOff} vs rel2=${rel2}`);
  }
}
