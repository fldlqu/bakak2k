// lang_tag.js — 闭合式语言标签: 用 [zh]...[/zh] 或 [ja]...[/ja] 标记某一段按中文/日文处理
//   [zh] 也接受 [cn] [中] [中文];  [ja] 也接受 [jp] [日] [日语] [日本語];  大小写不敏感, 允许内部空格
// 例: "你好，[ja]東京[/ja]!"  → "你好，"(未标记→自动判别) + "東京"(日文) + "!"(未标记)
// 规则:
//   - 标签本身始终从待合成文本中剥离
//   - 未闭合的开放标签 → 作用到文本结尾 (容错)
//   - 孤立的闭标签 → 忽略
//   - 不支持嵌套; 任何闭标签都结束当前语言区
// 返回 lang: 'zh' | 'ja' | null (null = 未标记, 由调用方自动判别)
const ZH_NAMES = "zh|cn|中|中文";
const JA_NAMES = "ja|jp|日|日语|日本語";
const NAMES = `${ZH_NAMES}|${JA_NAMES}`;
const TOKEN_RE = new RegExp(`\\[\\s*(\\/?)\\s*(${NAMES})\\s*\\]`, "gi");
const TEST_RE = new RegExp(`\\[\\s*/?\\s*(?:${NAMES})\\s*\\]`, "i");   // 非全局: 避免 test() 的 lastIndex 状态
const ZH_RE = new RegExp(`^(?:${ZH_NAMES})$`, "i");

export function parseLangTags(text) {
  if (!text) return { segments: [], tags: [] };
  const segments = [];
  const tags = [];
  let cur = null;          // 当前生效语言
  let last = 0;
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text))) {
    const [full, slash, name] = m;
    tags.push(full);
    if (m.index > last) segments.push({ text: text.slice(last, m.index), lang: cur });
    last = m.index + full.length;
    cur = slash ? null : (ZH_RE.test(name) ? "zh" : "ja");
  }
  if (last < text.length) segments.push({ text: text.slice(last), lang: cur });

  // 去掉空段, 合并相邻同语言段
  const merged = [];
  for (const s of segments) {
    if (!s.text) continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.lang === s.lang) prev.text += s.text;
    else merged.push({ text: s.text, lang: s.lang });
  }
  return { segments: merged, tags };
}

export function hasLangTag(text) {
  return !!text && TEST_RE.test(text);
}

// 便利: 若所有段语言一致且非 null, 返回该语言; 否则 null
export function uniformLang(segments) {
  const langs = new Set(segments.map((s) => s.lang));
  return langs.size === 1 ? [...langs][0] : null;
}
