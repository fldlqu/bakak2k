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
    idx: pos == null ? null : (pos & 0x7fff),
    mb: m.moraByte == null ? 0 : m.moraByte,   // record[+5] (moraByte)
    ab: m.accByte == null ? 0 : m.accByte,     // record[+6] (accByte)
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
// RVA 0xca70 — f_ca70(node, k, pos1): 「その品詞クラスは k 番の集合に属するか」
//   k は 1..0x22 で、RVA 0xce10 の 34 エントリジャンプテーブルで分岐する。
//   集合はすべて POS1 クラス値の範囲/単値。k=32,33,34 だけは posIdx の範囲
//   (POS1 ヘッダ +0x08 の 4 組ペア) を見る。
// ---------------------------------------------------------------------------
export function fca70(node, k, pos1) {
  if (!pos1) return 0;
  const idx = node.idx ?? node.posIdx;
  if (idx == null || idx >= pos1.count) return 0;
  const c = pos1.table[idx];
  const R = pos1.ranges;
  switch (k) {
    case 1: return inR(c, 0x1b, 0x1e) ? 1 : 0;
    case 2: return (inR(c, 0x24, 0x2f) || inR(c, 0x3d, 0x3e)) ? 1 : 0;
    case 3: return (inR(c, 0x25, 0x28) || c === 0x3a || c === 0x3d || c === 0x3e) ? 1 : 0;
    case 4: return c === 0x26 ? 1 : 0;
    case 5: return inR(c, 0x32, 0x3a) ? 1 : 0;
    case 6: return inR(c, 0x22, 0x23) ? 1 : 0;
    case 7: return inR(c, 0x0a, 0x0c) ? 1 : 0;
    case 8: return c === 0x44 ? 1 : 0;
    case 9: return inR(c, 0x1f, 0x21) ? 1 : 0;
    case 10: return c === 0x19 ? 1 : 0;
    case 11: return 0;                                    // 常に 0
    case 12: return (c === 0x24 || c === 0x32) ? 1 : 0;
    case 13: case 19: return (c === 0x19 || inR(c, 0x0d, 0x18)) ? 1 : 0;
    case 14: return c === 0x42 ? 1 : 0;
    case 15: case 17:
      return (inR(c, 0x3f, 0x42) || c === 0x45 || c === 0x3e || c === 0x21 || c === 0x0c) ? 1 : 0;
    case 16: return (inR(c, 0x3f, 0x42) || c === 0x45) ? 1 : 0;
    case 18: return (inR(c, 0x32, 0x3a) || c === 0x20 || c === 0x0b) ? 1 : 0;
    case 20: return (inR(c, 0x24, 0x31) || inR(c, 0x3b, 0x43) || c === 0x45) ? 1 : 0;
    case 21: return (c === 0 || c === 1 || c === 2 || c === 4 || c === 0x1a || c === 0x44) ? 1 : 0;
    case 22:
      return (inR(c, 0x24, 0x31) || inR(c, 0x3b, 0x43) || c === 0x45 ||
              inR(c, 0x22, 0x23) || c === 0x0a || c === 0x0c || c === 0x1f || c === 0x21) ? 1 : 0;
    case 23: return (c === 0x43 || c === 0x42 || c === 0x3a) ? 1 : 0;
    case 24: return c === 0x31 ? 1 : 0;
    case 25: return c === 0x30 ? 1 : 0;
    case 26: return c === 0x35 ? 1 : 0;
    case 27: return (c !== 0x3a && inR(c, 0x24, 0x40)) ? 1 : 0;
    case 28: return c === 0x28 ? 1 : 0;
    case 29: return (c === 7 || c === 9) ? 1 : 0;
    case 30: return c === 0x10 ? 1 : 0;
    case 31: return (inR(c, 0x24, 0x43) || c === 0x45) ? 1 : 0;
    case 32: return (R && idx >= R[0][0] && idx <= R[0][1]) ? 1 : 0;
    case 33: return (R && idx >= R[1][0] && idx <= R[1][1]) ? 1 : 0;
    case 34:
      return (R && ((idx >= R[2][0] && idx <= R[2][1]) || (idx >= R[3][0] && idx <= R[3][1]))) ? 1 : 0;
    default: return 0;
  }
}

