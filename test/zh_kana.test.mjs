import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P2K, chineseToKana, chineseToKanaAccent } from '../core/zh_kana.js';
import { pinyin } from 'pinyin-pro';

// 全部真实普通话音节 (数据来源: 对 CJK 全域扫描 pinyin-pro 的输出取并集)
function realSyllables() {
  const RANGES = [[0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xf900, 0xfaff], [0x20000, 0x2a6df]];
  const set = new Set();
  for (const [lo, hi] of RANGES) {
    for (let cp = lo; cp <= hi; cp++) {
      let p;
      try { p = pinyin(String.fromCodePoint(cp), { toneType: 'none', type: 'array' }); } catch { continue; }
      if (p.length === 1 && /^[a-zü]+$/i.test(p[0])) set.add(p[0].toLowerCase().replace(/ü/g, 'u:'));
    }
  }
  return [...set].sort();
}

test('zh_kana: 所有真实普通话音节都有映射 (无拼音泄漏)', () => {
  const missing = realSyllables().filter((s) => !P2K[s]);
  assert.deepEqual(missing, [], `以下音节会原样泄漏拼音: ${missing.join(' ')}`);
});

test('zh_kana: 表中不含非法音节', () => {
  // 非法音节 = 不存在于真实音节集, 也不是显式登记的不规则读音
  const real = new Set(realSyllables());
  // 不规则读音 (y/w 音节、儿化韵、成音节辅音等) 由 OVERRIDES 提供, 属有意为之
  const IRREGULAR = new Set(['er', 'yi', 'ya', 'ye', 'yao', 'you', 'yan', 'yin', 'yang', 'ying', 'yong',
    'wu', 'wa', 'wo', 'wai', 'wei', 'wan', 'wen', 'wang', 'weng',
    'yu', 'yue', 'yuan', 'yun', 'ju', 'qu', 'xu', 'jue', 'que', 'xue',
    'juan', 'quan', 'xuan', 'jun', 'qun', 'xun',
    'yo', 'lo', 'm', 'n', 'ng', 'hm', 'hng', 'r']);
  const norm = (k) => k.replace(/v/g, 'u:');          // v 是 ü 的常见输入写法, 归一后判定
  const bogus = Object.keys(P2K).filter((s) => !real.has(norm(s)) && !IRREGULAR.has(norm(s)));
  assert.deepEqual(bogus, [], `表中存在非法音节: ${bogus.join(' ')}`);
});

test('zh_kana: 交叉积不再生成非法组合', () => {
  // 21 声母 × 34 韵母 的全交叉积会产出 891 条, 其中大量不是普通话合法音节
  for (const bad of ['bua', 'fua', 'bou', 'fe', 'gi', 'zhiang', 'vua']) {
    assert.equal(P2K[bad], undefined, `${bad} 不应出现在表中`);
  }
  assert.ok(Object.keys(P2K).length < 500, `表条目 ${Object.keys(P2K).length} 应远小于全交叉积 891`);
});

test('zh_kana: 单音节不会被插上无意义的前导 \'', () => {
  // ' 表示"其后的音高下降"; 落在输出开头时没有可下降的对象
  for (const t of ['的', '着', '啊', '哦', '嗯', '妈']) {
    assert.ok(!chineseToKanaAccent(t).startsWith("'"), `${t} 不应有前导 ': ${chineseToKanaAccent(t)}`);
  }
  // 多拍音节与多音节文本的行为不变
  assert.equal(chineseToKanaAccent('好'), 'ハ\'オ');
  assert.equal(chineseToKanaAccent('妈妈'), 'マ\'マ');
  assert.equal(chineseToKanaAccent('谢谢'), 'シェ\'シェ');
});

test('zh_kana: 基本读音', () => {
  assert.equal(chineseToKana('你好，世界'), 'ニハオ，シージェ');   // 标点原样透传, 归一化在 convert_text 层
  assert.equal(chineseToKana('中国人'), 'ジョングオレン');
  assert.equal(chineseToKana('嗯'), 'ン');
  // 非中文原样透传
  assert.equal(chineseToKana('hello你好'), 'helloニハオ');
});
