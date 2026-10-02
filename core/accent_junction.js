// accent_junction.js — 公式 AqKanji2Koe.dll の「アクセント結合」アルゴリズム完全移植
// ---------------------------------------------------------------------------
// 32bit DLL (AqKanji2Koe.dll) を v86 上で実行し、辞書イメージ (aqdic.bin) の全読み出しを
// MMIO フックで観測 + 逆アセンブルして得た規則をそのまま JS に移植したもの。
//
//   * 結合コード関数  : RVA 0x3770  (引数: 直前語ノード, 次語ノード → 0..49)
//   * コード→核位置   : RVA 0x3bf0 内の 50 エントリのジャンプテーブル (RVA 0x3f74)
//   * 品詞クラス表    : POS1 セクション (aqdic.bin + 0x1ac, count@+0x18, table@+0x1a)
//   * 結合バイト      : record の flag&3 個。位置 = rec + 7 + mora + ((flag&4)?3:0)
//                       cls = (byte>>5)-2, val = (byte&0x1f) + (cls!==0 ? 20 : 0)
//
// 核位置は「アクセント句内の拍番号 (1-based)」で返る。0 = 平板。
// ---------------------------------------------------------------------------

// 拗音/小書き仮名 (直前の拍と同居する)
const SMALL_KANA = new Set('ャュョァィゥェォヮヶヵゎ');
// 読みを「拍コード列」に分解する。公式の読みは 1 拍 = 1 コード (ジュ は 1 コード) なので、
// 小書き仮名は直前の拍に付ける。ー / ッ / ン は独立した 1 拍。
export function splitMorae(reading) {
  const out = [];
  for (const c of reading) {
    if (SMALL_KANA.has(c) && out.length) out[out.length - 1] += c;
    else out.push(c);
  }
  return out;
}
// RVA 0xd0b0..0xd121 の補正: 核位置 A (1-based 拍) が ン / ッ / ー を指すとき A を 1 つ手前へ戻す。
//   実測 (公式 DLL 差分実験): 十(ジュー a1 m2)+年 は code5 で A=2 だが、2 拍目が ー なので A=1 →
//   ジュ'ーネン。何(ナン)+度 も A=2 → ン なので A=1 → ナ'ンドモ。
//   条件: mora>1 かつ 1<A<=mora (公式は「語頭ノードの読み」だけを見るため、拍数で打ち切られる)。
function fixupNucleus(accent, morae) {
  const mora = morae.length;
  if (mora > 1 && accent > 1 && accent <= mora) {
    const c = morae[accent - 1];
    if (c === 'ン' || c === 'ッ' || c === 'ー') return accent - 1;
  }
  return accent;
}

// ノードを作る (members: kanji_accent.js の句メンバ)
export function makeNode(m) {
  const junc = m.junc || null;
  const jcnt = m.jcnt | 0;
  let jcls = null, jval = null;
  if (junc && jcnt > 0) {
    jcls = new Array(jcnt); jval = new Array(jcnt);
    for (let i = 0; i < jcnt; i++) {
      const b = junc[i];
      const c = (b >> 5) - 2;
      jcls[i] = c;
      jval[i] = (b & 0x1f) + (c !== 0 ? 20 : 0);
    }
  }
  const pos = m.pos;
  return {
    accent: m.accent | 0,
    mora: m.mora | 0,
    posIdx: pos == null ? null : (pos & 0x7fff),
    jcnt, jcls, jval,
    reading: m.reading ?? '',
    morae: splitMorae(m.reading ?? ''),
    brk: 0,                      // [node+0x44]: 0 = 無し, 1/2 = アクセント句境界
  };
}

// 品詞クラス (POS1 テーブル) を引く。範囲外/未知名詞は null。
function klass(pos1, idx) {
  if (!pos1 || idx == null || idx >= pos1.count) return null;
  return pos1.table[idx];
}

const inR = (v, lo, hi) => v != null && v >= lo && v <= hi;

