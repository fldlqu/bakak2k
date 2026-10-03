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
// 連接コスト行列 (MTXD/MTX1) の位置。aqdic.bin 内で 1 箇所だけ。
const MATRIX_OFFSET = 0x9640;

// 品詞 u16 の下位 15bit が連接コスト行列の行/列インデックス。
// (全レコードの pos & 0x7fff は 0..1181 に収まり、行列の次数 1182 と一致)
const POS_INDEX_MASK = 0x7fff;

// aqdic.bin から MTXD/MTX1 (連接コスト行列) を読む。
// 形式: "MTXD"[u32 size] "MTX1"[u32 size] [u16 w][u16 h] w*h*i16
//   連接コスト(prev→next) = M[next.pos & 0x7fff][prev.pos & 0x7fff]
// 見つからなければ null (連接コスト近似にフォールバック)。
function parseConnMatrix(bytes, u32) {
  const u16 = (o) => bytes[o] | (bytes[o + 1] << 8);
  const i16 = (o) => (u16(o) << 16) >> 16;
  const tag = (o, s) => s.split('').every((c, i) => bytes[o + i] === c.charCodeAt(0));
  let off = MATRIX_OFFSET;
  if (!tag(off, 'MTXD') || !tag(off + 8, 'MTX1')) {
    // 念のため走査で探す (辞書のリビジョン差に耐える)
    off = -1;
    for (let o = 0; o + 16 <= bytes.length; o++) {
      if (bytes[o] === 0x4d && bytes[o + 1] === 0x54 && bytes[o + 2] === 0x58 && bytes[o + 3] === 0x44 &&
          bytes[o + 8] === 0x4d && bytes[o + 9] === 0x54 && bytes[o + 10] === 0x58 && bytes[o + 11] === 0x31) { off = o; break; }
    }
    if (off < 0) return null;
  }
  const w = u16(off + 16), h = u16(off + 18);
  const dataOff = off + 20;
  const need = dataOff + w * h * 2;
  if (w < 2 || h < 2 || need > bytes.length) return null;
  const m = new Int16Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = i16(dataOff + i * 2);
  return { w, h, m };
}

// ---------------------------------------------------------------------------
// POS1 セクション = アクセント結合の「品詞クラス表」
// ---------------------------------------------------------------------------
// POS1 セクションの配置 (先頭 = aqdic.bin + 0x1ac, "POS1" タグ):
//   + 0x18 = u16 クラス数 (=1182, pos&0x7fff の総数と一致)
//   + 0x1a = u8  クラス表 (1182 バイト, 0x1c6..0x664 で MCGD の直前で終わる)
//   + 0x08 = u16 ペア×4 = (116,189) (51,76) (22,50) (5,10)
// クラス値は pos&0x7fff を索引として引かれ、アクセント結合規則の選択に使われる。
const POSD_TAG_OFFSET = 0x1a4;
function parsePos1(bytes) {
  const u16 = (o) => bytes[o] | (bytes[o + 1] << 8);
  let base = POSD_TAG_OFFSET + 8;
  const okTag = (o) => bytes[o] === 0x50 && bytes[o + 1] === 0x4f && bytes[o + 2] === 0x53 && bytes[o + 3] === 0x44;
  if (!okTag(POSD_TAG_OFFSET)) {
    base = -1;
    for (let o = 0x40; o + 0x1c < bytes.length; o++) {
      if (okTag(o)) {
        const size = bytes[o + 4] | (bytes[o + 5] << 8) | (bytes[o + 6] << 16) | (bytes[o + 7] << 24);
        if (size > 0x100 && size <= 0x1000000) { base = o + 8; break; }
      }
    }
    if (base < 0) return null;
  }
  const count = u16(base + 0x18);
  if (count < 16 || base + 0x1a + count > bytes.length) return null;
  const table = bytes.subarray(base + 0x1a, base + 0x1a + count);
  const ranges = [];
  for (let i = 0; i < 4; i++) ranges.push([u16(base + 0x8 + i * 4), u16(base + 0xa + i * 4)]);
  return { count, table, ranges, off: base };
}

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
    // cost = 词条成本 (越小越优先); 按 cost 选读音 (108 語での比較で確認)
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
    // アクセント結合データ (「extra バイト」) の位置。record フォーマット
    // レコード内の配置:
    //   結合バイト数 = flag & 3
    //   結合バイト位置 = p + 7 + mora + ((flag & 4) ? 3 : 0)
    //   cls = (byte >> 5) - 2,  val = (byte & 0x1f) + (cls !== 0 ? 20 : 0)
    // flag 0x44/0x45 (isE7) は 3 バイトの別フィールドを挟む長形式。
    const jcnt = flag & 3;
    if (text) {
      const joff = p + 7 + mora + ((flag & 4) ? 3 : 0);
      let junc = null;
      if (jcnt > 0 && joff + jcnt <= bytes.length) {
        junc = new Array(jcnt);
        for (let j = 0; j < jcnt; j++) junc[j] = bytes[joff + j];
      }
      // moraByte / accByte は record の生バイト (+5 / +6)。アクセント句境界
      // 分類器は この 2 バイトのビット 5 を使う (mb & 0x20 / ab & 0x60)。
      recs.push({ text, accent, mora, cost, pos, flag, jcnt, junc, moraByte: mb, accByte: bytes[p + 6] });
    }
    p += len;
  }
  return recs;
}

