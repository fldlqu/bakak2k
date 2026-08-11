// bakak2k dictionary engine — pure JS.
// Loads a user-provided aqdic.bin (AqKanji2Koe-format dictionary), decodes its
// master section (marisa trie + MAP1 + TOK1) and exposes longest-match word
// segmentation with kana readings. API mirrors the AqKanji2Koe dictionary
// (`AqK2KDict`) so it can be swapped in behind AquesTalk-style front ends.
import { Marisa } from './marisa.js';
import { CODE2KANA } from './kana.js';
import { parseUserDict } from './userdic.js';
import { englishToKana } from './en_rules.js';
import { matchNumber, kanaFromNumber } from './num.js';

const MASTER_OFFSET = 0x2b395c;

function parseSections(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (o) => dv.getUint32(o, true);

  let o = MASTER_OFFSET + 8;
  const hdrSize = u32(o + 4); o += 8 + hdrSize;
  const tS = u32(o + 4); const tDataSize = u32(o + 8);
  const trie = new Marisa(bytes.subarray(o + 12, o + 12 + tDataSize));
  o += 8 + tS;
  const mSize = u32(o + 4); const mapOff = o + 8; o += 8 + mSize;
  const tokSize = u32(o + 4); const tokOff = o + 8;
  return { trie: trie.trie, u32, mapOff, tokOff, tokSize };
}

function extraCnt(f) { return (f === 0x44 || f === 0x45) ? (f & 0x0f) - 1 : (f & 0x0f); }

// Decode one token block into {text, accent, mora} records.
// header [pos2][cost2][flag][moraByte][accByte] then mora codes then extra bytes.
// `e7 83` records right-align the reading before a trailing tone byte.
function decodeRecords(bytes, tokOff, tokSize, rel, rel2) {
  const end = Math.min(tokOff + rel2, tokOff + tokSize);
  if (end <= tokOff + rel) return [];
  const recs = [];
  let p = tokOff + rel;
  while (p + 7 <= end && p + 7 <= bytes.length) {
    const flag = bytes[p + 4];
    const mb = bytes[p + 5];
    if (flag === undefined || mb === undefined) break;
    const mora = mb & 0x1f;
    const extra = extraCnt(flag);
    const len = 7 + mora + extra;
    if (p + len > end) break;
    const accent = bytes[p + 6] & 0x3f;
    const isE7 = bytes[p] === 0xe7 && bytes[p + 1] === 0x83;
    const codes = [];
    if (isE7) {
      const winEnd = p + len - 1;
      const winStart = winEnd - mora;
      for (let j = winStart; j < winEnd; j++) codes.push(bytes[j]);
    } else {
      for (let j = 0; j < mora; j++) codes.push(bytes[p + 7 + j]);
    }
    const text = codes.map((c) => CODE2KANA[c] ?? '').join('');
    if (text) recs.push({ text, accent, mora });
    p += len;
  }
  return recs;
}

// Max UTF-16 length of any surface in the trie (caps scanning cost).
function maxKeyLen(trie) {
  let m = 0;
  const n = Math.min(trie.numKeys(), 20000); // cap scan; real max reachable quickly
  for (let i = 0; i < n; i++) {
    try { const k = trie.key(i); if (k.length > m) m = k.length; } catch { /* ignore */ }
  }
  return Math.max(m, 12);
}

// Output-side normalization: readings never contain ヴ/ヂ/ヅ/ヰ/ヱ/ヲ/ヵ/ヶ
// (dictionary is written with ブ/ジ/ズ/イ/エ/オ/カ/ケ), so normalize the
// emitted reading (including unknown-char passthrough) before returning it.
const SMALL_V = 'ァィゥェォャュョ';
const V2ROW = new Map([
  ['ァ', 'バ'], ['ィ', 'ビ'], ['ゥ', 'ブ'], ['ェ', 'ベ'], ['ォ', 'ボ'],
  ['ャ', 'ビャ'], ['ュ', 'ビュ'], ['ョ', 'ビョ'],
]);
const KANA_NORM = new Map([
  // ヴ -> バ行 is handled by V2ROW/ブ below; these are the never-in-reading kana.
  ['ヂ', 'ジ'], ['ヅ', 'ズ'], ['ヮ', 'ワ'],
  ['ヰ', 'イ'], ['ヱ', 'エ'], ['ヲ', 'オ'],
  ['ヵ', 'カ'], ['ヶ', 'ケ'],
  ['ゝ', 'ヽ'], ['ゞ', 'ヾ'], // repeated marks: keep katakana forms
]);

export function normalizeReading(s) {
  if (!s) return s;
  const out = [];
  const loop = (from, to) => { out.push(to ?? KANA_NORM.get(from) ?? from); };
  const A = [...s];
  for (let i = 0; i < A.length; i++) {
    const ch = A[i];
    if (ch === 'ヴ') {
      const nx = A[i + 1];
      if (nx && SMALL_V.includes(nx)) { loop(nx, V2ROW.get(nx)); i++; }
      else loop(ch, 'ブ');
    } else {
      loop(ch);
    }
  }
  return out.join('');
}

