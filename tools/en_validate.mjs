import { readFileSync } from 'node:fs';
import { englishToKana, applyEvalMask } from '../src/en_rules.js';

const corpus = JSON.parse(readFileSync(new URL('../test/en_corpus.json', import.meta.url))).dll;

// normalize a DLL koe output for comparison: strip accent/pause markers
function norm(s) {
  return s.replace(/[、。\.,'/_]/g, '');
}

let letterHit = 0, wordHit = 0, total = 0;
const misses = [];
for (const [word, dll] of corpus) {
  if (!/^[A-Za-z]+$/.test(word) || word.length === 1) continue;
  total++;
  const ours = englishToKana(word);
  if (ours == null) { misses.push([word, dll, 'NONE']); continue; }
  // evaluate-license mask on BOTH sides so n/m rows are excluded from comparison
  const got = applyEvalMask(norm(ours));
  const want = applyEvalMask(norm(dll));
  const kind = ours === dll ? 'exact' : (word.toLowerCase().length <= 3 ? 'letter' : 'word');
  if (got === want) {
    if (kind === 'letter') letterHit++;
    else wordHit++;
  } else {
    misses.push([word, dll, got]);
  }
}
console.log(`total=${total}  letter-pass=${letterHit}  word-pass=${wordHit}  (masked-match)`);
console.log(`exact-string hits (incl mask): top-level`);
const exact = corpus.filter(([w, d]) => typeof englishToKana(w) === 'string' && englishToKana(w) === d);
console.log(`exact==dll: ${exact.length}`);
console.log(`\n--- misses (first 60) ---`);
for (const m of misses.slice(0, 60)) console.log(`${m[0]}  dll=${JSON.stringify(m[1])}  ours=${JSON.stringify(m[2])}`);