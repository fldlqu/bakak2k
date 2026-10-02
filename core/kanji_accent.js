// kanji_accent.js — 日文路径统一实现 (webui 与 CLI 共用, 消除此前两处重复)
//   - 汉字/假名 → 片假名
//   - accent: 插入アクセント記号 ' (下降核)
//   - 无读音汉字的兜底: 绝不把裸汉字送进 AquesTalk (那会产生乱音/静音)
import { chineseToKana, chineseToKanaAccent } from "./zh_kana.js";

// 拗音/小写假名 (与前一拍同拍, 不新开 mora)
export const SMALL_KANA = new Set("ャュョァィゥェォヮヶヵゎ");
// オ段かな (助動詞「う」が長音「ー」になる環境)
const O_DAN = new Set("オコソトノホモヨロゴゾドボポヴョ");

// 返回 ' 的插入位置 (字符索引); -1 = 不加
// 规则 (v86 跑官方 AqKanji2Koe.dll 实证, 汉字输入):
//   accent = 核拍 (1-based)
//   accent < mora  → ' 放在第 accent 拍结束后 (词内下降核)
//   accent == mora → 尾高: ' 放在词尾 (官方: 川→カワ', 山→ヤマ', 花→ハナ', 犬→イヌ')
//   accent == 0 / > mora (平板・助词) → 不加
export function accentPos(reading, accent, mora) {
  // 尾高 → 词尾; 但 mora==1 的頭高不加 (官方: した→シタ, 川(2拍)→カワ')
  if (accent >= 1 && accent === mora && mora >= 2) return reading.length;
  if (!(accent >= 1 && accent < mora)) return -1;
  let m = 0;
  for (let i = 0; i < reading.length; i++) {
    const ch = reading[i];
    if (SMALL_KANA.has(ch)) continue;
    m++;
    if (m === accent) {
      let j = i;
      while (j + 1 < reading.length && SMALL_KANA.has(reading[j + 1])) j++;
      return j + 1;
    }
  }
  return -1;
}

const HAN_RE = /[\u4e00-\u9fff]/;

// ---------- 助词前插 ' ----------
// 官方 AqKanji2Koe 在句末助词前插 ' (平板句的下降落在助词上), 实测 (汉字输入对拍):
//   して+ね → シテ'ネ    いって+ね → イッテ'ネ   やって+ね → ヤッテ'ネ   ね+ね → ネ'ネ
//   たべて+ね → タ'ベテネ (不插)   みて+ね → ミ'テネ(不插)   しんぶん+ね → シンブンネ(不插)
// 判定 (不依赖词边界, 全部用例自洽):
//   当前段是句末助词, 且前一段 acc==0 且 mora<=2, 且再前一段没有真アクセント
const FINAL_PARTICLES = new Set(["ネ", "ヨ", "カ", "ナ", "ワ", "ゾ", "ゼ", "サ"]);
const isRealAccent = (s) => !!s && s.accent >= 1 && s.accent <= s.mora;
function insertBeforeParticle(segs, i) {
  if (i === 0) return false;
  const cur = segs[i], prev = segs[i - 1];
  if (!cur || !cur.reading || !FINAL_PARTICLES.has(cur.reading)) return false;
  if (!prev || !prev.reading) return false;
  if (prev.accent !== 0 || prev.mora > 2) return false;
  const before = i >= 2 ? segs[i - 2] : null;
  return !isRealAccent(before);
}

