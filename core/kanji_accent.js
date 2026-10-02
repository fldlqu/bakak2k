// kanji_accent.js — 日文路径统一实现 (webui 与 CLI 共用, 消除此前两处重复)
//   - 汉字/假名 → 片假名
//   - accent: 插入アクセント記号 ' (下降核)
//   - 无读音汉字的兜底: 绝不把裸汉字送进 AquesTalk (那会产生乱音/静音)
import { chineseToKana, chineseToKanaAccent } from "./zh_kana.js";

// 拗音/小写假名 (与前一拍同拍, 不新开 mora)
export const SMALL_KANA = new Set("ャュョァィゥェォヮヶヵゎ");

// 返回 ' 的插入位置 (字符索引); -1 = 不加
// 规则 (v86 跑官方 AqKanji2Koe.dll 实证, 汉字输入):
//   accent = 核拍 (1-based)
//   accent < mora  → ' 放在第 accent 拍结束后 (词内下降核)
//   accent == mora → 尾高: ' 放在词尾 (官方: 川→カワ', 山→ヤマ', 花→ハナ', 犬→イヌ')
//   accent == 0 / > mora (平板・助词) → 不加
export function accentPos(reading, accent, mora) {
  if (accent >= 1 && accent === mora) return reading.length;   // 尾高 → 词尾
  if (!(accent >= 1 && accent < mora)) return -1;
  let m = 0;
  for (let i = 0; i < reading.length; i++) {
    const ch = reading[i];
    if (SMALL_KANA.has(ch)) continue;
    m++;
    if (m === accent) {
      let j = i;
      while (j + 1 < reading.length && SMALL_KANA.has(reading[j + 1])) j++;
      return j + 1;
    }
  }
  return -1;
}

const HAN_RE = /[\u4e00-\u9fff]/;

// 日文路径转换。返回 { kana, dropped }
//   accent      true = 带 ' 音高
//   zhFallback  true = 无读音的汉字改用中文读音兜底 (尽力保留内容)
//   dropped     既无日文读音、中文也读不出的字符 (已丢弃, 不进入引擎)
export function convertJapanese(dict, text, { accent = true, zhFallback = true } = {}) {
  const segs = dict.toKanaDetailed(text);
  let out = "";
  const dropped = [];
  for (const s of segs) {
    if (!s.reading) {
      const isHan = HAN_RE.test(s.surface);
      if (isHan && zhFallback) {
        // 兜底只为"取到读音", 不套用中文句末降调 (否则片段会多出一个前导 ')
        const alt = chineseToKana(s.surface);
        if (alt && !HAN_RE.test(alt)) { out += alt; continue; }   // 兜底成功
      }
      if (isHan) { dropped.push(s.surface); continue; }           // 丢弃, 避免裸汉字进引擎
      out += s.surface;                                          // 标点/英文等原样保留
      continue;
    }
    const r = s.reading;
    if (accent) {
      const pos = accentPos(r, s.accent, s.mora);
      out += pos >= 0 ? r.slice(0, pos) + "'" + r.slice(pos) : r;
    } else {
      out += r;
    }
  }
  return { kana: out.replace(/[ \u3000]/g, ""), dropped };
}