// ---------------------------------------------------------------------------
// RVA 0x3770: 結合コード (0..49) を返す
//   呼び出し側 (RVA 0x3c53) は `push prev; push next` の順に積むので、
//   stdcall では arg1=[ebp+8]=next, arg2=[ebp+0xc]=prev。つまり
//     * フェーズ1 は prev の結合バイト
//     * フェーズ3 は next の結合バイト (「後続語の extra が支配する」の正体)
//     * 範囲判定に使う品詞は prev のもの
// ---------------------------------------------------------------------------
export function junctionCode(prev, next, pos1) {
  // (1) prev (直前語) の最初の結合値が 13..17 なら即そのコード
  if (prev.jcnt > 0) {
    const v = prev.jval[0];
    if (v >= 13 && v <= 17) return v;
  }
  const pn = next.posIdx, pp = prev.posIdx;
  const cn = klass(pos1, pn);          // 次語のクラス
  const cp = klass(pos1, pp);          // 直前語のクラス
  let code = 0;
  // (2) 次語のクラスが 13..24 で、直前語のクラスが 13..24 か 25 → 0x17
  if (cn != null && cn >= 13 && cn <= 24) {
    if ((cp != null && cp >= 13 && cp <= 24) || cp === 25) code = 0x17;
  }
  // (3) 次語 (next) の結合エントリを順に見る。範囲判定は直前語 (prev) の品詞。
  for (let i = 0; i < next.jcnt; i++) {
    const c = next.jcls[i];
    if (c === 0) return next.jval[i];
    if (c === 3) {
      if (inR(cp, 10, 12)) return next.jval[i];
      if (inR(pp, 51, 76)) return next.jval[i];
      continue;
    }
    if (c === 2) {
      if (inR(cp, 31, 33)) return next.jval[i];
      if (inR(pp, 22, 50)) return next.jval[i];
      if (inR(pp, 5, 10)) return next.jval[i];
      if (inR(pp, 116, 189)) { code = next.jval[i]; continue; }
      continue;
    }
    if (c === 4) {
      if (inR(pp, 116, 189)) return next.jval[i];
      continue;
    }
    if (c === 1) {
      if (inR(cp, 36, 67) || cp === 69) return next.jval[i];
      if (cp === 25 && pp != null && !inR(pp, 22, 50) && !inR(pp, 5, 10)
          && !inR(pp, 116, 189) && !inR(pp, 51, 76)) return next.jval[i];
      continue;
    }
    if (c === 5) {
      if (inR(cp, 31, 33)) return next.jval[i];
      if (cp === 25) return next.jval[i];
      continue;
    }
  }
  if (code !== 0) return code;
  // (4) 既定: 次語のクラスが 10..12 か 31..33 なら 0x30 (= コード 48 と同じ挙動)
  if (inR(cn, 31, 33) || inR(cn, 10, 12)) return 0x30;
  return 0;
}