// ===========================================================================
// アクセント句 (phrase) モデル — accentModel: 'phrase'
// ---------------------------------------------------------------------------
// 官方 AqKanji2Koe 输出把句子切成アクセント句 (以 / + 、 。 分隔), **每句至多一个 ' 核**。
// 逆向 (v86 对拍官方 DLL, 同一份 aqdic.bin) 得出的规律:
//   1. アクセント句 = 自立語 + 后续付属語。
//   2. 平板头 (accent 0) + 付属語 → 核落在**第一个有核的付属語**上 (位置 = 该付属語起始 + 其 accent)。
//      例: 飴+まで → アメマ'デ / 会社+です → カイシャデ'ス
//   3. 有核头 + 付属語 → 头自身的核 (例: 山+は → ヤマ'ワ / 本+です → ホ'ンデス)。
//   4. 一部の助動詞は頭の核を**上書き**する (位置 = 助動詞起始 + N):
//      ます+1 / ません+2 / まし+1 / ませ+2 / ましょ+2 / たい+1 / れる+1 / られる+2 /
//      せる+1 / させる+2 / ながら+1 / そう+1 / よう+1
//      例: 読み+ます → ヨミマ'ス (読み a1 だがますが上書き)
//   5. た・て・だ・で・ば・たら・なら などは頭の核を**動かさない** (平板头なら平板)。
//      例: 借り(a0)+た → カリタ / 食べ(a1)+た → タ'ベタ
//   6. 動詞未然形 + ない → 核は語幹の最終拍 (尾高化)。例: 食べ(a1,m2)+ない → タベ'ナイ
//      ただし形容詞連用形 (…ク) + ない は頭の核のまま。例: 高く(a2)+ない → タカ'クナイ
//   7. 尾高名詞 + の → 平板化。例: 山(a2,m2)+の → ヤマノ
//   8. 自立語 + 自立語 (複合語) → 後部要素の第1拍に核 (後部が3拍以上)。
//      例: 天気+予報 → テンキヨ'ホー / 電話+番号 → デンワバ'ンゴー
//   9. 句末終助詞 (か/ぞ/さ/な/わ/ぜ) が平板の用言に付くと、その用言の最終拍に核 (尾高化)。
//      例: 行く+か → イク'カ / いる+か → イル'カ。ただし名詞には付かない (会社か → カイシャカ)。
//  10. て/で + 終助詞 (ね/よ/か/な/わ/ぞ/さ) → て の拍に核。例: して+ね → シテ'ネ
//      (こちらは名詞+ね = 平板、動詞+ね = 平板 と対照的)
// ===========================================================================

