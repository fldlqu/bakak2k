// _sections.mjs — dump master section layout and look for tables after TOK1
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const K2K = path.resolve(__dirname, '../..');
const { createDict } = await import('../../core/engine.js');
const dict = createDict(fs.readFileSync(path.join(K2K, 'work/aqdic.bin')));
const bytes = dict.bytes, u32 = dict.u32;
const H = (b) => b.toString(16).padStart(2, '0');
const MASTER = 0x2b395c;
console.log(`file size = 0x${bytes.length.toString(16)} = ${bytes.length}`);
console.log(`master off = 0x${MASTER.toString(16)}`);
// header dump
console.log('first 64 bytes of file:', [...bytes.slice(0, 64)].map(H).join(' '));
console.log('bytes at master:', [...bytes.slice(MASTER, MASTER + 64)].map(H).join(' '));
let o = MASTER + 8;
const u32at = (x) => u32(x);
const hdrSize = u32at(o + 4); console.log(`hdr: size=${hdrSize}`);
console.log('hdr bytes:', [...bytes.slice(o, o + 8 + hdrSize)].map(H).join(' '));
o += 8 + hdrSize;
const tS = u32at(o + 4); const tDataSize = u32at(o + 8);
console.log(`trie block: at 0x${o.toString(16)} size=${tS} dataSize=${tDataSize}`);
o += 8 + tS;
const mSize = u32at(o + 4); const mapOff = o + 8;
console.log(`map block: at 0x${o.toString(16)} size=${mSize} -> n=${(mSize - 8) / 4}`);
o += 8 + mSize;
const tokSize = u32at(o + 4); const tokOff = o + 8;
console.log(`tok block: at 0x${o.toString(16)} size=${tokSize} dataOff=0x${tokOff.toString(16)}`);
const afterTok = o + 8 + tokSize;
console.log(`after tok: 0x${afterTok.toString(16)}  remaining=${bytes.length - afterTok}`);
console.log('bytes at tokBlock hdr:', [...bytes.slice(o, o + 16)].map(H).join(' '));
console.log('bytes after tok:', [...bytes.slice(afterTok, afterTok + 128)].map(H).join(' '));
// what comes before master?
console.log('64 bytes before master:', [...bytes.slice(MASTER - 64, MASTER)].map(H).join(' '));
// check for u32 patterns / table-like structures in the region before master