// ---------------------------------------------------------------------------
// RVA 0x3bf0: ジャンプテーブル (コード → 核位置)。esi.accent を書き換える。
//   HM = 句頭からの累積拍数 (edi), aux = 次語ノード, A = 現在の句アクセント
//   戻り値: アクセント句が分割されたら true
// ---------------------------------------------------------------------------
function applyCode(code, ctx) {
  const { esi, aux, HM } = ctx;
  let A = esi.accent;
  const auxAcc = aux.accent, auxMora = aux.mora;
  switch (code) {
    case 0: case 1:
      if (A === 0 && auxAcc !== 0) A = HM + auxAcc;
      break;
    case 2: case 48:
      if (auxAcc !== 0) A = HM + auxAcc;
      else if (auxMora > 3) A = HM + auxMora - 1;
      break;
    case 3: case 37: A = HM + 1; break;
    case 4: A = HM > 2 ? 0 : HM; break;
    case 5: case 36: A = HM; break;
    case 6: case 17: case 47: A = 0; break;
    case 7: A = HM !== 1 ? HM : 0; break;
    case 8: A = HM !== 2 ? HM : 0; break;
    case 9: A = HM < 2 ? HM : 0; break;
    case 10: A = HM > 2 ? HM + auxAcc : 0; break;
    case 11: A = HM > 2 ? HM : 0; break;
    case 12: case 20: break;                       // no-op
    case 13:
      A = (auxAcc !== 0 && auxAcc !== auxMora) ? HM + auxAcc : 0;
      break;
    case 14:
      A = (auxAcc !== 0 && auxAcc !== auxMora) ? HM + auxAcc : HM + 1;
      break;
    case 15: case 18:                              // アクセント句を分割 (break=2)
      ctx.prev.brk = 2; ctx.split = true;
      break;
    case 16:
      if (auxAcc === 0 || auxAcc === auxMora) A = HM + 1;
      break;
    case 19:                                       // 分割 (break=1)
      ctx.prev.brk = 1; ctx.split = true;
      break;
    case 21: if (A === 0) A = HM - 1; break;
    case 22: if (A === 0) A = HM - 2; break;
    case 23: if (A === 0) A = HM; break;
    case 24: if (A === 0) A = HM + 1; break;
    case 25: if (HM > 2) A = HM + 1; else if (A === 0) A = HM + 2; break;
    case 26: if (A === 0) A = HM + 2; break;
    case 27: if (A === 0) A = HM + 3; break;
    case 28: if (A === 0) A = HM + 4; break;
    case 29: if (A === 0) A = HM + 5; break;
    case 30: if (A === 0) A = HM + 6; break;
    case 31:
      if (HM === 2) { if (A !== 0) A = 1; }
      else { if (A !== 0) A = HM; }
      break;
    case 32: if (A !== 0) A = HM; break;
    case 33: if (A !== 0) A = HM + 1; break;
    case 34: if (A !== 0) A = HM + 2; break;
    case 35: A = HM - 1; break;
    case 38: A = HM + 2; break;
    case 39: A = HM + 3; break;
    case 40: A = HM + 4; break;
    case 41: A = HM + 5; break;
    case 42: A = HM + 6; break;
    case 43: A = HM + 7; break;
    case 44: A = HM + 8; break;
    case 45: A = HM + 9; break;
    case 46: if (A === HM && HM > 1) A = 0; break;
    case 49: A = A === 0 ? HM + auxAcc : HM; break;
    default: break;                                // 12/20 と範囲外は何もしない
  }
  esi.accent = A;
  return ctx.split === true;
}

// ---------------------------------------------------------------------------
// ノード列 → アクセント句ごとの核位置
//   返り値: [{ start, end, accent }]  (start/end は nodes のインデックス, end は排他)
//   accent は句内の拍番号 (1-based)。0 は平板。
// ---------------------------------------------------------------------------
export function phraseAccents(nodes, pos1) {
  const n = nodes.length;
  if (n === 0) return [];
  if (n === 1) return [{ start: 0, end: 1, accent: fixupNucleus(nodes[0].accent | 0, nodes[0].morae) }];
  if (!pos1) return [{ start: 0, end: n, accent: nodes[0].accent | 0 }];
  const moraeOf = (idx) => nodes[idx].morae || splitMorae(nodes[idx].reading || '');
  const out = [];
  const clamp = () => { if ((esi.accent & 0xffff) > 32767) esi.accent = 1; };
  let prev = nodes[0];
  let esi = nodes[0];
  let startIdx = 0;
  let HM = nodes[0].mora;
  let counter = 1;
  while (counter < n) {
    const aux = nodes[counter];
    let split = false;
    let skipped = false;
    if (prev.brk !== 0) {
      // 直前ノードがアクセント句境界 → ハンドラを飛ばして新しい句を始める
      // (RVA 0x3c3d..0x3c4b は 0x3f3c へ直行するのでクランプも通らない)
      split = true; skipped = true;
    } else {
      const code = junctionCode(prev, aux, pos1);
      const ctx = { esi, aux, HM, prev, split: false };
      applyCode(code <= 0x31 ? code : 12, ctx);
      split = ctx.split;
    }
    if (split) {
      // 分割: 旧句の核は esi.accent に確定済み。新句は次語から始まる。
      out.push({ start: startIdx, end: counter, accent: esi.accent & 0xffff });
      esi = aux;
      startIdx = counter;
      HM = 0;
    }
    if (!skipped) clamp();
    HM += aux.mora;
    prev = aux;
    counter++;
  }
  clamp();
  out.push({ start: startIdx, end: n, accent: esi.accent & 0xffff });
  for (const p of out) if (p.accent > 32767) p.accent -= 65536;   // int16 として負 → 1
  for (const p of out) if (p.accent < 0) p.accent = 1;
  // RVA 0xd0b0 の補正 (ン / ッ / ー を核が指すとき 1 拍手前へ)
  for (const p of out) p.accent = fixupNucleus(p.accent, moraeOf(p.start));
  return out;
}
