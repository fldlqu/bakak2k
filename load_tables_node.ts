// k2k (AqKanji2Koe) CLI 加载适配: fs 读 aqdic.bin → createDict (单一 core, 与 webui 共用)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDict } from "./core/engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _dict: ReturnType<typeof createDict> | null = null;

export function getK2KDict(): ReturnType<typeof createDict> {
  if (!_dict) {
    const bytes = fs.readFileSync(path.join(__dirname, "work", "aqdic.bin"));
    _dict = createDict(bytes);
  }
  return _dict;
}

// 汉字/平假名 → 读音片假名 (AquesTalk 可合成); 无汉字时原样返回
export function kanjiToKana(text: string): string {  return getK2KDict().toKana(text);
}

// 带アクセント記号 (' = 下降核) 的转换; 规则与 webui/src/synth/k2k.ts 一致
// (v86 跑官方 AqKanji2Koe.dll 实证: accent = 核拍 1-based, ' 放在第 accent 拍后;
//  accent=0 或 >mora 平板/助词不加。例: 箸→ハ'シ, 東京都→トーキョ'ート)
const SMALL = new Set("ャュョァィゥェォヮヶヵゎ");
function accentPos(reading: string, accent: number, mora: number): number {
  if (!(accent >= 1 && accent <= mora)) return -1;
  let m = 0;
  for (let i = 0; i < reading.length; i++) {
    const ch = reading[i];
    if (SMALL.has(ch)) continue;
    m++;
    if (m === accent) {
      let j = i;
      while (j + 1 < reading.length && SMALL.has(reading[j + 1])) j++;
      return j + 1;
    }
  }
  return -1;
}

export function kanjiToKanaAccent(text: string): string {
  const dict = getK2KDict();
  const segs = dict.toKanaDetailed(text);
  let out = "";
  for (const s of segs) {
    if (!s.reading) { out += s.surface; continue; }
    const pos = accentPos(s.reading, s.accent, s.mora);
    if (pos >= 0) out += s.reading.slice(0, pos) + "'" + s.reading.slice(pos);
    else out += s.reading;
  }
  return out.replace(/[ \u3000]/g, "");
}

// ---------- 中文 (拼音 → 近似中文发音的片假名) ----------
export { chineseToKana, chineseToKanaAccent } from "./core/zh_kana.js";

// ---------- 文本内语言标签 ([zh]/[ja]) ----------
export { parseLangTag, hasLangTag } from "./core/lang_tag.js";

// 判断文本是否更像中文:
//   含平假名/片假名 → 日文; 纯汉字: 日文词典查不到读音的汉字占比 >= 0.3 → 中文
export function looksChinese(text: string): boolean {
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return false;   // 假名 → 日文
  if (!/[\u4e00-\u9fff]/.test(text)) return false;
  const segs = getK2KDict().segment(text);
  let han = 0, unresolved = 0;
  for (const s of segs) {
    if (/[\u4e00-\u9fff]/.test(s.surface)) {
      han++;
      if (!s.reading) unresolved++;
    }
  }
  return han > 0 && unresolved / han >= 0.3;
}
