// lang_tag.js — 文本内的语言标签: 由用户标记决定该段汉字按中文还是日文处理
// 用法: 在输入里写 [zh] / [ja] (也接受 [cn]/[中]/[中文] 与 [jp]/[日]/[日语]/[日本語], 大小写不敏感)
//   例: "[zh]你好"      → 强制中文
//       "[ja]東京都"    → 强制日文
//       "[ja]東京 [zh]你好" → 第一个标签(ja)决定语言; 所有标签都会从待合成文本中剥离
// 说明: 本模块只做"解析与剥离", 不决定"标签 vs 显式选项"的优先级 —— 那是调用方的策略。
const ZH_RE = /\[\s*(?:zh|cn|中|中文)\s*\]/i;
const JA_RE = /\[\s*(?:ja|jp|日|日语|日本語)\s*\]/i;
const ANY_RE = /\[\s*(?:zh|cn|中|中文|ja|jp|日|日语|日本語)\s*\]/gi;
const ANY_TEST_RE = /\[\s*(?:zh|cn|中|中文|ja|jp|日|日语|日本語)\s*\]/i;   // 非全局: 避免 test() 的 lastIndex 状态

// 返回 { lang: 'zh'|'ja'|null, text: 剥离标签后的文本, tags: 命中的标签原文[] }
export function parseLangTag(text) {
  if (!text) return { lang: null, text: text ?? "", tags: [] };
  const tags = text.match(ANY_RE) || [];
  let lang = null;
  // 第一个标签决定语言
  for (const t of tags) {
    if (ZH_RE.test(t)) { lang = "zh"; break; }
    if (JA_RE.test(t)) { lang = "ja"; break; }
  }
  const stripped = text.replace(ANY_RE, "");
  return { lang, text: stripped, tags };
}

// 文本里是否含语言标签 (用于 UI 提示)
export function hasLangTag(text) {
  return !!text && ANY_TEST_RE.test(text);
}
