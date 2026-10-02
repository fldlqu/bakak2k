// _align.mjs — 公式の生出力 (マーカー付き) と我々のアクセント句を並べて表示
// 用法: node --no-warnings _align.mjs "文1" "文2" ...
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const K2K = path.resolve(__dirname, '../..');
const { createDict } = await import('../../core/engine.js');
const { convertJapanese, debugPhrases } = await import('../../core/kanji_accent.js');
const { applyEvalMask } = await import('../../core/en_rules.js');
const { convert } = await import('./official_mut.mjs');
const dict = createDict(fs.readFileSync(path.join(K2K, 'work/aqdic.bin')));

for (const s of process.argv.slice(2)) {
  if (s.startsWith('--')) continue;
  console.log(`\n### ${s}`);
  console.log(`公式 raw: ${convert(s).out}`);
  const ours = convertJapanese(dict, s).kana;
  console.log(`我々  raw: ${ours}`);
  console.log(`公式mask: ${applyEvalMask(convert(s).out)}`);
  console.log(`我々 mask: ${applyEvalMask(ours)}`);
  const ph = debugPhrases(dict, s, { compoundJoin: true });
  for (const g of ph) console.log(`   ${g.phrase ? '[句] ' + g.phrase + `  cut=${g.cut}` : '[txt] ' + g.text}`);
}
