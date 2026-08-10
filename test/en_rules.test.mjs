import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { englishToKana, applyEvalMask, WORD_TABLE } from '../src/en_rules.js';

const norm = (s) => s.replace(/[、。’‘_/.,']/g, '');
const corpus = JSON.parse(readFileSync(new URL('../test/en_corpus.json', import.meta.url))).dll;

test('englishToKana: word table hits', () => {
  assert.equal(englishToKana('google'), 'グーグル');
  assert.equal(englishToKana('windows'), 'ウインドウズ');
  assert.equal(englishToKana('computer'), 'コムプター');
  assert.equal(englishToKana('morning'), 'モーニング');
});

test('englishToKana: letter spelling for <=3 and short unknowns', () => {
  assert.equal(englishToKana('URL'), 'ユーアールエル');
  assert.equal(englishToKana('PC'), 'ピーシー');
  assert.equal(englishToKana('go'), 'ジーオー'); // DLL spells GO
});

test('evaluate-license mask affects only ナ行/マ行', () => {
  assert.equal(applyEvalMask('カタカナ'), 'カタカヌ');
  assert.equal(applyEvalMask('ナマモミ'), 'ヌヌヌヌ');
  assert.equal(applyEvalMask('ラー'), 'ラー'); // ン untouched, non-row untouched
});

test('full corpus masked-match stays 100%', () => {
  const bad = [];
  for (const [w, dll] of corpus) {
    if (!/^[A-Za-z]+$/.test(w) || w.length === 1) continue;
    const ours = englishToKana(w);
    if (ours == null) { bad.push(w); continue; }
    if (applyEvalMask(norm(ours)) !== applyEvalMask(norm(dll))) bad.push(w);
  }
  assert.deepEqual(bad, [], 'masked comparison must pass for every corpus word');
});

test('word table is sorted', () => {
  const keys = [...WORD_TABLE.keys()];
  assert.deepEqual(keys, [...keys].sort((a, b) => a.localeCompare(b)));
});