// 付属語 (助詞・助動詞) を表す品詞ID。公式 aqdic.bin で「アクセント句首に決して来ない」
// pos を実測して得た集合 (work/probes/_learn_pos.mjs, 3038 句, 2954 句整列)。
// 未然形 (543) ・自立語・接頭辞 (1167) は除外。
export const AUX_POS = new Set([
  120, 33935, 32917, 32972, 253, 32911, 32973, 32914, 33047, 33105, 33032, 119, 33028,
  274, 33189, 32947, 33039, 33054, 272, 270, 33030, 33002, 277, 177, 33031, 215, 32990,
  135, 200, 33015, 33496, 127, 107, 32949, 32831, 33160, 363, 239, 319, 114, 33337, 1008, 33056, 33936, 33118, 1079, 33441,
]);
// 用户词典等无 pos 时的表面形式兜底
export const AUX_SURF = new Set([
  'は', 'が', 'を', 'に', 'で', 'と', 'も', 'の', 'へ', 'や', 'から', 'まで', 'より', 'だけ',
  'しか', 'など', 'ので', 'のに', 'けど', 'けれど', 'ば', 'たら', 'なら', 'ながら', 'ても', 'でも',
  'て', 'た', 'だ', 'です', 'でし', 'でしょ', 'でしょう', 'ます', 'ません', 'ました', 'ましょう',
  'ませ', 'まし', 'ましょ', 'ん', 'う', 'よう', 'らしい', 'そう', 'たい', 'ない', 'ぬ', 'ず',
  'れる', 'られる', 'せる', 'させる', 'より', 'やすい', 'やすかっ', 'やすく', 'やすけれ', 'にくい', 'すぎ', 'くらい', 'ほど', 'ばかり', 'こそ', 'さえ',
  'か', 'ね', 'よ', 'な', 'わ', 'ぞ', 'ぜ', 'さ', 'き', 'つつ', 'がら', 'てく', 'てる', 'ちゃう',
  'じゃ', 'り', 'る', 'れ', 'す',
]);
// 助動詞: 頭の核を上書きする。値 = その助動詞の先頭から数えた核の拍 (1-based)
export const AUX_NUCLEUS = new Map([
  ['ます', 1], ['ません', 2], ['まし', 1], ['ませ', 2], ['ましょ', 2],
  ['たい', 1], ['れる', 1], ['られる', 2], ['せる', 1], ['させる', 2],
  ['られ', 1], ['させ', 1], ['れ', 1], ['せ', 1],
  ['ながら', 1], ['そう', 1],
  ['やすい', 2], ['やすかっ', 2], ['やすく', 2], ['やすけれ', 2], ['にくい', 2], ['すぎ', 2],
  ['ぬ', 1], ['ず', 1], ['ん', 1], ['ちゃう', 1], ['てく', 1],
]);
// 頭の核を動かさない付属語 (平板头なら平板)
export const AUX_HEAD_ONLY = new Set([
  'た', 'て', 'だ', 'で', 'ば', 'たら', 'なら', 'のに', 'ので', 'けど', 'けれど',
  'ても', 'でも', 'か', 'ね', 'よ', 'な', 'わ', 'ぞ', 'ぜ', 'さ', 'つつ', 'がら', 'り', 'る', 'れ', 'す',
]);
// 動詞未然形 + ない → 語幹最終拍に核 (尾高化)
const NO_TAIL = new Set(['ない', 'ぬ', 'ん', 'なけれ', 'なかっ', 'なく', 'なかろ']);
// 平板の用言 + これらの助詞 → 直前の用言の最終拍に核 (尾高化)。
// (v86 対拍: 行く+か → イク'カ / すれ+ば → スレ'バ / 遅れている+ので → オクレテイル'ノデ /
//  散歩する+の → サンポスル'ノ / 会社+か → カイシャカ(名詞は尾高化しない) /
//  おいしい+です → オイシ'イデス / おいしい+か → オイシ'イカ)
const TAIL_PARTICLE = new Set(['か', 'ぞ', 'さ', 'な', 'わ', 'ぜ', 'ね', 'よ', 'の', 'ば', 'ので', 'のに', 'けど', 'けれど', 'です', 'も', 'は', 'には', 'にも']);
// このうち ね/よ は直前が付属語のときだけ尾高化する (行く+ね は平板 / して+ね は シテ'ネ)
const FIN_TE_ONLY = new Set(['ね', 'よ']);
// イ形容詞の品詞ID (終止形 33856/33876/1028/1088/1089, 連用形 1100/33868, かっ形 33866/33881)。
// アクセント核は語幹最終拍に来る (終止形/連用形 = 最終拍-1、かっ形 = -2、けれ形 = -3)。
// (v86 対拍: おいしい(a0)+です → オイシ'イデス / おいしかっ → オイシ'カッタ / 若く → ワカ'ク)
export const ADJ_POS = new Set([33856, 33876, 1028, 1088, 1089, 33866, 33881, 1100, 33868]);
const isAdj = (m) => m.pos != null && ADJ_POS.has(m.pos);
function adjNucleus(m) {
  const r = m.reading ?? '', mm = m.mora | 0;
  if (/カッ$/.test(r)) return Math.max(1, mm - 2);
  if (/ケレ/.test(r)) return Math.max(1, mm - 3);
  return Math.max(1, mm - 1);
}
// 名詞の品詞ID (終助詞の尾高化は名詞には起きない)
export const NOUN_POS = new Set([
  981, 33749, 33747, 33752, 33758, 33761, 984, 980, 993, 1171, 1004, 1005, 1006, 1007,
  1046, 32770, 32771, 32772, 33750, 33765,
]);
const isNoun = (m) => m.pos != null && NOUN_POS.has(m.pos);
// 複合名詞 (名詞+名詞) を 1 アクセント句にまとめてよい品詞。
// 副詞・連体詞・ナ形容詞、および時間名詞 (毎日/昨日/毎週/朝 など pos 984, 33752) は除外。
// 公式: 天気(a1)+予報 → テンキヨ'ホー (1 句) だが 毎日+日本語 → ヌ'イヌチ/ヌホンゴオ (別句)。
export const COMPOUND_NOUN_POS = new Set([...NOUN_POS].filter((p) => ![32770, 32771, 32772, 33949, 33761, 984, 33752].includes(p)));
const isCompoundNoun = (m) => m.pos != null && COMPOUND_NOUN_POS.has(m.pos);
// 助詞 (付属語のうち格助詞・係助詞・終助詞・接続助詞)。助動詞と区別するために使う。
// 動詞未然形につく「ない」は助動詞だが、助詞の後ろでは形容詞「無い」として自立する。
// 公式: 行か+ない → イカナイ (同一句) / 時間+が+ない → ジカンガ|ナ'イ (別句) / 学生では+ない → ガクセーデ'ワ|ナ'イ
export const PARTICLE_SURF = new Set([
  'は', 'が', 'を', 'に', 'で', 'と', 'も', 'の', 'へ', 'や', 'から', 'まで', 'より', 'だけ',
  'しか', 'など', 'ので', 'のに', 'けど', 'けれど', 'ば', 'たら', 'なら', 'ながら', 'ても', 'でも',
  'か', 'ね', 'よ', 'な', 'わ', 'ぞ', 'ぜ', 'さ', 'って', 'こそ', 'さえ', 'ほど', 'ばかり', 'くらい',
  'つつ', 'がら', 'て', 'り',
]);
// 付属語としての核は 0 だが、単独で句首に立つときは辞書の accent を使う助詞・助動詞。
// (v86 対拍: 借り+た → カリタ / ここ+に+ない → ココニ|ナ'イ / 単独 た → タ')
const AUX_ZERO_ACCENT = new Set(['た', 'だ', 'て', 'で', 'ば', 'ない', 'ぬ', 'ん', 'のに', 'ので', 'けど', 'けれど', 'ても', 'でも']);
// 辞書の accent 値ではなく実測値を使う付属語 (でしょ は +2: 学生でしょう → ガクセーデ'ショー)
const AUX_ACCENT_FIX = new Map([['でしょ', 2], ['より', 1]]);
const auxAccent = (m) => (AUX_ZERO_ACCENT.has(m.surface) ? 0 : (AUX_ACCENT_FIX.get(m.surface) ?? (m.accent | 0)));
// 複合語 (自立語+自立語) の結合: 後部要素が3拍以上なら接合部に核
const COMPOUND_MIN_MORA = 3;

