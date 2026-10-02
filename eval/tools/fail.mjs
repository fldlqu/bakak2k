// _fail.mjs — 全不一致文について、公式 raw (マーカー付き) と我々の句を並べる
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
const clean = (s) => s.replace(/<[^>]*>/g, '').replace(/[_/。、,，！？!?+＋]/g, '');
const noAcc = (s) => s.replace(/'/g, '');
const hasNum = (s) => /<NUMK|<NUM[ >]/.test(s);
const truth = {};
const TRUTH_FILE = process.env.K2K_TRUTH || path.join(K2K, 'eval/truth_dev140.txt');
const CORPUS_FILE = process.env.K2K_CORPUS || path.join(K2K, 'eval/corpus_dev140.txt');
for (const line of fs.readFileSync(TRUTH_FILE, 'utf8').split('\n')) {
  const m = line.match(/^(\S+)\t→\t0 "(.*)"$/); if (m) truth[m[1]] = m[2];
}
const sents = fs.readFileSync(CORPUS_FILE, 'utf8').split('\n').filter(Boolean);
let n = 0;
for (const s of sents) {
  const off = truth[s]; if (off === undefined || hasNum(off)) continue;
  const offN = clean(off), oursN = clean(applyEvalMask(convertJapanese(dict, s).kana));
  if (oursN === offN) continue;
  n++;
  console.log(`\n[${n}] ${s}`);
  console.log(`  公式: ${applyEvalMask(off)}`);
  console.log(`  我々: ${applyEvalMask(convertJapanese(dict, s).kana)}`);
  console.log(`  公式raw: ${convert(s).out}`);
  for (const g of debugPhrases(dict, s, { compoundJoin: true })) {
    console.log(`     ${g.phrase ? (noAcc(oursN) === noAcc(offN) ? '[句]' : '[句]') + ' ' + g.phrase + ` cut=${g.cut}` : '[txt] ' + g.text}`);
  }
}
console.log(`\n計 ${n} 文不一致`);
