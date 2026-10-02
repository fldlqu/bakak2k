// boundary_verify.mjs — アクセント句境界型分類器 (RVA 0xbc00) の等価性検証
//
//   node --no-warnings eval/tools/boundary_verify.mjs <corpus.txt> [...]
//
// 公式 DLL を v86 で走らせ、分類器が語ノードに書いた [node+0x42] を実測し、
// core/accent_junction.js の boundaryTypes() が同じ値を返すかを文単位で照合する。
//
// 仕掛け:
//   * RVA 0xbc00 の入口を OUT トランポリンに差し替え、分類器が読む入力
//     (posIdx / mora / accent / jcnt / jval / record[+5] / record[+6]) を全部記録する
//   * RVA 0x3bf0 (アクセント結合ディスパッチャ) の入口で [node+0x42] を読む
//     (= 分類器 + 補正パスの最終結果)
//   * 語数が一致しない文 (読点ノードが語列に混ざる等) は対象外として数える
//
// 前提: work/probes/aqk2k_win/lib/AqKanji2Koe.dll と work/aqdic.bin (未追跡)。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const K2K = path.resolve(__dirname, "../..");
const { emu, BASE, convert, shadow } = await import(path.join(K2K, "eval/tools/accent_trace.mjs"));
const { boundaryTypes } = await import(path.join(K2K, "core/accent_junction.js"));
const { createDict } = await import(path.join(K2K, "core/engine.js"));

const rd32 = (a) => { const m = emu.mem_read(a, 4); return (m[0] | (m[1] << 8) | (m[2] << 16) | (m[3] << 24)) >>> 0; };
const rd16 = (a) => { const m = emu.mem_read(a, 2); return m[0] | (m[1] << 8); };
const w8 = (a, v) => emu.mem_write(a, new Uint8Array([v & 0xff]));

const ENTRY = BASE + 0xbc00;                 // 分類器
const DISP = BASE + 0x3bf0;                  // ディスパッチャ
const ORIG_ENTRY = new Uint8Array([0x55, 0x8B]);
const ORIG_DISP = new Uint8Array([0x55, 0x8B]);
const PORT_IN = 0xC6, PORT_T42 = 0xC7;

let input = null, t42 = null;

emu.cpu.io.register_write(PORT_IN, emu, () => {
  if (!input) {
    const esp = emu.reg_read(4) >>> 0;
    const vec = rd32(esp + 4);
    const ecx = emu.reg_read(1) >>> 0;
    const begin = rd32(vec), end = rd32(vec + 4);
    const n = ((end - begin) / 4) | 0;
    const pos1 = rd32(ecx);
    const p1off = pos1 - 0x40000000;
    const count = (p1off >= 0 && p1off < shadow.length) ? (shadow[p1off + 0x18] | (shadow[p1off + 0x19] << 8)) : 0;
    input = [];
    for (let i = 0; i < n; i++) {
      const nd = rd32(begin + i * 4);
      const w = rd32(nd), rec = rd32(w + 0x10), ro = rec - 0x40000000;
      const ok = ro >= 0 && ro + 8 < shadow.length;
      const idx = ok ? ((shadow[ro] | (shadow[ro + 1] << 8)) & 0x7fff) : null;
      input.push({
        idx,
        mora: rd32(nd + 4),
        accent: rd16(nd + 0x40),
        jcnt: rd32(nd + 0x24),
        jcls: [0, 1, 2].map((k) => rd32(nd + 0x28 + k * 4)),
        jval: [0, 1, 2].map((k) => rd32(nd + 0x34 + k * 4)),
        mb: ok ? shadow[ro + 5] : 0,
        ab: ok ? shadow[ro + 6] : 0,
      });
    }
  }
  w8(ENTRY, ORIG_ENTRY[0]); w8(ENTRY + 1, ORIG_ENTRY[1]);
  emu.set_eip(ENTRY);
});
emu.cpu.io.register_write(PORT_T42, emu, () => {
  if (!t42) {
    const esp = emu.reg_read(4) >>> 0;
    const vec = rd32(esp + 4);
    const begin = rd32(vec), end = rd32(vec + 4);
    const n = ((end - begin) / 4) | 0;
    t42 = [];
    for (let i = 0; i < n; i++) t42.push(rd16(rd32(begin + i * 4) + 0x42));
  }
  w8(DISP, ORIG_DISP[0]); w8(DISP + 1, ORIG_DISP[1]);
  emu.set_eip(DISP);
});

export function probe(text) {
  w8(ENTRY, 0xE6); w8(ENTRY + 1, PORT_IN);
  w8(DISP, 0xE6); w8(DISP + 1, PORT_T42);
  emu.cpu.jit_clear_cache?.();
  input = null; t42 = null;
  let out = null;
  try { out = convert(text).out; } catch (e) { out = "ERR"; }
  w8(ENTRY, ORIG_ENTRY[0]); w8(ENTRY + 1, ORIG_ENTRY[1]);
  w8(DISP, ORIG_DISP[0]); w8(DISP + 1, ORIG_DISP[1]);
  return { out, input, t42 };
}

