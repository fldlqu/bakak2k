import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kanaFromNumber, matchNumber, kanaInt } from '../core/num.js';

test('kanaInt: value reading with place units', () => {
  assert.equal(kanaInt('0'), 'ゼロ');
  assert.equal(kanaInt('10'), 'ジュウ');
  assert.equal(kanaInt('15'), 'ジュウゴ');
  assert.equal(kanaInt('100'), 'ヒャク');
  assert.equal(kanaInt('300'), 'サンビャク');      // 音便
  assert.equal(kanaInt('600'), 'ロッピャク');      // 音便
  assert.equal(kanaInt('800'), 'ハッピャク');      // 音便
  assert.equal(kanaInt('1000'), 'セン');
  assert.equal(kanaInt('3000'), 'サンゼン');
  assert.equal(kanaInt('8000'), 'ハッセン');
  assert.equal(kanaInt('1234'), 'センニヒャクサンジュウヨン');
  assert.equal(kanaInt('2024'), 'ニセンニジュウヨン');
  assert.equal(kanaInt('1000000'), 'ヒャクマン');
  assert.equal(kanaInt('1234567890'), 'ジュウニオクサンゼンヨンヒャクゴジュウロクマンナナセンハッピャクキュウジュウ');
});

test('kanaFromNumber: split rules mirror the DLL', () => {
  assert.equal(kanaFromNumber('123'), 'ヒャクニジュウサン');          // <=4 位 数值读
  assert.equal(kanaFromNumber('12345'), 'イチニサンヨンゴ');          // >=5 位 逐位
  assert.equal(kanaFromNumber('2024'), 'ニセンニジュウヨン');
  assert.equal(kanaFromNumber('12,345'), 'イチマンニセンサンビャクヨンジュウゴ'); // 千分位 -> 数值读
  assert.equal(kanaFromNumber('090'), 'ゼロキュウゼロ');              // 前导0 逐位
  assert.equal(kanaFromNumber('090-1234-5678'), 'ゼロキュウゼロイチニサンヨンゴロクナナハチ');
  assert.equal(kanaFromNumber('3.14'), 'サンテンイチヨン');
  assert.equal(kanaFromNumber('0.5'), 'ゼロテンゴ');
  assert.equal(kanaFromNumber('0.05'), 'ゼロテンゼロゴ');
  assert.equal(kanaFromNumber('-5'), 'マイナスゴ');
  assert.equal(kanaFromNumber('+5'), 'プラスゴ');
  assert.equal(kanaFromNumber('10%'), 'ジュウパーセント');
});

test('matchNumber: run boundaries', () => {
  const s = '価格3.14円です、10%オフ';
  let i = 0;
  const got = [];
  while (i < s.length) {
    const m = matchNumber(s, i);
    if (m) { got.push(m.token); i += m.len; }
    else { i++; }
  }
  assert.deepEqual(got, ['3.14', '10%']);
  // sign-only and trailing punct are not numbers
  assert.equal(matchNumber('abc', 0), null);
  assert.equal(matchNumber('-', 0), null);
  assert.equal(matchNumber('2024/1/1', 0)?.token, '2024');
});