// _pmat.mjs — 頭(自立語) × 付属語 のアクセント行列を公式に問い合わせて規則を帰納する
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const K2K = path.resolve(__dirname, '../..');
const { createDict } = await import('../../core/engine.js');
const { convertJapanese } = await import('../../core/kanji_accent.js');
const { applyEvalMask } = await import('../../core/en_rules.js');
const { convert } = await import('./official_mut.mjs');
const dict = createDict(fs.readFileSync(path.join(K2K, 'work/aqdic.bin')));
const clean = (s) => s.replace(/[_/。、+＋]/g, '');
const heads = (process.env.HEADS || '読み,買い,見,食べ,話し,会社,山,飴,行き,取り,書き,飲み').split(',');
const parts = (process.env.PARTS || 'は,が,を,に,で,と,も,の,へ,や,から,まで,より,だけ,しか,など').split(',');
// 頭の情報
const info = {};
for (const h of heads) {
  const e = dict.get(h);
  info[h] = e ? e[0].records.map((r) => `${r.text}/a${r.accent}/m${r.mora}/p${r.pos}`).join(' ') : '?';
}
for (const h of heads) console.log(`${h.padEnd(4)} ${info[h]}`);
console.log();
const H = (s) => s.padEnd(12);
let header = '頭\\付属'.padEnd(6);
for (const p of parts) header += p.padEnd(10);
console.log(header);
for (const h of heads) {
  let line = h.padEnd(6);
  for (const p of parts) {
    const s = h + p;
    const off = clean(applyEvalMask(convert(s).out));
    const us = clean(applyEvalMask(convertJapanese(dict, s).kana));
    line += (off === us ? ' ' : '!') + off.padEnd(9);
  }
  console.log(line);
}
console.log('\n(! = 我々と不一致)');