// 选最佳读音: 按词条 cost 最小选择
// (109 語での比較: cost モード 89.9% / 取首条 82.6%)。
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
    // 读音选择模式: 'cost' (默认, 按词条成本最小) | 'first' (旧行为: 取首条)
    this.readingMode = opts.readingMode === 'first' ? 'first' : 'cost';
    // 分词模式: 'viterbi' (默认, 词条 cost + 連接コストの和が最小) | 'greedy' (最长匹配)
    this.segmentMode = opts.segmentMode === 'greedy' ? 'greedy' : 'viterbi';
    // 連接コスト: 'matrix' (默认, aqdic.bin 内の MTX1 行列を使う) |
    //             'approx' (旧: 名詞+動詞語尾の禁止ペナルティのみ) | 'off' (連接コスト無し)
    this.connCost = opts.connCost === 'approx' || opts.connCost === 'off' ? opts.connCost : 'matrix';
    // 文頭/文末 (行列 index 0) への連接コストを使うか
    this.eosCost = opts.eosCost !== false && opts.bosEosCost !== false;
    const { trie, u32, mapOff, tokOff, tokSize } = parseSections(this.bytes);
    const cm = this.connCost === 'matrix' ? parseConnMatrix(this.bytes, u32) : null;
    this.connMatrix = cm ? cm.m : null;
    this.connW = cm ? cm.w : 0;
    // アクセント結合の品詞クラス表 (POS1 セクション)。無い辞書では null。
    this.pos1 = parsePos1(this.bytes);
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

  // 按 readingMode 选读音: 'cost' → 词条成本最小 | 'first' → 首条 (旧行为)
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

  // 連接コスト。既定では aqdic.bin 内の MTX1 行列を使う:
  //   cost(prev → next) = M[next.pos & 0x7fff][prev.pos & 0x7fff]
  // prevIdx は直前語の「品詞インデックス」(pos & 0x7fff)。0 は文頭/文末 (BOS/EOS)。
  // 行列が無い場合は旧近似 (名詞の直後に動詞活用語尾 す/る/れ/せ/ろ を禁止)。
  _connCost(prevIdx, prevNode, cand, rec) {
    if (this.connCost === 'off' || !rec) return 0;
    if (this.connMatrix) {
      const cp = rec.pos;
      if (cp == null || prevIdx == null || prevIdx < 0) return 0;
      const r = cp & POS_INDEX_MASK;
      if (r < this.connW && prevIdx < this.connW) return this.connMatrix[r * this.connW + prevIdx];
      return 0;
    }
    if (!prevNode || !prevNode.reading) return 0;
    const pp = prevNode.reading.pos;
    if (pp == null || !NOUN_POS.has(pp)) return 0;
    return VERB_END_SURF.has(cand) ? VERB_END_PENALTY : 0;
  }

  // Viterbi 分詞 (連接コスト込み)。
  // 重要: 連接コストは「直前語の品詞」に依存するため、位置ごとに 1 個だけ最良を残す
  // 素朴な DP では不正解になる (例: 何度も → 何(ナニ)+度 を選び、正解の 何(ナン)+度 を落とす。
  //   位置 1 では ナニ(5251) < ナン(8297) だが、度への連接が -4464 vs -10114 で逆転する)。
  // よって状態 = (文字位置, 直前語の品詞インデックス) とする。
  segmentViterbi(text) {
    const PASS_COST = 12000, EN_COST = 3000, NUM_COST = 3000;  // 非词典片段的代价
    const NO_POS = -1;   // 非辞書片 (品詞不明): 連接コスト 0
    const BOS = 0;       // 行列 index 0 は文頭/文末 (全レコードの pos&0x7fff は 1..1181 で 0 は未使用)
    const useEos = this.connMatrix && this.connCost !== 'off' && this.eosCost;
    // 連接行列が無い辞書 (MTX1 を持たない版) では行列依存の分岐をすべて無効にする。
    const useMatrix = !!this.connMatrix && this.connCost !== 'off';
    const n = text.length;
    // states[i] : Map<品詞インデックス, {cost, from:文字位置, fromKey, node}>
    const states = new Array(n + 1);
    for (let i = 0; i <= n; i++) states[i] = new Map();
    const relax = (j, key, cost, from, fromKey, node) => {
      const cur = states[j].get(key);
      if (!cur || cost < cur.cost) states[j].set(key, { cost, from, fromKey, node });
    };
    states[0].set(BOS, { cost: 0, from: -1, fromKey: -1, node: null });
    for (let i = 0; i < n; i++) {
      const src = states[i];
      if (src.size === 0) continue;
      // 词典键 (枚举所有匹配长度)
      const cap = Math.min(this.maxLen, n - i);
      for (let L = 1; L <= cap; L++) {
        const cand = text.slice(i, i + L);
        const e = this.bySurface.get(cand);
        if (!e || !e.length) continue;
        // 全レコードを連接コスト込みで評価する (文脈によって読みが変わるため。
        // 例: 十時 → ジ, 誕生日 → ビ, 外国語 → ゴ は cost 最小レコードではない)
        for (const [pk, st] of src) {
          for (const r of e[0].records) {
            const rp = r.pos;
            const key = rp == null ? NO_POS : (rp & POS_INDEX_MASK);
            if (useMatrix && key >= this.connW) continue;
            const c = st.cost + (r.cost ?? 0) + this._connCost(pk === BOS ? BOS : pk, st.node, cand, r);
            relax(i + L, key, c, i, pk, { surface: cand, reading: r, id: e[0].id });
          }
        }
      }
      // 英文串 / 数字串 / 单字符回退 (非辞書片: 品詞不明なので NO_POS 状態へ、連接コスト 0)
      const passthrough = (j, cost, node) => {
        for (const [pk, st] of src) relax(j, NO_POS, st.cost + cost, i, pk, node);
      };
      if (/[A-Za-z]/.test(text[i])) {
        let j = i; while (j < n && /[A-Za-z]/.test(text[j])) j++;
        passthrough(j, EN_COST, { surface: text.slice(i, j), reading: { text: englishToKana(text.slice(i, j)) } });
      }
      const m = matchNumber(text, i);
      if (m) passthrough(i + m.len, NUM_COST, { surface: text.slice(i, i + m.len), reading: { text: kanaFromNumber(m.token) } });
      passthrough(i + 1, PASS_COST, { surface: text[i], reading: null });
    }
    const fin = states[n];
    if (fin.size === 0) return [{ surface: text, reading: null }];
    // 文末: EOS (index 0) への連接コスト M[0][last] = matrix[last] を加えて最小を選ぶ
    let bestTotal = Infinity, bestSt = null;
    for (const [k, st] of fin) {
      const ec = (useEos && k !== NO_POS && k < this.connW) ? this.connMatrix[k] : 0;
      const t = st.cost + ec;
      if (t < bestTotal) { bestTotal = t; bestSt = st; }
    }
    const out = [];
    let cur = bestSt;
    while (cur && cur.node) { out.push(cur.node); cur = cur.from < 0 ? null : states[cur.from].get(cur.fromKey); }
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
  // 追加フィールド (既存 API は不変): pos (品詞), cost, flag, jcnt, junc
  //   junc = アクセント結合バイト (POS1 クラス表と組み合わせて核位置を決める)
  toKanaDetailed(text) {
    return this.segment(text).map((t) => ({
      surface: t.surface,
      reading: normalizeReading(t.reading?.text ?? null),
      accent: t.reading?.accent ?? null,
      mora: t.reading?.mora ?? null,
      pos: t.reading?.pos ?? null,
      cost: t.reading?.cost ?? null,
      flag: t.reading?.flag ?? null,
      jcnt: t.reading?.jcnt ?? 0,
      junc: t.reading?.junc ?? null,
      moraByte: t.reading?.moraByte ?? null,
      accByte: t.reading?.accByte ?? null,
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