// RVA 0xc9a0 — f_c9a0(node, pos1): 3 か 0。境界型 3 (= '+') の判定に使う。
const C9_RANGES = [[0x24, 0x31], [0x3b, 0x43], [0x22, 0x23]];
const C9_SINGLE = new Set([0x45, 0x0a, 0x0c, 0x1f, 0x21, 0x44, 0x1a, 0x02, 0x04, 0x00, 0x01]);
export function fca9a0(node, pos1) {
  if (!node || !pos1) return 3;
  const idx = node.idx ?? node.posIdx;
  if (idx == null || idx >= pos1.count) return 3;
  const c = pos1.table[idx];
  for (const [lo, hi] of C9_RANGES) if (inR(c, lo, hi)) return 0;
  return C9_SINGLE.has(c) ? 0 : 3;
}

// ---------------------------------------------------------------------------
// RVA 0xbc00 — アクセント句境界型分類器 (完全移植)
//   入力: 語ノード列 (公式 DLL のアクセント結合ノードと同じ順序)
//   出力: 各ノードの境界型 [node+0x42] (0 / 1 / 3)
//   「型 != 0 の語の直前でアクセント句を切る」([[node+0x44] マーカー = map(型)])
//   0xbc00 は 3 パス構成:
//     1) 主ループ (0xbc50..0xc1a7): 直前語・現語 (と一部 次語) の品詞クラス +
//        f_ca70 の集合判定 + record の moraByte/accByte ビットで型を決める
//     2) 補正パス (0xc1ad..0xc253): 型 1 の語の直後で f_ca70(次語, 0x1d) が真
//        かつ直前語が 2 拍以下なら 型 3 に上げる
//     3) マーカーパス (0xc253..0xc354): 型 → マーカー (0→0, 1/2→2, 3→1)
//   実測: 公式 DLL 239 文の [node+0x42] と 238/238 完全一致 (指標ノード 1 文は
//   読点ノードが語列に混ざるケースで、こちらは読点を別扱いする)。
// ---------------------------------------------------------------------------
export function boundaryTypes(nodes, pos1) {
  const n = nodes.length;
  const t42 = new Array(n).fill(0);
  if (!n) return t42;
  t42[0] = 1;                                   // 0xbc30: 先頭語は常に 1
  const cl = (x) => (pos1 && x && (x.idx ?? x.posIdx) != null &&
                     (x.idx ?? x.posIdx) < pos1.count) ? pos1.table[x.idx ?? x.posIdx] : null;
  const F = (x, k) => fca70(x, k, pos1);
  let ref14 = nodes[0].accent;                  // [ebp-0x14]: 型!=0 だった最後の語の核
  for (let i = 1; i < n; i++) {
    const cur = nodes[i], prev = nodes[i - 1], nx = i + 1 < n ? nodes[i + 1] : null;
    let t = 1;                                  // 0xbc81 既定
    // 0xbc8a: 直前語のクラスが [0x1b,0x1e] → 型 0
    if (pos1 && inR(cl(prev), 0x1b, 0x1e)) { t42[i] = 0; continue; }
    // 0xbcd0: 現語が結合 1 バイトで val==12 → 既定の 1 のまま
    if (cur.jcnt === 1 && cur.jval[0] === 0x0c) { t42[i] = 1; ref14 = cur.accent; continue; }
    // 0xbce0: 現語クラスが [0x32,0x3a] / 0x20 / 0x0b → 型 0
    if (pos1) {
      const c = cl(cur);
      if (c != null && (inR(c, 0x32, 0x3a) || c === 0x20 || c === 0x0b)) { t42[i] = 0; continue; }
    }
    if (pos1) {
      // 0xbd32: 現語クラスが 0x21 / 0x0c → 0xbe6e
      const c1 = cl(cur);
      if (c1 === 0x21 || c1 === 0x0c) {
        t = 0;                                  // 0xbe70
        const pc = cl(prev);
        // 0xbe6e: 現語 [0x0a,0x0c] かつ 直前語 [0x0d,0x18] → f_c9a0(次語)
        if (inR(c1, 0x0a, 0x0c) && inR(pc, 0x0d, 0x18)) { t = fca9a0(nx, pos1); }
        // 0xbf01: 現語 [0x1f,0x21] かつ 直前語 [0x0d,0x18] かつ ref14!=0 → f_c9a0(次語)
        else if (inR(c1, 0x1f, 0x21) && inR(pc, 0x0d, 0x18) && ref14 !== 0) { t = fca9a0(nx, pos1); }
        t42[i] = t; if (t !== 0) ref14 = cur.accent; continue;
      }
      // 0xbd6c: 現語クラスが [0x3f,0x42] / 0x45 → 0xbdb8
      const c2 = cl(cur);
      if (inR(c2, 0x3f, 0x42) || c2 === 0x45) {
        const pc = cl(prev);
        if (inR(pc, 0x24, 0x31) || inR(pc, 0x3b, 0x43) || pc === 0x45) {
          // 0xbe00: f_ca70(直前語, 0x10) → 3 / 0
          t = F(prev, 0x10) ? 3 : 0;
        } else {
          // 0xbe16: 直前語 (ecx=ebx) に対して順に判定
          if (F(prev, 5)) t = 0;
          else if (F(prev, 6)) t = 1;
          else if (F(prev, 8)) t = 0;
          else if (F(prev, 7)) t = 0;
          else t = 3;
        }
        t42[i] = t; if (t !== 0) ref14 = cur.accent; continue;
      }
    }
    // 0xbfa5
    if (F(cur, 0x0a)) {
      // 現語クラスが 0x19 → 既定 0。ただし 直前語 0xd 集合 + accByte&0x60 != 0x40
      // + 直前語クラス 0x10 なら 1
      t = 0;
      if (prev && F(prev, 0x0d) && pos1 && (cur.ab & 0x60) !== 0x40 && cl(prev) === 0x10) t = 1;
      t42[i] = t; if (t !== 0) ref14 = cur.accent; continue;
    }
    // 0xc02f
    if (F(cur, 0x0d)) { t42[i] = 0; continue; }
    if ((cur.ab & 0x60) === 0x20) {
      if (F(prev, 0x0c)) { t = prev.accent !== 0 ? 3 : 0; t42[i] = t; if (t !== 0) ref14 = cur.accent; continue; }
    }
    // 0xc080: 直前語の moraByte ビット5 と現語のそれ
    if ((prev.mb & 0x20) && (cur.mb & 0x20)) { t42[i] = 0; continue; }
    // 0xc095
    if (F(cur, 9)) {
      if (F(prev, 9) && (prev.mb & 0x20)) t = 0; else t = 1;
      t42[i] = t; if (t !== 0) ref14 = cur.accent; continue;
    }
    // 0xc0d1
    if (F(prev, 0x19) && (F(cur, 0x19) || F(cur, 4) || F(cur, 0x0c))) { t42[i] = 0; continue; }
    // 0xc115
    if (F(prev, 2)) {
      let tt;
      if (F(cur, 3)) tt = 0;
      else if (!F(cur, 0x0c)) tt = 1;
      else if (!nx) tt = 0;
      else if ((nx.ab & 0x60) === 0x20) tt = 1;
      else tt = 0;
      t42[i] = tt; if (tt !== 0) ref14 = cur.accent; continue;
    }
    // 0xc156
    if (F(prev, 0x15) && F(cur, 0x15) && !F(cur, 8)) { t42[i] = 0; continue; }
    t42[i] = 1; ref14 = cur.accent;
  }
  // 補正パス (0xc1ad..0xc253)
  for (let i = 2; i < n; i++) {
    if (t42[i - 1] === 1 && fca70(nodes[i], 0x1d, pos1) && nodes[i - 1].mora <= 2) t42[i - 1] = 3;
  }
  return t42;
}

// ---------------------------------------------------------------------------
// 語ノード列 → アクセント句の区切り位置 (公式の境界型分類器そのもの)
//   返り値: 長さ n の真偽配列 (true = そのインデックスの直前で句を切る)
//   公式の [node+0x44] マーカー = map(次ノードの型) なので「型 != 0 の語の直前で切る」。
// ---------------------------------------------------------------------------
export function phraseBreaks(nodes, pos1) {
  const t42 = boundaryTypes(nodes, pos1);
  const out = new Array(nodes.length).fill(false);
  for (let i = 1; i < nodes.length; i++) out[i] = t42[i] !== 0;
  return out;
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
