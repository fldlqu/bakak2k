// zh_kana.js — 中文(简体/繁体)拼音 → 日文假名 (用假名近似中文发音)
// 拼音 → かなの対応表 (普通話の音節をカタカナで近似); 中文经 pinyin-pro 取拼音后查表。
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

// 合法音节结构: 声母 → 该声母可拼的韵母 (普通话音节表)
// 由 CJK 全域 (基本区+扩展A/B+兼容区, 共 4 区块) 的 pinyin-pro 输出反查得出, 覆盖 407 个真实音节。
// 只有这里列出的组合才会被生成; 不在表内的组合不是普通话合法音节 (如 bua/fe/gi/bou/zhiang)。
const LEGAL = {
  "":  "a o e ai ei ao ou an en ang eng",
  zh:  "a e i u ai ao ou an en ang eng ong ua uo uai ui uan un uang",
  ch:  "a e i u ai ao ou an en ang eng ong ua uo uai ui uan un uang",
  sh:  "a e i u ai ao ou an en ang eng ua uo uai ui uan un uang",
  b:   "a o i u ai ei ao an en ang eng ie iao ian in ing",
  p:   "a o i u ai ei ao ou an en ang eng ie iao ian in ing",
  m:   "a o e i u ai ei ao ou an en ang eng ie iao iu ian in ing",
  f:   "a o u ei ou an en ang eng",
  d:   "a e i u ai ao ou an en ang eng ong ia ie iao iu ian ing uo ui uan un",
  t:   "a e i u ai ao ou an ang eng ong ie iao ian ing uo ui uan un",
  n:   "a e i u ai ei ao ou an en ang eng ong ie iao iu ian in iang ing uo uan u: u:e",
  l:   "a e i u ai ei ao ou an ang eng ong ia ie iao iu ian in iang ing uo uan un u: u:e",
  g:   "a e u ai ei ao ou an en ang eng ong ua uo uai ui uan un uang",
  k:   "a e u ai ei ao ou an en ang eng ong ua uo uai ui uan un uang",
  h:   "a e u ai ei ao ou an en ang eng ong ua uo uai ui uan un uang",
  j:   "i u ia ie iao iu ian in iang ing iong uan un",
  q:   "i u ia ie iao iu ian in iang ing iong uan un",
  x:   "i u ia ie iao iu ian in iang ing iong uan un",
  r:   "e i u ao ou an en ang eng ong uo ui uan un",
  z:   "a e i u ai ei ao ou an en ang eng ong uo ui uan un",
  c:   "a e i u ai ao ou an en ang eng ong uo ui uan un",
  s:   "a e i u ai ao ou an en ang eng ong uo ui uan un",
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
  // 按合法音节结构生成 (声母 × 该声母允许的韵母), 不再取全交叉积
  for (const [init, fins] of Object.entries(LEGAL)) {
    for (const fin of fins.split(' ')) {
      const [idx, suf] = FINALS[fin];
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
      // 注: pinyin-pro 把「哪儿」切成 [na, er] 而非 [nar], 故此分支当前不可达,
      //     儿化被读成一个完整音节 (哪兒→ナアル)。已知问题, 本次未处理。
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
// AquesTalk 只认 ' = 下降核: ' 跟在某 mora 后 ⇒ 该 mora 之后音高下降 (日文アクセント記法)。
// 中文声调近似映射:
//   4声(去声, 高降 51) → 该音节后加 '   (构成"高→降"边界)
//   1声(阴平55)/2声(阳平35)/3声(上声214)/轻声 → 不加 (日文記号无"上升", 无法表达)
//   末尾音节: 保证其为低音 (中文陈述句降调); 若前面已有 ' 则自然满足, 否则在末尾音节的
//             最后一个 mora 前插 '  (例: 你好 → ニハ'オ, 东京 → ドンジ'ン)
// 注: 这是近似 —— 中文是音节内音高曲线, 日文記号只能表达音节间的"降"。
const MORAE_SMALL = new Set("ャュョァィゥェォヮヶヵゎ");
// 末尾 mora 的起始字符下标 (拗音小字并入前一 mora)
function lastMoraStart(kana) {
  let idx = 0;
  for (let i = 0; i < kana.length; i++) {
    if (!MORAE_SMALL.has(kana[i])) idx = i;
  }
  return idx;
}

export function chineseToKanaAccent(text) {
  if (!text) return "";
  const tokens = pinyin(text, { toneType: "num", type: "array", nonZh: "consecutive" });
  // 先把每个可转音节记录为 {kana, tone}; 非音节(标点/英文)原样
  const parts = [];
  for (const tok of tokens) {
    // 声调数字: pinyin-pro 用 0 表示轻声(如 的→de0), 必须接受 0, 否则会原样泄漏到输出
    const m = /^([a-zü:v]+)([0-5])?$/i.exec(tok);
    if (!m) { parts.push({ raw: tok }); continue; }
    const base = m[1], tone = m[2];
    const norm = base.toLowerCase().replace(/v/g, "u:").replace(/ü/g, "u:");
    let kana;
    if (!P2K[norm] && norm.endsWith("r") && norm.length > 2) {
      const b = norm.slice(0, -1);
      kana = P2K[b] ? P2K[b] + "ル" : tok;
    } else {
      kana = P2K[norm] ?? tok;
    }
    parts.push({ kana, tone });
  }

  // 4声 → 音节后加 '(末尾音节留到最后统一处理, 避免末尾高音)
  const words = parts.filter((p) => p.kana !== undefined);
  const lastWord = words[words.length - 1];
  const out = [];
  let lastWordIdx = -1;
  for (const p of parts) {
    if (p.raw !== undefined) { out.push(p.raw); continue; }
    if (p === lastWord) { lastWordIdx = out.length; out.push(p.kana); continue; }  // 末尾音节: 稍后保证低音
    out.push(p.tone === "4" ? p.kana + "'" : p.kana);
  }

  // 末尾音节降调 (中文陈述句): 若它前面没有 ' , 在它的最后一个 mora 前插 '
  if (lastWordIdx >= 0) {
    const before = lastWordIdx > 0 ? out[lastWordIdx - 1] : "";
    if (!before.endsWith("'")) {
      const kana = out[lastWordIdx];
      const at = lastMoraStart(kana);
      // ' 的语义是"其后的音高下降"; 若它落在输出开头就无对象可降 (例: 的 → 'デ),
      // 这是无意义的记号, 故跳过。
      if (!(lastWordIdx === 0 && at === 0)) {
        out[lastWordIdx] = kana.slice(0, at) + "'" + kana.slice(at);
      }
    }
  }
  return out.join("");
}
