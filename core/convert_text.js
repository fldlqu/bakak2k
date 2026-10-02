// convert_text.js — 逐段(中日混排)转换, webui 与 CLI 共用的唯一实现
// 流程: 闭合标签解析 → 分段(标签定语言 / 未标记则自动判别) → 各段转换 → 拼接
import { parseLangTags } from "./lang_tag.js";
import { chineseToKana, chineseToKanaAccent } from "./zh_kana.js";
import { convertJapanese } from "./kanji_accent.js";

const HAN_RE = /[\u4e00-\u9fff]/;
// "有语言内容"的字符: 汉字/假名/英字/数字 —— 只有标点与符号的片段在两条路径下结果相同,
// 判定无意义, 标为 neutral (不着色)
const CONTENT_RE = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ffA-Za-z0-9]/;

// ---------- 标点归一化 ----------
// AquesTalk 只把 、 。 ？ 与半角 , 当作停顿記号 (实测停顿: 、≈353ms, 。/？≈603ms, ,≈186ms);
// 中文常用的 ，！ 以及 . ! ? 会被直接忽略 → 停顿消失。这里统一映射为 AquesTalk 认得的記号。
const PUNCT_MAP = new Map([
  ["，", "、"],   // 全角逗号 → 顿号
  ["；", "、"],   // 全角分号
  [";", "、"],
  ["：", "、"],   // 全角冒号
  ["！", "。"],   // 感叹 → 句末长停顿
  ["!", "。"],
  ["？", "？"],   // 保留 (AquesTalk 原生)
  ["?", "？"],
  ["。", "。"],   // 保留 (AquesTalk 原生)
  ["…", "。"],
  ["‥", "。"],
]);

// `.` → `。`, 但避开小数/版本号 (两侧都是数字时不动)
export function normalizePunctuation(s) {
  if (!s) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === ".") {
      const prev = s[i - 1], next = s[i + 1];
      if (!(prev >= "0" && prev <= "9" && next >= "0" && next <= "9")) { out += "。"; continue; }
      out += ch;
      continue;
    }
    out += PUNCT_MAP.get(ch) ?? ch;
  }
  return out;
}

// ---------- 停顿前 ' 的去爆音处理 ----------
// 实测: ' 紧跟停顿記号(、。？,) 时 AquesTalk 会把当前音在任意幅值处硬切到 0
// (例: "ドン'、" 切断幅值 14783 = 45% 满幅) → 听感是 "bo" 一类闷响/爆音。
// ' 的语义是"其后音高下降", 而停顿本身已是边界; 官方输出也从不让 ' 紧邻停顿, 故这些位置去掉。
// 注: 文本**末尾**的尾高 ' (官方: 川→カワ') 按"完全保真"保留, 不处理。
const ACCENT_BEFORE_PAUSE = /'(?=[、。？,])/g;
export function stripClickAccents(s) {
  if (!s) return s;
  return s.replace(ACCENT_BEFORE_PAUSE, "");
}

// 自动判别该段是中文还是日文:
//   含平假名/片假名 → 日文 (日文句子必有假名)
//   纯汉字: 日文词典查不到读音的汉字占比 >= 0.3 → 中文
export function looksChinese(dict, text) {
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return false;
  if (!HAN_RE.test(text)) return false;
  const segs = dict.segment(text);
  let han = 0, unresolved = 0;
  for (const s of segs) {
    if (HAN_RE.test(s.surface)) { han++; if (!s.reading) unresolved++; }
  }
  return han > 0 && unresolved / han >= 0.3;
}

// 逐段转换
//   dict: bakak2k 词典实例
//   text: 原始输入(可含 [zh]...[/zh] / [ja]...[/ja])
//   flat: true = 棒读(无音高)
//   forceLang: 'zh'|'ja'|null — 未标记段的强制语言 (null = 自动判别); 有标签的段始终以标签为准
// 返回 { parts: [{text, lang, zh, source, kana}], kana, dropped, tags }
//   source: 'tag'(标签决定) | 'auto'(自动判别) | 'forced'(下拉/参数强制)
export function convertSegments(dict, text, { flat = false, forceLang = null } = {}) {
  const { segments, tags } = parseLangTags(text);
  const parts = [];
  const dropped = [];
  for (const seg of segments) {
    if (!seg.text) continue;
    // 纯标点/符号段: 两条路径结果相同, 不判定语言
    if (!CONTENT_RE.test(seg.text)) {
      parts.push({ text: seg.text, lang: null, zh: null, source: "none", kana: stripClickAccents(normalizePunctuation(seg.text)) });
      continue;
    }
    let source, zh;
    if (seg.lang) { zh = seg.lang === "zh"; source = "tag"; }
    else if (forceLang) { zh = forceLang === "zh"; source = "forced"; }
    else { zh = looksChinese(dict, seg.text); source = "auto"; }
    let kana;
    if (zh) {
      kana = flat ? chineseToKana(seg.text) : chineseToKanaAccent(seg.text);
    } else {
      const r = convertJapanese(dict, seg.text, { accent: !flat });
      kana = r.kana;
      dropped.push(...r.dropped);
    }
    // 标点归一化 (中文 ，！ 等 → AquesTalk 认得的停顿記号)
    parts.push({ text: seg.text, lang: seg.lang, zh, source, kana: stripClickAccents(normalizePunctuation(kana)) });
  }
  // 跨段边界也可能出现 ' 紧跟停顿 (前段结尾的 ' + 后段开头的停顿), 故对拼接结果再做一次
  return { parts, kana: stripClickAccents(parts.map((p) => p.kana).join("")), dropped, tags };
}
