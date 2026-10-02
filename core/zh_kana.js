// zh_kana.js — 中文(简体/繁体)拼音 → 日文假名 (用假名近似中文发音)
// 移植自 Yukkuri-audition/converter/kana.py (MIT 逻辑等价); 中文经 pinyin-pro 取拼音后查表。
// 用途: 让 AquesTalk(日文 TTS)能"读出"中文 —— 不是日文汉字读音, 而是靠片假名近似普通话发音。
import { pinyin } from "pinyin-pro";

// 声母 → 5 个元音(a/i/u/e/o)对应的假名
const INITIALS = {
  "":  ["ア", "イ", "ウ", "エ", "オ"],
  b: ["バ", "ビ", "ブ", "ベ", "ボ"], p: ["パ", "ピ", "プ", "ペ", "ポ"],
  m: ["マ", "ミ", "ム", "メ", "モ"], f: ["ファ", "フィ", "フ", "フェ", "フォ"],
  d: ["ダ", "ディ", "ドゥ", "デ", "ド"], t: ["タ", "ティ", "トゥ", "テ", "ト"],
  n: ["ナ", "ニ", "ヌ", "ネ", "ノ"], l: ["ラ", "リ", "ル", "レ", "ロ"],
  g: ["ガ", "ギ", "グ", "ゲ", "ゴ"], k: ["カ", "キ", "ク", "ケ", "コ"],
  h: ["ハ", "ヒ", "フ", "ヘ", "ホ"],
  j: ["ジャ", "ジ", "ジュ", "ジェ", "ジョ"],
  q: ["チャ", "チ", "チュ", "チェ", "チョ"],
  x: ["シャ", "シ", "シュ", "シェ", "ショ"],
  zh: ["ジャ", "ジ", "ジュ", "ジェ", "ジョ"],
  ch: ["チャ", "チ", "チュ", "チェ", "チョ"],
  sh: ["シャ", "シ", "シュ", "シェ", "ショ"],
  r: ["ラ", "リ", "ル", "レ", "ロ"],
  z: ["ザ", "ジ", "ズ", "ゼ", "ゾ"],
  c: ["ツァ", "ツィ", "ツ", "ツェ", "ツォ"],
  s: ["サ", "シ", "ス", "セ", "ソ"],
};

// 韵母 → [元音索引, 附加后缀]
const FINALS = {
  a: [0, ""], o: [4, ""], e: [3, ""], i: [1, ""], u: [2, ""],
  ai: [0, "イ"], ei: [3, "イ"], ao: [0, "オ"], ou: [4, "ウ"],
  an: [0, "ン"], en: [3, "ン"], ang: [0, "ン"], eng: [3, "ン"], ong: [4, "ン"],
  ia: [1, "ャ"], ie: [1, "ェ"], iao: [1, "ャオ"], iu: [1, "ュウ"],
  ian: [1, "ェン"], in: [1, "ン"], iang: [1, "ャン"], ing: [1, "ン"], iong: [1, "ョン"],
  ua: [2, "ア"], uo: [2, "オ"], uai: [2, "アイ"], ui: [2, "イ"],
  uan: [2, "アン"], un: [2, "ン"], uang: [2, "アン"], ueng: [2, "エン"],
  "u:": [1, "ュ"], "u:e": [1, "ュエ"], "u:an": [1, "ュエン"], "u:n": [1, "ュン"],
};

// 特例覆盖 (舌尖元音 / 零声母 / 拼写特例 / 唇音圆唇化 / 卷舌中央元音 / 罕见音节)
const OVERRIDES = {
  zhi: "ジー", chi: "チー", shi: "シー", ri: "リー",
  zi: "ズー", ci: "ツー", si: "スー",
  wu: "ウー", wa: "ワ", wo: "ウォ", wai: "ワイ", wei: "ウェイ",
  wan: "ワン", wen: "ウェン", wang: "ワン", weng: "ウェン",
  yi: "イー", ya: "ヤ", ye: "イェ", yao: "ヤオ", you: "ヨウ",
  yan: "イェン", yin: "イン", yang: "ヤン", ying: "イン", yong: "ヨン",
  yu: "ユ", yue: "ユエ", yuan: "ユエン", yun: "ユン",
  ju: "ジュ", qu: "チュ", xu: "シュ",
  jue: "ジュエ", que: "チュエ", xue: "シュエ",
  juan: "ジュエン", quan: "チュエン", xuan: "シュエン",
  jun: "ジュン", qun: "チュン", xun: "シュン",
  beng: "ボン", peng: "ポン", meng: "モン", feng: "フォン",
  er: "アル",
  yo: "ヨ", lo: "ロ", m: "ム", n: "ン", ng: "ン", hm: "フム", hng: "フン",
};

function buildP2K() {
  const t = {};
  for (const init of Object.keys(INITIALS)) {
    for (const [fin, [idx, suf]] of Object.entries(FINALS)) {
      t[init + fin] = INITIALS[init][idx] + suf;
    }
  }
  Object.assign(t, OVERRIDES);
  // ü 的两种写法: u: 与 v
  for (const [k, v] of Object.entries({ ...t })) {
    if (k.includes("u:")) t[k.replace(/u:/g, "v")] = v;
  }
  return t;
}

export const P2K = buildP2K();

// 中文文本 → 近似中文发音的片假名 (非中文原样透传; 标点保留)
// pinyin-pro 的 nonZh:'consecutive' 使英文/假名等非中文连续块整体保留 (与 pypinyin 行为一致)
export function chineseToKana(text) {
  if (!text) return "";
  const tokens = pinyin(text, { toneType: "none", type: "array", nonZh: "consecutive" });
  const out = [];
  for (const tok of tokens) {
    if (/^[a-zü:v]+$/i.test(tok)) {
      const norm = tok.toLowerCase().replace(/v/g, "u:").replace(/ü/g, "u:");
      // 儿化音: 末尾 r 且原词不在表中 → 基音节 + ル
      if (!P2K[norm] && norm.endsWith("r") && norm.length > 2) {
        const base = norm.slice(0, -1);
        if (P2K[base]) { out.push(P2K[base] + "ル"); continue; }
      }
      out.push(P2K[norm] ?? tok);
    } else {
      out.push(tok);
    }
  }
  return out.join("");
}

// ---------- 带音高: 中文声调 → AquesTalk アクセント記号 (') ----------
// AquesTalk 只认 ' = 下降核 (在假名后音高下降); 中文声调近似映射:
//   4声(去声, 高降 51) → 音节后加 '  (最匹配: 高起后降)
//   1声(阴平 55) / 2声(阳平 35) / 3声(上声 214) / 轻声 → 不加
// 注: 日文記号只有"下降", 无法表达升调/降升, 故为近似 (4声位置最明显)
export function chineseToKanaAccent(text) {
  if (!text) return "";
  const tokens = pinyin(text, { toneType: "num", type: "array", nonZh: "consecutive" });
  const out = [];
  for (const tok of tokens) {
    const m = /^([a-zü:v]+)([1-5])?$/i.exec(tok);
    if (!m) { out.push(tok); continue; }
    const base = m[1], tone = m[2];
    const norm = base.toLowerCase().replace(/v/g, "u:").replace(/ü/g, "u:");
    let kana;
    if (!P2K[norm] && norm.endsWith("r") && norm.length > 2) {
      const b = norm.slice(0, -1);
      kana = P2K[b] ? P2K[b] + "ル" : tok;
    } else {
      kana = P2K[norm] ?? tok;
    }
    out.push(tone === "4" ? kana + "'" : kana);
  }
  return out.join("");
}
