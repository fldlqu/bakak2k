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

// 連接コスト近似用: 名詞を表す品詞ID (_connCost 参照)
const NOUN_POS = new Set([
  981, 33749, 33747, 33752, 33758, 33761, 984, 980, 993, 1171, 1004, 1005, 1006, 1007,
  1046, 1100, 32770, 32771, 32772, 33750, 33765,
]);
// 名詞の直後に来てはいけない動詞活用語尾・補助動詞 (ください は動詞「くださる」の命令形)
const VERB_END_SURF = new Set(['す', 'る', 'れ', 'せ', 'ろ', 'ください']);
const VERB_END_PENALTY = 5000;

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
    // header = [pos u16][cost u16][flag][moraByte][accByte] ... 数据
    // cost = 词条成本 (越小越优先); 官方 AqKanji2Koe 按 cost 选读音 (实测 108 词)
    const cost = bytes[p + 2] | (bytes[p + 3] << 8);
    const pos = bytes[p] | (bytes[p + 1] << 8);
    const accent = bytes[p + 6] & 0x1f;
    const isE7 = bytes[p] === 0xe7 && bytes[p + 1] === 0x83;
    let text = '';
    if (isE7) {
      const winEnd = p + len - 1;
      const winStart = winEnd - mora;
      for (let j = winStart; j < winEnd; j++) text += CODE2KANA[bytes[j]] ?? '';
    } else {
      for (let j = 0; j < mora; j++) text += CODE2KANA[bytes[p + 7 + j]] ?? '';
    }
    if (text) recs.push({ text, accent, mora, cost, pos });
    p += len;
  }
  return recs;
}

// 选最佳读音: 官方 AqKanji2Koe.dll 按词条 cost 最小选择
// (v86 跑官方 DLL 对拍 109 词: cost 模式 89.9% vs "取首条" 82.6%)。
// 平局取先出现的记录。无 cost 字段 (如用户词典) 时回退取首条, 保持原行为。
function bestRecord(records) {
  if (!records || records.length === 0) return null;
  let best = records[0], bc = records[0].cost ?? 0;
  for (let i = 1; i < records.length; i++) {
    const c = records[i].cost ?? 0;
    if (c < bc) { best = records[i]; bc = c; }
  }
  return best;
}

