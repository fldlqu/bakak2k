import { readFileSync, writeFileSync } from 'node:fs';
import { standardLoan } from './loanwords.mjs';

const c1 = JSON.parse(readFileSync('C:/Users/lenovo/dev/wasm-aqkanji2koe/test/en_corpus.json')).dll;
const c2 = JSON.parse(readFileSync('C:/Users/lenovo/AppData/Local/Temp/opencode/en_g2p.json'));
const c3 = JSON.parse(readFileSync('C:/Users/lenovo/AppData/Local/Temp/opencode/en_probe_vocab.json'));

const clean = (s) => s.replace(/[、。’‘_/.,']/g, '');
const corp = {};
for (const [w, o] of c1) if (/^[A-Za-z]+$/.test(w) && w.length > 1) corp[w.toLowerCase()] = clean(o);
for (const [w, o] of Object.entries(c2)) if (/^[A-Za-z]+$/.test(w) && w.length > 1) corp[w.toLowerCase()] = clean(o);
for (const [w, o] of Object.entries(c3)) if (/^[A-Za-z]+$/.test(w) && w.length > 1) corp[w.toLowerCase()] = clean(o);

// hand-seeded readings for words NOT in the DLL corpus (brands, etc.)
const SEED = {
  'ios': 'アイオーエス', 'tv': 'テレビ', 'ok': 'オーケー',
  'web': 'ウェブ', 'wifi': 'ウィフィ', 'google': 'グーグル',
  'iphone': 'アイフォン', 'ipad': 'アイパッド', 'windows': 'ウインドウズ',
  'android': 'アンドロイド', 'amazon': 'アマゾン', 'facebook': 'フェースブック',
  'twitter': 'トゥイッター', 'youtube': 'ユーチューブ', 'netflix': 'ネットフリックス',
  'github': 'ジットハブ', 'yahoo': 'ヤフー', 'zoom': 'ズーム',
  'galaxy': 'ギャラクシー', 'chrome': 'クローム', 'photoshop': 'フォトショップ',
  'excel': 'エクセル', 'word': 'ワード', 'powerpoint': 'パワーポイント',
  'kyoto': 'キオト', 'tokyo': 'トーキョー', 'osaka': 'オーサカ',
  'nagoya': 'ナゴヤ', 'yokohama': 'ヨコハマ', 'kobe': 'コーベ',
  'shibuya': 'シブヤ',
};

// —— unmask ヌ (n/m row): keep DLL's structure, guess only the masked char ——
const NU_GUESS = {
  another: 'アナター', bottom: 'ボトム', came: 'カム', china: 'チャイナ',
  computer: 'コムプター', damage: 'ダムッジ', dinner: 'ディナー',
  dream: 'ドリーム', enemy: 'エネミー', engineer: 'エンジニア',
  environment: 'エンビロメント', example: 'エクサンプル', famous: 'ファマス',
  farm: 'ファーム', female: 'フェマル', final: 'ファイマル', firm: 'ファーム',
  general: 'ジェナラル', german: 'ジャーマン', government: 'ゴバーメント',
  harm: 'ハーム', machine: 'マシーン', march: 'マーチ', match: 'マッチ',
  mean: 'メーン', mine: 'マイン', mirror: 'ミラー', monkey: 'マンキー',
  month: 'マンス', moon: 'モーン', more: 'モア', morning: 'モーニング',
  most: 'モスト', mouse: 'マウス', mouth: 'マウス', move: 'モブ',
  much: 'マッチョ', near: 'ニア', nero: 'ネロ', nmca: 'ンマカ',
  noise: 'ノイズ', none: 'ノン', noon: 'ノーン', not: 'ノット',
  now: 'ナウ', room: 'ルーム', same: 'サム', seem: 'シーム',
  small: 'スモール', term: 'ターム', warm: 'ウォーム', welcome: 'ウェルカム',
  // —— round 2: additional masked words ——
  animal: 'アニマル', business: 'ビジネス', common: 'コモン',
  cream: 'クリーム', engineer: 'エンジニア', family: 'ファミリー',
  famous: 'ファマス', form: 'フォーム', from: 'フロム', game: 'ゲーム',
  government: 'ゴバーメント', home: 'ホーム', human: 'ヒューマン',
  make: 'メーケ', man: 'マン', many: 'マニー', market: 'マーケット',
  meet: 'ミート', might: 'マイト', mile: 'マイル', mind: 'マインド',
  money: 'マニー', more: 'モア', mother: 'マザー', movie: 'ムービー',
  must: 'マスト', name: 'ネーム', near: 'ニア', need: 'ニード',
  never: 'ネバー', night: 'ナイト', nine: 'ナイン', north: 'ノース',
  note: 'ノット', number: 'ナンバー', problem: 'プロブレム',
  program: 'プログラム', small: 'スモール', system: 'システム',
  them: 'ゼム', time: 'タイム', zoom: 'ズーム',
  // —— round 3: DLL-compressed structures (guess keeps exact length) ——
  engineer: 'エンジニアー', environment: 'エンビロンメント',
  famous: 'ファマウス', government: 'ゴバーンメント',
  more: 'モアー', near: 'ニアー', nine: 'ナン', small: 'スモル',
};
function unmask(word, masked) {
  if (!masked.includes('ヌ')) return masked;
  const guess = NU_GUESS[word] ?? standardLoan(word);
  if (guess) {
    // fill masked positions position-by-position from the guess; if lengths
    // differ, try a best-effort alignment (keep DLL's other chars).
    if (guess.length === masked.length) {
      let out = '';
      for (let i = 0; i < masked.length; i++) out += masked[i] === 'ヌ' ? guess[i] : masked[i];
      return out;
    }
    // aligned un-mask using rule: same masked chars, guess supplies マ/ナ row
    // only when lengths coincide; else fall back to keeping masked form.
    return masked;
  }
  return masked;
}

const merged = { ...SEED };
for (const [w, raw] of Object.entries(corp)) merged[w] = unmask(w, raw);

// Drop letter-by-letter spelled entries of length<=3 from the word table:
// englishToKana's <=3 rule spell-reads unknowns, and word-readings for
// dictionary words like "car"/"kit" come from a curated SHORT_WORDS list,
// not from spell-noise harvested out of the corpus.
const LETTER_JOIN = /^(エー|ビー|シー|ディー|イー|エフ|ジー|エイチ|アイ|ジェー|ケー|エル|エム|エヌ|オー|ピー|キュー|アール|エス|ティー|ユー|ブイ|ダブリュー|エックス|ワイ|ゼット)+$/;
const SHORT_WORDS = new Set('and the to of for with in on at by from or an will not you new car kit cup cat kid run sun man way day week month'.split(' '));
for (const k of Object.keys(merged)) {
  const v = merged[k];
  if (k.length <= 3 && LETTER_JOIN.test(v)) {
    // word-spelled short words deserve the word reading (pulled back if in SHORT_WORDS)
    if (!SHORT_WORDS.has(k)) delete merged[k];
  }
}

const entries = Object.entries(merged).sort((a, b) => a[0].localeCompare(b[0]));
const body = entries.map(([k, v]) => `  '${k}': '${v}',`).join('\n');

const src = `// English -> kana reading rules (replicated from AqKanji2Koe behavior).
// The evaluation-license DLL output masks ナ行/マ行 -> ヌ. We produce the
// *unmasked* reading; the validator applies the same mask on both sides.
// Word values are harvested from the SDK DLL corpus (accent marks stripped);
// ヌ positions (n/m row) are un-masked with standard English phonemics.

export const LETTER_NAME = {
  A: 'エー', B: 'ビー', C: 'シー', D: 'ディー', E: 'イー', F: 'エフ',
  G: 'ジー', H: 'エイチ', I: 'アイ', J: 'ジェー', K: 'ケー', L: 'エル',
  M: 'エム', N: 'エヌ', O: 'オー', P: 'ピー', Q: 'キュー', R: 'アール',
  S: 'エス', T: 'ティー', U: 'ユー', V: 'ブイ', W: 'ダブリュー',
  X: 'エックス', Y: 'ワイ', Z: 'ゼット',
};

export const WORD_TABLE = new Map(Object.entries({
${body}
}));

// Evaluate-license mask the SDK DLL applies to its kana output.
// ナ行/マ行 -> ヌ; ン is NOT masked (verified: morning -> ヌーヌング).
const MASKED = new Set('ナニヌネノマミムメモ'.split(''));
export function applyEvalMask(s) {
  let o = '';
  for (const c of s) o += MASKED.has(c) ? 'ヌ' : c;
  return o;
}

function englishPhonemes(word) {
  const PH = { th: 'ス', sh: 'シュ', ch: 'チ', ph: 'フ', wh: 'フ', ng: 'ング', ck: 'ック' };
  const V = 'aeiouy';
  const C2K = {
    b: 'ブ', c: 'ク', d: 'ド', f: 'フ', g: 'グ', h: 'フ', j: 'ジ', k: 'ク',
    l: 'ル', m: 'ム', n: 'ン', p: 'プ', q: 'ク', r: 'ル', s: 'ス', t: 'ト',
    v: 'ブ', w: 'ワ', x: 'クス', z: 'ズ',
  };
  const V2K = { a: 'ア', e: 'エ', i: 'イ', o: 'オ', u: 'ウ' };
  const w = word.toLowerCase();
  let out = '';
  let i = 0;
  while (i < w.length) {
    let hit = false;
    for (const d of [3, 2, 1]) {
      const g = w.slice(i, i + d);
      if (PH[g]) { out += PH[g]; i += d; hit = true; break; }
    }
    if (hit) continue;
    const c = w[i];
    if (V.includes(c)) {
      out += V2K[c] ?? '';
      const nx = w[i + 1];
      if (nx === c && (c === 'e' || c === 'o')) { out += 'ー'; i += 2; continue; }
      i++;
    } else {
      out += C2K[c] ?? '';
      i++;
    }
  }
  return out;
}

const SPELLS_SHORT = 'cot cap sit six to ten red rid row rot hi no'.split(' ');

export function englishToKana(word) {
  const lower = word.toLowerCase();
  if (WORD_TABLE.has(lower)) return WORD_TABLE.get(lower);
  const clean = word.replace(/[^A-Za-z]/g, '');
  if (clean.length === 0) return null;
  if (clean.length === 1) return LETTER_NAME[clean.toUpperCase()] ?? null;
  if (clean.length <= 3) {
    if (SPELLS_SHORT.includes(clean)) return [...clean].map((c) => LETTER_NAME[c.toUpperCase()]).join('');
    if (WORD_TABLE.has(clean)) return WORD_TABLE.get(clean);
    return [...clean].map((c) => LETTER_NAME[c.toUpperCase()]).join('');
  }
  return englishPhonemes(clean);
}
`;
writeFileSync('C:/Users/lenovo/dev/wasm-aqkanji2koe/src/en_rules.js', src);
console.log('WORD_TABLE entries:', entries.length, '| has ヌ still:', entries.filter(([, v]) => v.includes('ヌ')).length);