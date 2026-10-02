// _p2.mjs — 公式 vs 我々 を大量の文字列で比較 (アクセント規則の帰納用)
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
const VERBOSE = process.argv.includes('-v');
const clean = (s) => s.replace(/[_/。、+＋]/g, '');
const words = process.argv.slice(2).filter((a) => !a.startsWith('-'));
let ng = 0;
for (const w of words) {
  // 文字列は "、" 区切りで連結して 1 文にする (各要素は独立に生成)
  const parts = w.split('|');
  for (const p of parts) {
    if (!p) continue;
    const o = clean(applyEvalMask(convert(p).out));
    const u = clean(applyEvalMask(convertJapanese(dict, p).kana));
    const ok = o === u;
    if (!ok) ng++;
    console.log(`${ok ? 'OK ' : 'NG '} ${p.padEnd(14)} 公式=${convert(p).out.padEnd(22)} 我々=${convertJapanese(dict, p).kana}`);
    if (!ok && VERBOSE) {
      for (const g of debugPhrases(dict, p, { compoundJoin: true })) console.log(`       ${g.phrase ? '[句] ' + g.phrase + ` cut=${g.cut}` : '[txt] ' + g.text}`);
    }
  }
}
console.log(`\nNG ${ng}/${words.reduce((a, w) => a + w.split('|').filter(Boolean).length, 0)}`);