function isAuxSeg(s) {
  if (s.pos != null && AUX_POS.has(s.pos)) return true;
  return AUX_SURF.has(s.surface);
}
function segMora(s) {
  if (typeof s.mora === 'number') return s.mora;
  let m = 0; for (const c of (s.reading ?? '')) if (!SMALL_KANA.has(c)) m++;
  return m;
}
// 読み文字列中で「mora 拍目の直後」の文字インデックスを返す
function moraCut(reading, mora) {
  if (mora <= 0) return -1;
  let m = 0;
  for (let i = 0; i < reading.length; i++) {
    if (SMALL_KANA.has(reading[i])) continue;
    m++;
    if (m === mora) {
      let j = i;
      while (j + 1 < reading.length && SMALL_KANA.has(reading[j + 1])) j++;
      return j + 1;
    }
  }
  return -1;
}

// デバッグ用: アクセント句のまとまりと核の位置を返す
export function debugPhrases(dict, text, opts = {}) {
  const { compoundJoin = false } = opts;
  const raw = dict.toKanaDetailed(text);
  const stream = [];
  for (const s of raw) {
    if (!s.reading) { stream.push({ kind: 'text', out: s.surface }); continue; }
    stream.push({ kind: 'seg', surface: s.surface, reading: s.reading, accent: s.accent ?? 0, mora: segMora(s), pos: s.pos, aux: isAuxSeg(s) });
  }
  const groups = []; let cur = null;
  for (const it of stream) {
    if (it.kind === 'text') { if (cur) { groups.push(cur); cur = null; } continue; }
    if (!cur) { cur = [it]; continue; }
    const last = cur[cur.length - 1];
    if (it.aux) { cur.push(it); continue; }
    if (last.aux) { groups.push(cur); cur = [it]; continue; }
    if (compoundJoin && isCompoundNoun(it) && isCompoundNoun(last)) { cur.push(it); continue; }
    groups.push(cur); cur = [it];
  }
  if (cur) groups.push(cur);
  return groups.map((g) => (Array.isArray(g)
    ? { phrase: g.map((m) => `${m.surface}[${m.reading}/a${m.accent}/m${m.mora}/p${m.pos}${m.aux ? '/aux' : ''}]`).join(' '), cut: phraseCut(g) }
    : { text: g.out }));
}

