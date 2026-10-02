// k2k (AqKanji2Koe) CLI 加载适配: fs 读 aqdic.bin → createDict (单一 core, 与 webui 共用)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDict } from "./core/engine.js";
import { convertJapanese } from "./core/kanji_accent.js";
import { convertSegments, looksChinese as coreLooksChinese } from "./core/convert_text.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _dict: ReturnType<typeof createDict> | null = null;

export function getK2KDict(): ReturnType<typeof createDict> {
  if (!_dict) {
    const bytes = fs.readFileSync(path.join(__dirname, "work", "aqdic.bin"));
    _dict = createDict(bytes);
  }
  return _dict;
}

// 汉字/平假名 → 读音片假名 (AquesTalk 可合成)
export function kanjiToKana(text: string): string {
  return convertJapanese(getK2KDict(), text, { accent: false }).kana;
}

// 汉字/平假名 → 带アクセント記号(')的片假名 (accent = 核拍 1-based, ' 放在核拍后)
export function kanjiToKanaAccent(text: string): string {
  return convertJapanese(getK2KDict(), text, { accent: true }).kana;
}

export function looksChinese(text: string): boolean {
  return coreLooksChinese(getK2KDict(), text);
}

// 逐段转换 (闭合标签 [zh]...[/zh] / [ja]...[/ja] + 未标记段自动判别/强制)
export function convertText(text: string, flat = false, forceLang: "zh" | "ja" | null = null) {
  return convertSegments(getK2KDict(), text, { flat, forceLang });
}

// ---------- 中文 (拼音 → 近似中文发音的片假名) ----------
export { chineseToKana, chineseToKanaAccent } from "./core/zh_kana.js";

// ---------- 文本内语言标签 ----------
export { parseLangTags, hasLangTag, uniformLang } from "./core/lang_tag.js";
