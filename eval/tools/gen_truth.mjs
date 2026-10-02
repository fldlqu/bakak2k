// gen_truth.mjs — 公式 AqKanji2Koe.dll を v86 で走らせ、任意コーパスの真値を生成する
//
//   node --no-warnings eval/tools/gen_truth.mjs <corpus.txt> <out_truth.txt>
//
// 出力形式は eval/truth_dev140.txt と同じ (`文\t→\t0 "公式出力"`)。
// これで eval_sentences.mjs の K2K_CORPUS / K2K_TRUTH に渡せる。
//
// 前提: work/probes/aqk2k_win/lib/AqKanji2Koe.dll と work/aqdic.bin (どちらも未追跡)。
// 注意:
//   * 公式 DLL は評価版 (ナ行/マ行 → ヌ)。比較側で applyEvalMask を掛ける。
//   * 純仮名だけの入力は別経路を通るので、漢字を含む文だけを真値に使う。
//   * <NUMK ...> / <NUM ...> を含む文は比較できない (番号読みは未移植) ので除外。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const K2K = path.resolve(__dirname, "../..");
const { convert } = await import(path.join(K2K, "work/probes/_official.mjs"));

const [, , corpusPath, outPath] = process.argv;
if (!corpusPath || !outPath) {
  console.error("usage: node eval/tools/gen_truth.mjs <corpus.txt> <out_truth.txt>");
  process.exit(1);
}
const HAN = /[\u4e00-\u9fff]/;
const sents = fs.readFileSync(corpusPath, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
const lines = [];
let skipped = 0;
for (const s of sents) {
  if (!HAN.test(s)) { skipped++; continue; }              // 純仮名は別経路
  const r = convert(s);
  if (r.err || r.out == null) { skipped++; continue; }
  if (/<NUMK|<NUM[ >]/.test(r.out)) { skipped++; continue; }
  lines.push(`${s}\t→\t0 "${r.out.replace(/"/g, "'")}"`);
}
fs.writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`wrote ${lines.length} lines to ${outPath} (skipped ${skipped})`);
