// _model.mjs — 公式(オラクル)語列のコスト vs 我々 Viterbi のコストを比較し、
//              コストモデルの妥当性を検証する。
// 用法: node --no-warnings _model.mjs "十年前" ["何度も" ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const K2K = path.resolve(__dirname, '../..');
const { createDict } = await import('../../core/engine.js');
const dict = createDict(fs.readFileSync(path.join(K2K, 'work/aqdic.bin')));
const { officialSeq, MCELL, idx, W } = await import('./seq.mjs');
const { convert } = await import('./official_mut.mjs');

const sents = process.argv.slice(2).filter((a) => !a.startsWith('--'));
for (const sent of sents) {
  const { base, hits } = officialSeq(sent);
  console.log(`\n### ${sent}  =>  ${base}`);
  // official path (assume each hit occupies its surface span; sort by i)
  hits.sort((a, b) => a.i - b.i);
  const off = hits.map((h) => ({ surf: h.surface, i: h.i, rec: h.rec }));
  const showPath = (p) => p.map((x) => `${x.surf}(${x.rec.text},c${x.rec.cost},idx${idx(x.rec.pos)})`).join(' + ');
  const costOf = (p, opts = {}) => {
    let c = 0; for (const x of p) c += x.rec.cost;
    for (let k = 1; k < p.length; k++) {
      const v = MCELL(idx(p[k].rec.pos), idx(p[k - 1].rec.pos));
      c += opts.zeroInf && v === 0 ? 100000 : v;
    }
    if (opts.bos && p.length) c += MCELL(idx(p[0].rec.pos), 0);
    if (opts.eos && p.length) c += MCELL(0, idx(p[p.length - 1].rec.pos));
    return c;
  };
  // our segmentation
  const segs = dict.toKanaDetailed(sent);
  const our = [];
  {
    const walk = dict.segment(sent);
    for (const w of walk) {
      const r = w.reading; if (!r || r.pos == null) { our.push({ surf: w.surface, rec: { text: r?.text ?? '?', cost: 0, pos: 0x7fff } }); continue; }
      our.push({ surf: w.surface, rec: { text: r.text, cost: r.cost ?? 0, pos: r.pos } });
    }
  }
  console.log(`公式語列 (${off.length}): ${showPath(off)}`);
  console.log(`我々語列 (${our.length}): ${showPath(our)}`);
  for (const [label, opts] of [['word+M[next][prev]', {}], ['+BOS/EOS(idx0)', { bos: 1, eos: 1 }], ['0=∞', { zeroInf: 1 }], ['0=∞ +BOS/EOS', { zeroInf: 1, bos: 1, eos: 1 }]]) {
    const co = costOf(off, opts), cu = costOf(our, opts);
    console.log(`   ${label.padEnd(18)} 公式=${co}  我々=${cu}  ${co <= cu ? 'OK' : '*** 公式が高い (モデル不備) ***'}`);
  }
}