const dict = createDict(fs.readFileSync(path.join(K2K, "work/aqdic.bin")));

const files = process.argv.slice(2).filter((a) => !a.startsWith("--") && !/^\d+$/.test(a));
if (!files.length) files.push(path.join(K2K, "eval/corpus_dev140.txt"), path.join(K2K, "eval/corpus_holdout87.txt"));

// ---------------------------------------------------------------------------
// --mutate-pos1 <rounds> [seed]
//   POS1 品詞クラス表のエントリをランダムに書き換えて検証する。分類器は
//   「直前語/現語の品詞クラス」で分岐するので、この突然変異は分類器の分岐を直接えぐる。
//   DLL 側は MMIO ミラー (shadow) を書き換え、こちら側は同じバイト列で createDict し直す。
//   コーパスに出てこないクラス値も強制的に踏ませる。
// ---------------------------------------------------------------------------
const mutIdx = process.argv.indexOf("--mutate-pos1");
if (mutIdx >= 0) {
  const rounds = parseInt(process.argv[mutIdx + 1] || "40", 10);
  let seed = (parseInt(process.argv[mutIdx + 2] || "12345", 10) >>> 0) || 1;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) >>> 8);
  const dictBytes = fs.readFileSync(path.join(K2K, "work/aqdic.bin"));
  const base = dict.pos1.off;
  const used = new Set();
  const sents = [];
  for (const f of files) for (const s of fs.readFileSync(f, "utf8").split("\n").filter(Boolean)) {
    sents.push(s);
    for (const t of dict.toKanaDetailed(s)) if (t.pos != null) used.add(t.pos & 0x7fff);
  }
  const usedArr = [...used];
  const sample = sents.filter((_, i) => i % 7 === 0).slice(0, 20);
  const orig = Uint8Array.from(dictBytes.subarray(base + 0x1a, base + 0x1a + dict.pos1.count));
  let changed = 0, agree = 0, disagree = 0;
  for (let r = 0; r < rounds; r++) {
    const bytes = Uint8Array.from(dictBytes);
    const N = Math.max(1, Math.min(40, usedArr.length));
    const touched = new Set();
    for (let k = 0; k < N; k++) {
      const pi = usedArr[rnd() % usedArr.length];
      const cl = rnd() % 0x46;
      bytes[base + 0x1a + pi] = cl;
      shadow[base + 0x1a + pi] = cl;
      touched.add(pi);
    }
    const d2 = createDict(bytes);
    let roundChanged = false;
    for (let si = 0; si < sample.length; si++) {
      const s = sample[si];
      const p = probe(s);
      if (!p.input || !p.t42 || p.input.length !== p.t42.length) continue;
      const mine = boundaryTypes(p.input, d2.pos1);
      const base0 = boundaryTypes(p.input, dict.pos1);
      if (p.t42.join() !== base0.join()) roundChanged = true;
      let same = mine.length === p.t42.length;
      for (let i = 0; same && i < mine.length; i++) if ((mine[i] & 0xffff) !== p.t42[i]) same = false;
      if (same) agree++; else { disagree++; if (disagree <= 8) console.log("  MUT-FAIL " + JSON.stringify([s, p.t42.join(","), mine.join(",")])); }
    }
    if (roundChanged) changed++;
    for (const pi of touched) shadow[base + 0x1a + pi] = orig[pi];
  }
  console.log(`--mutate-pos1 rounds=${rounds} usedPosIdx=${usedArr.length} roundsWithEffect=${changed} agree=${agree} disagree=${disagree}`);
  process.exit(disagree ? 1 : 0);
}

let total = 0, compared = 0, ok = 0, bad = 0, skipped = 0, badNodes = 0;
const fails = [];
for (const f of files) {
  for (const s of fs.readFileSync(f, "utf8").split("\n").filter(Boolean)) {
    total++;
    const r = probe(s);
    if (!r.input || !r.t42) { skipped++; continue; }
    if (r.input.length !== r.t42.length) { skipped++; continue; }
    const mine = boundaryTypes(r.input, dict.pos1);
    compared++;
    let diff = 0;
    for (let i = 0; i < mine.length; i++) if ((mine[i] & 0xffff) !== r.t42[i]) diff++;
    if (diff === 0) ok++;
    else { bad++; badNodes += diff; if (fails.length < 12) fails.push([s, r.t42.join(","), mine.join(","), r.input.map((n, i) => `${n.idx}/${n.mora}/${n.mb}/${n.ab}`).join(" ")]); }
  }
}
console.log(`sentences=${total} compared=${compared} exact=${ok} mismatch=${bad} (nodes off=${badNodes}) skipped=${skipped}`);
for (const f of fails) console.log("  FAIL " + JSON.stringify(f.slice(0, 3)));