// 日文路径转换。返回 { kana, dropped }
//   accent      true = 带 ' 音高
//   zhFallback  true = 无读音的汉字改用中文读音兜底 (尽力保留内容)
//   dropped     既无日文读音、中文也读不出的字符 (已丢弃, 不进入引擎)
export function convertJapanese(dict, text, { accent = true, zhFallback = true, particleAccent = true, accentPolicy = 'dedupe', accentModel = 'phrase', compoundJoin = true } = {}) {
  if (accentModel === 'phrase') return convertJapanesePhrase(dict, text, { accent, zhFallback, compoundJoin });
  const segs = dict.toKanaDetailed(text);
  let out = "";
  const dropped = [];
  let prevEmitted = false;      // 直前のキーが ' を出したか (accentPolicy='dedupe' 用)
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (!s.reading) {
      const isHan = HAN_RE.test(s.surface);
      if (isHan && zhFallback) {
        // 兜底只为"取到读音", 不套用中文句末降调 (否则片段会多出一个前导 ')
        const alt = chineseToKana(s.surface);
        if (alt && !HAN_RE.test(alt)) { out += alt; continue; }   // 兜底成功
      }
      if (isHan) { dropped.push(s.surface); continue; }           // 丢弃, 避免裸汉字进引擎
      out += s.surface;                                          // 标点/英文等原样保留
      prevEmitted = false;
      continue;
    }
    // アクセント句内で下降は原則 1 つ: 直前のキーが既に ' を出したなら抑制 (accentPolicy)
    let suppress = false;
    if (accent && accentPolicy === 'dedupe' && prevEmitted) suppress = true;
    // 助词前的下降 (官方行为)
    if (accent && particleAccent && insertBeforeParticle(segs, i)) out += "'";
    const r = s.reading;
    if (accent) {
      const pos = suppress ? -1 : accentPos(r, s.accent, s.mora);
      out += pos >= 0 ? r.slice(0, pos) + "'" + r.slice(pos) : r;
      prevEmitted = pos >= 0;
    } else {
      out += r;
    }
  }
  return { kana: out.replace(/[ \u3000]/g, ""), dropped };
}

// アクセント句モデル本体。dict.toKanaDetailed の結果を句にまとめ、句ごとに核を 1 つだけ置く。
export function convertJapanesePhrase(dict, text, { accent = true, zhFallback = true, compoundJoin = true } = {}) {
  const raw = dict.toKanaDetailed(text);
  const dropped = [];
  // 出力列を組み立てる: 'text' = そのまま出す (句を切る) / 'seg' = アクセント対象
  const stream = [];
  for (const s of raw) {
    if (!s.reading) {
      const isHan = HAN_RE.test(s.surface);
      if (isHan && zhFallback) {
        const alt = chineseToKana(s.surface);
        if (alt && !HAN_RE.test(alt)) { stream.push({ kind: 'text', out: alt }); continue; }
      }
      if (isHan) { dropped.push(s.surface); continue; }
      if (/^[、。，．！？!?…‥「」『』（）()\[\]{}ー〜～・,.\-–—:;]+$/.test(s.surface)) stream.push({ kind: 'text', out: s.surface });
      else stream.push({ kind: 'text', out: s.surface });
      continue;
    }
    stream.push({ kind: 'seg', surface: s.surface, reading: s.reading, accent: s.accent ?? 0, mora: segMora(s), pos: s.pos, aux: isAuxSeg(s) });
  }
  // 句にまとめる
  const groups = [];
  let cur = null;
  for (const it of stream) {
    if (it.kind === 'text') { if (cur) { groups.push(cur); cur = null; } groups.push(it); continue; }
    if (!cur) { cur = [it]; continue; }
    const last = cur[cur.length - 1];
    if (it.aux) {
      // 「ない」系は助詞の後ろでは自立語 (形容詞「無い」) として新しい句を始める
      if (NO_TAIL.has(it.surface) && last.aux && PARTICLE_SURF.has(last.surface)) { groups.push(cur); cur = [it]; continue; }
      cur.push(it); continue;              // 付属語は前の句に付く
    }
    if (last.aux) { groups.push(cur); cur = [it]; continue; }   // 自立語 → 新しい句
    if (compoundJoin && !it.aux && !last.aux && isCompoundNoun(it) && isCompoundNoun(last)) { cur.push(it); continue; } // 複合名詞
    groups.push(cur); cur = [it];
  }
  if (cur) groups.push(cur);
  let out = '';
  for (const g of groups) {
    if (!Array.isArray(g)) { out += g.out; continue; }
    // 助動詞「う」はオ段の直後では長音「ー」として出す (公式: 書こ+う → カコ'ー, でしょ+う → デ'ショー)
    let reading = '';
    for (const m of g) {
      reading += (m.aux && m.surface === 'う' && reading && O_DAN.has(reading[reading.length - 1])) ? 'ー' : m.reading;
    }
    if (!accent) { out += reading; continue; }
    const cut = phraseCut(g);
    out += cut >= 0 ? reading.slice(0, cut) + "'" + reading.slice(cut) : reading;
  }
  return { kana: out.replace(/[ \u3000]/g, ''), dropped };
}