// Max UTF-16 length of any surface in the trie (caps scanning cost).
// Runs over the surfaces already decoded by allKeys().
function maxKeyLenFast(keys) {
  let m = 0;
  for (let i = 0; i < keys.length; i++) {
    const l = keys[i].length;
    if (l > m) m = l;
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
  constructor(uint8, opts = {}) {
    this.bytes = uint8 instanceof Uint8Array ? uint8 : new Uint8Array(uint8);
    // 读音选择模式: 'cost' (默认, 按词条成本最小, 贴近官方 AqKanji2Koe) | 'first' (旧行为: 取首条)
    this.readingMode = opts.readingMode === 'first' ? 'first' : 'cost';
    // 分词模式: 'viterbi' (默认, 词条 cost 求和最小; 官方形态分析的近似) | 'greedy' (最长匹配)
    this.segmentMode = opts.segmentMode === 'greedy' ? 'greedy' : 'viterbi';
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

    // Pre-read MAP offsets into a typed array – one DataView read per offset
    // instead of 2 per key during the decode loop.
    const rels = new Uint32Array(n + 1);
    for (let i = 0; i <= n; i++) rels[i] = u32(mapOff + i * 4);

    let maxLen = 12;
    for (let i = 0; i < n; i++) {
      const key = surfaces[i];
      const rel = rels[i], rel2 = rels[i + 1];
      const records = decodeRecords(this.bytes, tokOff, tokSize, rel, rel2);
      if (records.length === 0) continue;
      let arr = this.bySurface.get(key);
      if (!arr) { arr = []; this.bySurface.set(key, arr); }
      arr.push({ id: i, records });
      // Track max surface length inline (avoids the separate maxKeyLenFast pass).
      const kl = key.length;
      if (kl > maxLen) maxLen = kl;
    }
    this.maxLen = maxLen;
  }

  key(id) {
    if (!this._cache.has(id)) this._cache.set(id, this.trie.key(id));
    return this._cache.get(id);
  }

  // All reading records for a surface word.
  get(surface) {
    return this.bySurface.get(surface);
  }

  // 按 readingMode 选读音: 'cost' → 词条成本最小 (贴近官方) | 'first' → 首条 (旧行为)
  _pick(records) {
    if (!records || records.length === 0) return null;
    return this.readingMode === 'first' ? records[0] : bestRecord(records);
  }

  // Best reading for a surface (按 readingMode 选择).
  reading(surface) {
    const e = this.bySurface.get(surface);
    if (!e || e.length === 0) return null;
    return this._pick(e[0].records);
  }

  // 連接コスト (近似)。公式 AqKanji2Koe は品詞間の連接コストで形態素を選ぶ。
  // ここでは「名詞の直後に動詞活用語尾 (す/る/れ/せ/ろ) が来る」連接を禁止する。
  // 公式: 「遊んでいます」は アソンデ+イマ'ス (= い+ます) で、いま+す ではない。
  //   cost 和では いま(2377)+す(6951)=9328 < い(6811)+ます(3912)=10723 となり誤るため。
  _connCost(prevNode, cand, rec) {
    if (!prevNode || !prevNode.reading || !rec) return 0;
    const pp = prevNode.reading.pos;
    if (pp == null || !NOUN_POS.has(pp)) return 0;
    return VERB_END_SURF.has(cand) ? VERB_END_PENALTY : 0;
  }

  // Viterbi 分词: 以词条 cost 求和最小为目标 (实验性; 官方实际用的是带连接成本的形态分析)
  // 实测: cost 求和会偏好 "たね"(5985) 而非 "た"+"ね"(8152), 故无法修 したね 这类歧义。
  segmentViterbi(text) {
    const PASS_COST = 12000, EN_COST = 3000, NUM_COST = 3000;  // 非词典片段的代价
    const n = text.length;
    const best = new Array(n + 1).fill(null);
    best[0] = { cost: 0, prev: -1, node: null };
    const relax = (j, cost, prev, node) => {
      if (!best[j] || cost < best[j].cost) best[j] = { cost, prev, node };
    };
    for (let i = 0; i < n; i++) {
      if (!best[i]) continue;
      const base = best[i].cost;
      // 词典键 (枚举所有匹配长度)
      const cap = Math.min(this.maxLen, n - i);
      for (let L = 1; L <= cap; L++) {
        const cand = text.slice(i, i + L);
        const e = this.bySurface.get(cand);
        if (!e || !e.length) continue;
        // 全レコードを連接コスト込みで評価する (文脈によって読みが変わるため。
        // 例: 十時 → ジ, 誕生日 → ビ, 外国語 → ゴ は cost 最小レコードではない)
        let bestRec = null, bestCost = Infinity;
        for (const r of e[0].records) {
          const c = (r.cost ?? 0) + this._connCost(best[i].node, cand, r);
          if (c < bestCost) { bestCost = c; bestRec = r; }
        }
        relax(i + L, base + bestCost, i, { surface: cand, reading: bestRec, id: e[0].id });
      }
      // 英文串 / 数字串 / 单字符回退
      if (/[A-Za-z]/.test(text[i])) {
        let j = i; while (j < n && /[A-Za-z]/.test(text[j])) j++;
        relax(j, base + EN_COST, i, { surface: text.slice(i, j), reading: { text: englishToKana(text.slice(i, j)) } });
      }
      const m = matchNumber(text, i);
      if (m) relax(i + m.len, base + NUM_COST, i, { surface: text.slice(i, i + m.len), reading: { text: kanaFromNumber(m.token) } });
      relax(i + 1, base + PASS_COST, i, { surface: text[i], reading: null });
    }
    if (!best[n]) return [{ surface: text, reading: null }];
    const out = [];
    for (let at = n; at > 0;) { const b = best[at]; out.push(b.node); at = b.prev; }
    return out.reverse();
  }

  // Longest-match segment a string into {surface, reading}[].
  // Unknown chars fall back to per-char passthrough (basic kana kept).
  // Consecutive ASCII letters form an English word handled by en_rules;
  // numeric runs are read as Japanese numerals by num.js.
  segment(text) {
    if (this.segmentMode === 'viterbi') return this.segmentViterbi(text);
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
          best = { surface: cand, reading: this._pick(e[0].records), id: e[0].id };
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
      pos: t.reading?.pos ?? null,
      cost: t.reading?.cost ?? null,
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
// opts = { readingMode: 'cost' | 'first' }
export function createDict(uint8Array, opts) {
  return new AqK2KDict(uint8Array, opts);
}

// Async convenience: build from bytes that may be either aqdic.bin or a zip
// containing it.
export async function createDictAuto(bytes, opts) {
  if (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
      (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) {
    const { extractAqdicFromZip } = await import('./zip.js');
    return new AqK2KDict(await extractAqdicFromZip(bytes), opts);
  }
  return new AqK2KDict(bytes, opts);
}

// Build a dict from the system dictionary (aqdic.bin bytes) plus a user
// dictionary (aq_user.dic bytes). User words override the system dictionary.
export function createDictWithUser(sysBytes, userBytes, opts) {
  const dict = new AqK2KDict(sysBytes, opts);
  dict.mergeUserDict(userBytes);
  return dict;
}

export { CODE2KANA };