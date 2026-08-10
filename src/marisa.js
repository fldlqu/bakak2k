// Marisa (Matching Algorithm with Recursively Implemented StorAge) trie reader.
// Pure-JS port based on the reference implementation (s-yata/marisa-trie, BSD-2-Clause).
// Implements the *reading* side only: lookup, reverse-lookup, key enumeration.
// On-disk layout is little-endian; every multi-byte scalar is LE.

function readWord(bytes, off) {
  let v = 0n;
  for (let i = 7; i >= 0; --i) v = (v << 8n) | BigInt(bytes[off + i]);
  return v;
}
function popcount8(x) {
  x = x - ((x >> 1) & 0x55);
  x = (x & 0x33) + ((x >> 2) & 0x33);
  return (x + (x >> 4)) & 0x0f;
}
function popcount64(b) {
  let n = 0;
  for (let i = 0; i < 8; ++i) n += popcount8(Number((b >> BigInt(i * 8)) & 0xffn));
  return n;
}

class BitVector {
  constructor(bytes, unitsStart, numUnits, size, num1s) {
    this.bytes = bytes;
    this.unitsStart = unitsStart;
    this.numUnits = numUnits;
    this.size = size;
    this.count1 = num1s;
    this._rankWord = null;
    this._sel1 = null;
    this._sel0 = null;
  }
  bit(i) {
    const w = (i / 64) | 0;
    const off = i & 63;
    return ((readWord(this.bytes, this.unitsStart + w * 8) >> BigInt(off)) & 1n) === 1n;
  }
  num_1s() {
    return this.count1;
  }
  rankWord(w) {
    if (this._rankWord === null) {
      const a = new Uint32Array(this.numUnits + 1);
      let acc = 0;
      a[0] = 0;
      for (let k = 0; k < this.numUnits; ++k) {
        acc += popcount64(readWord(this.bytes, this.unitsStart + k * 8));
        a[k + 1] = acc;
      }
      this._rankWord = a;
    }
    return this._rankWord[w];
  }
  rank1(i) {
    const w = i >> 6;
    const off = i & 63;
    let n = this.rankWord(w);
    if (off !== 0) {
      n += popcount64(readWord(this.bytes, this.unitsStart + w * 8) & ((1n << BigInt(off)) - 1n));
    }
    return n;
  }
  _buildSelect() {
    const n1 = this.count1;
    this._sel1 = new Uint32Array(n1);
    this._sel0 = new Uint32Array(this.size - n1);
    let i1 = 0, i0 = 0;
    for (let i = 0; i < this.size; ++i) {
      if (this.bit(i)) this._sel1[i1++] = i;
      else this._sel0[i0++] = i;
    }
  }
  select1(k) {
    if (this._sel1 === null) this._buildSelect();
    return this._sel1[k];
  }
  select0(k) {
    if (this._sel0 === null) this._buildSelect();
    return this._sel0[k];
  }
}

export class Marisa {
  constructor(bytes) {
    this.u8 = bytes;
    if (new TextDecoder('latin1').decode(bytes.subarray(0, 15)) !== 'We love Marisa.') {
      throw new Error('Not a MARISA trie');
    }
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = 16;
    this.trie = this.readTrie();
  }

