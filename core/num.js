// Arabic numerals -> Japanese *reading kana* for TTS front-end.
// The AQ SDK DLL emits AQV placeholders (`<NUMK VAL=...>`/`<NUM VAL=...>`);
// here we render the actual speech reading instead. Rules mirror the DLL's
// split: <=4 digits read as a number, >=5 read digit-by-digit, a number
// beginning with 0 reads digit-by-digit, decimals read 整数+テン+逐位,
// signs read マイナス/プラス, % reads パーセント.

const D = ['', 'イチ', 'ニ', 'サン', 'ヨン', 'ゴ', 'ロク', 'ナナ', 'ハチ', 'キュウ'];
const DG = ['ゼロ', 'イチ', 'ニ', 'サン', 'ヨン', 'ゴ', 'ロク', 'ナナ', 'ハチ', 'キュウ'];
const UNITS = ['', 'マン', 'オク', 'チョウ', 'ケイ'];

function senK(d) {
  if (d === 1) return 'セン';
  if (d === 3) return 'サンゼン';
  if (d === 8) return 'ハッセン';
  return D[d] + 'セン';
}
function hyK(d) {
  if (d === 1) return 'ヒャク';
  if (d === 3) return 'サンビャク';
  if (d === 6) return 'ロッピャク';
  if (d === 8) return 'ハッピャク';
  return D[d] + 'ヒャク';
}
function juuK(d) {
  if (d === 1) return 'ジュウ';
  return D[d] + 'ジュウ';
}

function readGroup4(g) {
  const sen = Math.floor(g / 1000) % 10;
  const hy = Math.floor(g / 100) % 10;
  const ju = Math.floor(g / 10) % 10;
  const on = g % 10;
  let s = '';
  if (sen) s += senK(sen);
  if (hy) s += hyK(hy);
  if (ju) s += juuK(ju);
  if (on) s += D[on];
  return s;
}

// Read an integer digit string as a Japanese number (with 万/億/兆 units).
export function kanaInt(intStr) {
  const n = Number.parseInt(intStr, 10);
  if (!Number.isFinite(n)) return intStr;
  if (n === 0) return 'ゼロ';
  const groups = [];
  let v = n;
  while (v > 0) { groups.push(v % 10000); v = Math.floor(v / 10000); }
  let out = '';
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (g === 0) continue;
    const seg = readGroup4(g);
    if (seg) out += seg + UNITS[i];
  }
  return out || 'ゼロ';
}

function digitByDigit(s) {
  let o = '';
  for (const c of s) o += DG[Number.parseInt(c, 10)];
  return o;
}

// Read a plain (no comma/phone sign handling) digit segment.
// >4 digits or leading-zero => digit-by-digit, else value read.
function readDigits(seg) {
  if (seg.length > 4 || /^0/.test(seg)) return digitByDigit(seg);
  return kanaInt(seg);
}

// Read a full run captured by the engine (may contain `.`/`,`/`%`/phones `-`).
export function kanaFromNumber(token) {
  const t = token.trim();
  if (t.endsWith('%')) return readNumberPart(t.slice(0, -1)) + 'パーセント';
  return readNumberPart(t);
}

function readNumberPart(t) {
  // sign
  if (t.startsWith('-')) return 'マイナス' + readNumberPart(t.slice(1));
  if (t.startsWith('+')) return 'プラス' + readNumberPart(t.slice(1));
  // phone: contains '-' not at head => blocks read digit-by-digit
  if (t.includes('-')) {
    return t.split('-').map(digitByDigit).join('');
  }
  // thousands separators present => definitely a written number, value-read all
  const hasComma = t.includes(',');
  const clean = t.split(',').join('');
  const dot = clean.indexOf('.');
  if (dot >= 0) {
    const int = clean.slice(0, dot);
    const frac = clean.slice(dot + 1);
    let out = int === '' ? 'ゼロ' : (hasComma || int.length <= 4 && !/^0/.test(int) ? kanaInt(int) : readDigits(int));
    out += 'テン';
    // 小数部は数字だけとは限らない (1.2.3 のような版番号は複数の '.' を含む)。
    // 数字以外を無条件に DG[] へ渡すと DG[NaN] === undefined が文字列に混入するため,
    // '.' は テン として読み, それ以外の非数字は読み飛ばす。
    for (const c of frac) {
      if (c === '.') { out += 'テン'; continue; }
      const d = DG[Number.parseInt(c, 10)];
      if (d !== undefined) out += d;
    }
    return out;
  }
  if (hasComma) return kanaInt(clean);
  return readDigits(clean);
}

// Match a numeric run at index i of `text`. Returns {len, token} or null.
// Covers: [sign]digits, [sign]digits.decimals, comma-separated thousands,
// trailing %, and phone blocks (digits separated by '-').
export function matchNumber(text, i) {
  const head = text.slice(i);
  const m = /^[+\-]?\d[\d,.\-]*%?/.exec(head);
  if (!m) return null;
  const token = m[0];
  // don't read a lone '-' or trailing '.'/'-' (sign with no digits)
  let end = token.length;
  while (end > 0 && (token[end - 1] === '.' || token[end - 1] === '-')) end--;
  if (/^[+\-]*$/.test(token.slice(0, end))) return null;
  return { len: end, token: token.slice(0, end) };
}