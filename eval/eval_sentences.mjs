// _eval_sentences.mjs — 句子级一致率评估 (官方 AqKanji2Koe.dll 真值对拍)
// 用法: node --no-warnings re/engines/k2k/work/probes/_eval_sentences.mjs [--all] [--detail]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../../..');           // 项目根 (aquestalk.js)
const K2K = path.resolve(__dirname, '..');                  // re/engines/k2k
const { createDict } = await import('../core/engine.js');
const { convertJapanese } = await import('../core/kanji_accent.js');
const { applyEvalMask } = await import('../core/en_rules.js');

const argv = process.argv.slice(2);
const DETAIL = argv.includes('--detail');
const SHOW_ALL = argv.includes('--all');

const truth = {};
const TRUTH_FILE = process.env.K2K_TRUTH || path.join(__dirname, 'truth_dev140.txt');
const CORPUS_FILE = process.env.K2K_CORPUS || path.join(__dirname, 'corpus_dev140.txt');
for (const line of fs.readFileSync(TRUTH_FILE, 'utf8').split('\n')) {
  const m = line.match(/^(\S+)\t→\t0 "(.*)"$/); if (m) truth[m[1]] = m[2];
}
const clean = (s) => s.replace(/<[^>]*>/g, '').replace(/[_/。、,，！？!?+＋]/g, '');
const noAcc = (s) => s.replace(/'/g, '');
const hasNum = (s) => /<NUMK|<NUM[ >]/.test(s);
const sents = fs.readFileSync(CORPUS_FILE, 'utf8').split('\n').filter(Boolean);
const dict = createDict(fs.readFileSync(path.join(K2K, 'work/aqdic.bin')));

const OPTS = JSON.parse(process.env.K2K_OPTS || '{}');
const rows = [];
function run(opts) {
  let exact = 0, accBad = 0, kanaBad = 0;
  const bad = { acc: [], kana: [] };
  for (const s of sents) {
    const off = truth[s]; if (off === undefined || hasNum(off)) continue;
    const offN = clean(off);
    const oursN = clean(applyEvalMask(convertJapanese(dict, s, { ...OPTS, ...opts }).kana));
    if (oursN === offN) exact++;
    else if (noAcc(oursN) === noAcc(offN)) { accBad++; bad.acc.push([s, offN, oursN]); }
    else { kanaBad++; bad.kana.push([s, offN, oursN]); }
  }
  return { exact, accBad, kanaBad, t: exact + accBad + kanaBad, bad };
}

if (DETAIL) {
  const r = run({ accentPolicy: OPTS.accentPolicy ?? 'dedupe', particleAccent: OPTS.particleAccent ?? true, ...(OPTS.accentModel ? { accentModel: OPTS.accentModel } : {}) });
  const show = (list) => list.forEach(([s, o, u]) => {
    console.log(`  句: ${s}\n  官方: ${o}\n  我们: ${u}`);
    const segs = dict.toKanaDetailed(s);
    console.log('  分词: ' + segs.map((x) => `${x.surface}[${x.reading ?? '-'}|a${x.accent}|m${x.mora}|p${x.pos}|c${x.cost}]`).join(' '));
    console.log('');
  });
  console.log('=== アクセント错 ==='); show(r.bad.acc);
  console.log('=== 读音/分词错 ==='); show(r.bad.kana);
  console.log(`一致 ${r.exact}/${r.t}`);
  process.exit(0);
}

const configs = [];
if (SHOW_ALL) {
  for (const policy of ['all', 'dedupe']) for (const pa of [true, false]) configs.push([`accentModel=dedupe accentPolicy=${policy.padEnd(7)} 助词规则=${pa ? 'ON ' : 'off'}`, { accentModel: 'dedupe', accentPolicy: policy, particleAccent: pa }]);
}
for (const cj of [true, false]) configs.push([`accentModel=phrase    複合語結合=${cj ? 'ON ' : 'off'}`, { accentModel: 'phrase', compoundJoin: cj }]);
if (!SHOW_ALL) configs.unshift([`accentModel=dedupe  accentPolicy=${(OPTS.accentPolicy ?? 'dedupe').padEnd(7)}`, { accentModel: 'dedupe', accentPolicy: OPTS.accentPolicy ?? 'dedupe', particleAccent: true }]);
for (const [label, opts] of configs) {
  const r = run(opts);
  console.log(`${label} 一致 ${r.exact}/${r.t} = ${(r.exact / r.t * 100).toFixed(1)}%   アクセント错 ${r.accBad}   读音/分词错 ${r.kanaBad}`);
}