export class AqK2KDict {
  constructor(uint8) {
    this.bytes = uint8 instanceof Uint8Array ? uint8 : new Uint8Array(uint8);
    const { trie, u32, mapOff, tokOff, tokSize } = parseSections(this.bytes);
    this.trie = trie;
    this.u32 = u32;
    this.mapOff = mapOff;
    this.tokOff = tokOff;
    this.tokSize = tokSize;

    // Pre-extract id->surface lazily but build map surface->records eagerly.
    this._cache = new Map();
    this.bySurface = new Map();
    const n = this.trie.numKeys();
    const surfaces = this.trie.allKeys();
    for (let i = 0; i < n; i++) {
      const key = surfaces[i];
      const rel = u32(mapOff + i * 4);
      const rel2 = u32(mapOff + (i + 1) * 4);
      const records = decodeRecords(this.bytes, tokOff, tokSize, rel, rel2);
      if (records.length === 0) continue;
      let arr = this.bySurface.get(key);
      if (!arr) { arr = []; this.bySurface.set(key, arr); }
      arr.push({ id: i, records });
    }
    this.maxLen = maxKeyLen(this.trie);
  }

  key(id) {
    if (!this._cache.has(id)) this._cache.set(id, this.trie.key(id));
    return this._cache.get(id);
  }

  // All reading records for a surface word.
  get(surface) {
    return this.bySurface.get(surface);
  }

  // Best reading (first record of the first entry) for a surface.
  reading(surface) {
    const e = this.bySurface.get(surface);
    if (!e || e.length === 0) return null;
    return e[0].records[0] ?? null;
  }

  // Longest-match segment a string into {surface, reading}[].
  // Unknown chars fall back to per-char passthrough (basic kana kept).
  // Consecutive ASCII letters form an English word handled by en_rules;
  // numeric runs are read as Japanese numerals by num.js.
  segment(text) {
    const out = [];
    let i = 0;
    const len = text.length;
    while (i < len) {
      // English / roman word.
      if (/[A-Za-z]/.test(text[i])) {
        let j = i;
        while (j < len && /[A-Za-z]/.test(text[j])) j++;
        const raw = text.slice(i, j);
        out.push({ surface: raw, reading: { text: englishToKana(raw) } });
        i = j;
        continue;
      }
      // Numeric run (digits, decimals, thousands separators, percent, phones).
      const m = matchNumber(text, i);
      if (m) {
        out.push({ surface: text.slice(i, i + m.len), reading: { text: kanaFromNumber(m.token) } });
        i += m.len;
        continue;
      }
      let best = null;
      const cap = Math.min(this.maxLen, len - i);
      for (let L = cap; L >= 1; L--) {
        const cand = text.slice(i, i + L);
        const e = this.bySurface.get(cand);
        if (e && e.length) {
          best = { surface: cand, reading: e[0].records[0] ?? null, id: e[0].id };
          break;
        }
      }
      if (best) {
        out.push(best);
        i += best.surface.length;
      } else {
        const ch = text[i];
        out.push({ surface: ch, reading: null });
        i += 1;
      }
    }
    return out;
  }

  // Whole-sentence converter: text -> kana string (passthrough for unknown).
  // Spaces (half/full width) are dropped from the reading: English words produce
  // one contiguous kana stream, so the synthesizer won't pause between words.
  // Callers who want a deliberate pause insert 、 or ， themselves.
  toKana(text) {
    return this.segment(text).map((t) => normalizeReading(t.reading?.text ?? t.surface)).join('').replace(/[ \u3000]/g, '');
  }

  // Whole-sentence converter with per-segment detail (surface/reading/accent).
  toKanaDetailed(text) {
    return this.segment(text).map((t) => ({
      surface: t.surface,
      reading: normalizeReading(t.reading?.text ?? null),
      accent: t.reading?.accent ?? null,
      mora: t.reading?.mora ?? null,
    }));
  }

  // Merge a user dictionary (aq_user.dic bytes). Its words override the system
  // dictionary on conflicts and additional entries are appended.
  mergeUserDict(userBytes) {
    const entries = parseUserDict(userBytes);
    let merged = 0;
    for (const [surface, records] of entries) {
      this.bySurface.delete(surface);
      this.bySurface.set(surface, records.map((r) => ({ id: -1, records: [r] })));
      merged++;
    }
    this.maxLen = Math.max(this.maxLen, ...[...entries.keys()].map((s) => s.length));
    return merged;
  }
}

// Convenience: build from a Uint8Array (Node readFile / browser fetch arrayBuffer).
export function createDict(uint8Array) {
  return new AqK2KDict(uint8Array);
}

// Async convenience: build from bytes that may be either aqdic.bin or a zip
// containing it.
export async function createDictAuto(bytes) {
  if (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
      (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) {
    const { extractAqdicFromZip } = await import('./zip.js');
    return new AqK2KDict(await extractAqdicFromZip(bytes));
  }
  return new AqK2KDict(bytes);
}

// Build a dict from the system dictionary (aqdic.bin bytes) plus a user
// dictionary (aq_user.dic bytes). User words override the system dictionary.
export function createDictWithUser(sysBytes, userBytes) {
  const dict = new AqK2KDict(sysBytes);
  dict.mergeUserDict(userBytes);
  return dict;
}

export { CODE2KANA };