// 句の核位置を読み文字列のインデックスで返す (-1 = 平板)
function phraseCut(members) {
  const head = members[0];
  const H = head.accent | 0, HM = members[0].mora | 0;
  let target = null; // {j, moraInSeg}
  // (1) 助動詞による上書き (後方優先: 難し+すぎ+ます は ます が勝つ)
  for (let j = 1; j < members.length; j++) {
    const nuc = AUX_NUCLEUS.get(members[j].surface);
    if (nuc != null) target = { j, m: nuc };
  }
  // (2) 動詞未然形 + ない → 語幹最終拍
  if (!target) {
    const hasNo = members.some((m, j) => j > 0 && NO_TAIL.has(m.surface));
    if (hasNo && !/ク$/.test(head.reading)) {
      if (H > 0) target = { j: 0, m: HM };
      else return -1;
    }
  }
  // (3) 複合名詞: 後部要素が3拍以上なら接合部の第1拍 (2拍以下は頭の核にフォールバック)
  if (!target && members.length > 1 && !members[1].aux) {
    if (members[1].mora >= COMPOUND_MIN_MORA) target = { j: 1, m: 1 };
  }
  // (4) 頭の核
  if (!target && H > 0) {
    // 尾高名詞 + の → 平板化
    if (HM >= 2 && H === HM && members[1] && members[1].surface === 'の') return -1;
    target = { j: 0, m: H };
  }
  // (4b) 平板イ形容詞 + 無核の助詞/助動詞 → 語幹最終拍に核 (公式: おいしい+と → オイシ'イト /
  //      おいしい+が → オイシ'イガ / 重い+を → オモ'イオ)。単独なら平板のまま。
  //      まで/より/しか/など のような有核助詞が続く場合はそちらの核を使う
  //      (公式: 遅く+まで → オソクマ'デ)。です は規則 (5) が処理する。
  if (!target && H === 0 && members.length >= 2 && isAdj(head)
      && !members.some((m, j) => j > 0 && auxAccent(m) > 0)) {
    target = { j: 0, m: adjNucleus(head) };
  }
  // (5) 平板头 + 接続/終助詞 → 直前の用言の最終拍に核 (尾高化)
  //     ね/よ は直前が付属語のときだけ (行く+ね は平板 / ここ+で+ね は ココデ'ネ)。
  //     か/の/ば/ので 等は直前が用言 (名詞以外) でも起きる (行く+か → イク'カ)。
  if (!target && H === 0 && members.length >= 2) {
    for (let j = 1; j < members.length; j++) {
      if (!TAIL_PARTICLE.has(members[j].surface)) continue;
      const P = members[j - 1];
      const teOnly = FIN_TE_ONLY.has(members[j].surface);
      if (P.aux ? true : (!teOnly && !isNoun(P))) {
        // イ形容詞は語幹最終拍 (= 終止形の最終拍-1) に核
        target = { j: j - 1, m: isAdj(P) ? adjNucleus(P) : (P.mora | 0) };
      }
      break;
    }
  }
  // (6) 平板头 → 最初の有核付属語
  if (!target && H === 0) {
    for (let j = 1; j < members.length; j++) {
      const a = auxAccent(members[j]);
      if (a > 0) { target = { j, m: a }; break; }
    }
    if (!target) return -1;
  }
  let abs = 0;
  for (let k = 0; k < target.j; k++) abs += members[k].mora | 0;
  abs += target.m;
  return moraCut(members.map((m) => m.reading).join(''), abs);
}
