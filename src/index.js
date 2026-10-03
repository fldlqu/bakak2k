export { createDict, createDictWithUser, createDictAuto, AqK2KDict, CODE2KANA, normalizeReading } from './engine.js';
export { parseUserDict } from './userdic.js';
export { extractAqdicFromZip, extractZipEntry, listZipEntries, findZipEntry } from './zip.js';
// ---- アクセント (音高) 付き漢字→かな ----
// 詳細は README の「アクセント」節を参照。
export { convertJapanese, convertJapanesePhrase, accentPos, debugPhrases } from './kanji_accent.js';
export { boundaryTypes, phraseBreaks, phraseAccents, junctionCode, splitMorae, makeNode } from './accent_junction.js';

// ---- 中国語 (拼音 → かな) ----
export { chineseToKana, chineseToKanaAccent, P2K } from './zh_kana.js';

// ---- 言語タグ ([zh]…[/zh] / [ja]…[/ja]) と混在テキスト変換 ----
export { parseLangTags, hasLangTag, uniformLang } from './lang_tag.js';
export { convertSegments, looksChinese, normalizePunctuation, stripClickAccents } from './convert_text.js';