  u32() {
    const v = this.dv.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  u64() {
    const lo = this.dv.getUint32(this.pos, true);
    const hi = this.dv.getUint32(this.pos + 4, true);
    this.pos += 8;
    return lo + hi * 4294967296;
  }
  align8(total) {
    this.pos += (8 - (total % 8)) % 8;
  }

  readVector() {
    const total = this.u64();
    const start = this.pos;
    this.pos += total;
    this.align8(total);
    return { start, total };
  }

  readBitVector() {
    const units = this.readVector();
    const size = this.u32();
    const num1s = this.u32();
    this.readVector();
    this.readVector();
    this.readVector();
    return new BitVector(this.u8, units.start, units.total / 8, size, num1s);
  }

  readFlatVector() {
    const units = this.readVector();
    const valueSize = this.u32();
    const mask = this.u32();
    const size = this.u64();
    const bytes = this.u8;
    const unitsStart = units.start;
    const get = (i) => {
      if (valueSize === 0) return 0;
      const pos = BigInt(i) * BigInt(valueSize);
      const unit = Number(pos >> 6n);
      const off = Number(pos & 63n);
      const w0 = readWord(bytes, unitsStart + unit * 8);
      if (BigInt(off) + BigInt(valueSize) <= 64n) {
        return Number((w0 >> BigInt(off)) & ((1n << BigInt(valueSize)) - 1n));
      }
      const w1 = readWord(bytes, unitsStart + (unit + 1) * 8);
      return Number(((w0 >> BigInt(off)) | (w1 << BigInt(64 - off))) & ((1n << BigInt(valueSize)) - 1n));
    };
    return { valueSize, mask, size, get };
  }

  readTail() {
    const buf = this.readVector();
    const endFlags = this.readBitVector();
    return {
      bytes: this.u8.subarray(buf.start, buf.start + buf.total),
      endFlags,
    };
  }

  readTrie() {
    const louds = this.readBitVector();
    const terminal = this.readBitVector();
    const link = this.readBitVector();
    const bases = this.readVector();
    const extras = this.readFlatVector();
    const tail = this.readTail();
    let next = null;
    if (link.num_1s() !== 0 && tail.bytes.length === 0) {
      next = this.readTrie();
    }
    this.readVector();
    const numL1 = this.u32();
    const configFlags = this.u32();
    return new Trie(this, louds, terminal, link, bases, extras, tail, next, numL1, configFlags);
  }
}

class Trie {
  constructor(reader, louds, terminal, link, bases, extras, tail, next, numL1, configFlags) {
    this.reader = reader;
    this.louds = louds;
    this.terminal = terminal;
    this.link = link;
    this.bases = bases;
    this.extras = extras;
    this.tail = tail;
    this.next = next;
    this.numL1 = numL1;
    this.configFlags = configFlags;
    this._bytes = null;
  }
  numKeys() {
    return this.terminal.num_1s();
  }
  bytes() {
    if (this._bytes === null) {
      this._bytes = this.reader.u8.subarray(this.bases.start, this.bases.start + this.bases.total);
    }
    return this._bytes;
  }
  baseByte(nodeId) {
    return this.bytes()[nodeId];
  }
  // plain link value (LSB byte + extras)
  getLink(nodeId) {
    return this.baseByte(nodeId) | (this.extras.get(this.link.rank1(nodeId)) * 256);
  }
  // restore the string behind a `link` into buffer (append order = reverse of storage where needed handled by caller)
  restoreLink(link, buf) {
    if (this.next !== null) this.next.restoreNode(link, buf);
    else this.tailRestore(link, buf);
  }
  tailRestore(offset, buf) {
    const t = this.tail;
    if (t.endFlags.num_1s() === 0) {
      for (let i = offset; i < t.bytes.length && t.bytes[i] !== 0; ++i) {
        buf.push(t.bytes[i]);
      }
    } else {
      let i = offset;
      do buf.push(t.bytes[i]);
      while (!t.endFlags.bit(i++));
    }
  }
  restoreNode(nodeId, buf) {
    for (;;) {
      if (this.link.bit(nodeId)) {
        this.restoreLink(this.getLink(nodeId), buf);
      } else {
        buf.push(this.baseByte(nodeId));
      }
      if (nodeId <= this.numL1) return;
      nodeId = this.louds.select1(nodeId) - nodeId - 1;
    }
  }

  key(id) {
    let nodeId = this.terminal.select1(id);
    const buf = [];
    if (nodeId === 0) return '';
    for (;;) {
      if (this.link.bit(nodeId)) {
        const prev = buf.length;
        this.restoreLink(this.getLink(nodeId), buf);
        for (let i = prev, j = buf.length - 1; i < j; ++i, --j) {
          const t = buf[i];
          buf[i] = buf[j];
          buf[j] = t;
        }
      } else {
        buf.push(this.baseByte(nodeId));
      }
      if (nodeId <= this.numL1) {
        buf.reverse();
        return decodeU16(buf);
      }
      nodeId = this.louds.select1(nodeId) - nodeId - 1;
    }
  }
  allKeys() {
    const n = this.numKeys();
    const out = new Array(n);
    for (let i = 0; i < n; ++i) out[i] = this.key(i);
    return out;
  }
}

const u16dec = new TextDecoder('utf-16le');
function decodeU16(bytes) {
  return u16dec.decode(new Uint8Array(bytes));
}