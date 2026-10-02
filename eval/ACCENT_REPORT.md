# AqKanji2Koe アクセント一致率 — 最終報告 (アクセント結合 + 句境界分類器の完全同定)

作業ブランチ: `re/engines/k2k` @ `main-reading-fix` (push なし)
対象: 日文アクセント(音高)・読み・分かち書き と 公式 `AqKanji2Koe.dll` の一致率

---

## 1. 結果

| コーパス | 着手時 | 前回 | **今回の最終** |
|---|---|---|---|
| DEV 140 句 | 136/140 = 97.1% | 137/140 = 97.9% | **140/140 = 100.0%** |
| 保留 87 句 (開発未使用) | 83/87 = 95.4% | 86/87 = 98.9% | **87/87 = 100.0%** |
| 合計 227 句 | 219/227 = 96.5% | 223/227 = 98.2% | **227/227 = 100.0%** |

**読み・分かち書きは 227/227 = 100% 一致** (アクセント記号 `'` を除いたカナ列が公式と完全一致)。
**残る不一致は 0**。

### コミットごとの推移 (DEV140 / 保留87)

| commit | DEV140 | 保留87 | 内容 |
|---|---|---|---|
| (着手時) | 136 = 97.1% | 83 = 95.4% | — |
| `396e503` | 137 = 97.9% | 85 = 97.7% | アクセント結合アルゴリズムを完全移植 |
| `7d02b35` | 137 = 97.9% | 86 = 98.9% | 複合名詞の連鎖制限を撤廃 |
| `97670f8` | **140 = 100%** | **87 = 100%** | **アクセント句境界型分類器 (RVA 0xbc00) を完全移植** |

### 追加検証 (コーパス外の追試)

| 検証 | 結果 |
|---|---|
| 境界型 `[node+0x42]` の一致 (227 コーパス, 239 文) | **238/238 完全一致** (残り 1 文は読点ノードが語列に混ざる) |
| 境界型 `[node+0x42]` の一致 (`work/probes/_learn_corpus.txt`, 2892 文) | **2892/2892 完全一致** |
| POS1 クラス表を 40 箇所ランダム書き換え × 40 ラウンド (DEV140) | 全ラウンドで公式の型が変化 (**効果あり**)、こちら **800/800 一致** |
| POS1 クラス表を 40 箇所ランダム書き換え × 60 ラウンド (learn 2892) | 全ラウンドで効果あり、**1200/1200 一致** |
| 公式の `f_ca70` (RVA 0xca70) を JS 実装で置換 | **出力が完全不変** (= 補助関数の解読が正しい) |
| 拡張コーパス `_learn_corpus.txt` の最終一致率 (2874 文が比較可能) | 2841/2874 = 98.9% (残り 33 は全て §8 の OOV 漢字複合語) |

---

## 2. 【手法】公式 DLL の「辞書読み出し」と「内部状態」を全部見る

### 2.1 なぜ `cpu.mem8` の Proxy では駄目か

v86 の CPU は WASM で動いており、ゲストメモリは wasm 線形メモリへ直接アクセスする。
`cpu.mem8` は遅延生成 Proxy (`v86_emu.js` の `k()` ヘルパ) で、JS 側 API 専用。
CPU のロード/ストアはこれを通らない。また **RAM 内のページに対する `mmap_register` は
wasm CPU に無視される** (実験: RAM 内 0x20000000 にハンドラを付けてもゲストの読み出しで
呼ばれない。1GB 以上の 0x40000000 なら呼ばれる)。

### 2.2 解決策

```
CPU は「RAM 外 (>= memory_size)」の物理アドレス読み書きだけを JS の
memory_map_read8/read32 へ委譲する (mmap_register, 128KB ブロック単位)
```

そこで **辞書イメージを 1GB 以上の 0x40000000 に置いて `mmap_register` でフック** すると、
DLL が辞書のどのバイトを読んだかがすべて観測できる。実装は
`eval/tools/accent_trace.mjs` (`node --no-warnings eval/tools/accent_trace.mjs 十年前`)。

* `Set` でオフセットを重複除去、読み出し時の EIP も記録 (どのコードが読んだか分かる)
* 注意: `v86_emu.set_hook` は Win32 スタブでポート 0xE0.. を使い切るため衝突する。
  空きポート (0xC7 / 0xC6) に `OUT` トランポリンを自前で書いてフックする。
  ハンドラ内で必ず「元のバイト列を戻す + `set_eip(フックした番地)`」を行うこと
  (v86 は OUT 実行後の EIP を渡してくるので、そのまま戻すと後続バイトを壊して #GP になる)。

### 2.3 辞書の全体構造 (確定)

```
0x000000 UNKD (412)        ┐
0x0001a4 POSD (1208)       │ POSD ヘッダ + POS1 (= アクセント結合の品詞クラス表)
  0x0001ac POS1 (1200)     │   +0x08 u16 ペア4組 = (116,189)(51,76)(22,50)(5,10)
  0x0001ac+0x18 u16 count  │   = 1182
  0x0001ac+0x1a u8 table[1182]
0x000664 MCGD (36820)      │
0x009640 MTXD/MTX1         │   +0x08 u16 ペア4組 = (116,189)(51,76)(22,50)(5,10)
0x2b395c MSTD (本体辞書)    ┘
```

---

## 3. 【成果 1】アクセント結合アルゴリズムの完全同定 (前回)

### 3.1 レコードの「extra バイト」= アクセント結合データ (形式確定)

```
record = [pos u16][cost u16][flag u8][moraByte u8][accByte u8][カナ mora バイト]
結合バイト数   = flag & 3
結合バイト位置 = record + 7 + mora + ((flag & 4) ? 3 : 0)
moraByte & 0x1f = mora,  accByte & 0x1f = accent
```

各結合バイト `b` の復号 (RVA 0xd265..0xd2c8 のローダ):

```
cls = (b >> 5) - 2          // -2..5
val = (b & 0x1f) + (cls !== 0 ? 20 : 0)   // 0..51
```

* `flag & 4` (0x44/0x45) の長形式は「カナの前に 3 バイト」→ 結合バイトはカナの直後
* **機構も確定**: 「後続語の extra が支配する」の正体は、結合関数が
  「次に付く語」の結合バイトを見るフェーズ 3 である (§3.3)

実例: `ます` = flag 0x41, 結合 1 バイト `0x91` → cls=2, val=37。

### 3.2 結合コード関数 (RVA 0x3770) → 0..49

呼び出し側は `push prev; push next` の順に積むので **arg1 = next, arg2 = prev**。

```
if (prev.jcnt > 0 && prev.jval[0] in [13,17]) return prev.jval[0]      // フェーズ1
hc = T[posIdx(next)], cp = T[posIdx(prev)], pp = posIdx(prev)
if (hc in [13,24] && (cp in [13,24] || cp == 25)) code = 0x17          // フェーズ2
for i in 0..next.jcnt-1:                                               // フェーズ3
    c = next.jcls[i]
    c==0 -> return next.jval[i]
    c==3 -> if (cp in [10,12] || pp in [51,76]) return next.jval[i]
    c==2 -> if (cp in [31,33] || pp in [22,50] || pp in [5,10]) return next.jval[i]
            if (pp in [116,189]) code = next.jval[i]
    c==4 -> if (pp in [116,189]) return next.jval[i]
    c==1 -> if (cp in [36,67] || cp==69) return next.jval[i]
            if (cp==25 && pp not in [22,50]∪[5,10]∪[116,189]∪[51,76]) return next.jval[i]
    c==5 -> if (cp in [31,33] || cp==25) return next.jval[i]
if (code != 0) return code
if (hc in [31,33] || hc in [10,12]) return 0x30                        // 既定 (RVA 0xca70)
return 0
```

### 3.3 コード → 核位置 (RVA 0x3bf0 の 50 エントリジャンプテーブル, RVA 0x3f74)

`edi` = 句頭からの累積拍数、`esi` = 現在のアクセント句の先頭ノード、`A = [esi+0x40]`。
ハンドラは 30 種ほどで、全部 `core/accent_junction.js` の `applyCode` に移植した。
**核位置 A はアクセント句内の拍番号 (1-based)。A=0 は平板。**

### 3.4 核位置の補正 (RVA 0xd0b0) — ン / ッ / ー

```
A>1 かつ A<=そのノードの拍数 かつ 読み[A-1] が ン / ッ / ー なら A を 1 つ手前へ
```

実測: `十(ジュー a1 m2) + 年` → code 5 で A=2 だが 2 拍目が `ー` → **ジュ'ーネン**。

---

## 4. 【成果 2 (今回)】アクセント句境界型分類器の完全同定 (RVA 0xbc00)

### 4.1 呼び出し側の構造

アクセント句の境界は **ディスパッチャの呼び出し側 (RVA 0xcea0)** が決める:

```
0xcea0(this, arg1, arg2, vector<Node*>& vec):
    call 0x100d170(...)              ; 語ノード列を組み立てる (この中で OOV 漢字複合語が 1 ノードに融合)
    (0xceba..0xcfc8)                 ; 語の融合パス ([[node+8]][0] を見る。実測ではほぼ発火しない)
    call 0x1008f20(this+8, vec, arg3)
    call 0x100bc00(this+0x18, vec)   ; ★ 境界型分類器 : [node+0x42] を書き、[prev+0x44] にマーカーを置く
    call 0x100c3e0(this+0x18, vec)   ; 長い句 (20 拍超) の分割点にマーカー 5 を置く (今回は未発火)
    (0xcfe8..0xd087)                 ; 累積拍 > 15 のとき RVA 0xc5c0 で分割点を探しマーカー 2
    call 0x1003bf0(pos1, vec)        ; アクセント結合ディスパッチャ
    (0xd099..)                       ; ン/ッ/ー 補正 (§3.4)
```

ディスパッチャ (RVA 0x3bf0) は 0x3c3d で
`if ([prev+0x44] != 0) { esi = cur; HM = 0; }` としている。
つまり **マーカーが非 0 の語の直前でアクセント句を切る**。

`[node+0x44]` は 0xbc00 の第 3 パス (0xc253..0xc354) が
`[prev+0x44] = map([cur+0x42])` として書く (0 → 0 / 1 → 2 / 3 → 1)。
最後のノードは 6 (終端)。よって

```
境界 (i-1 と i の間) ⟺ [nodes[i]+0x42] != 0
```

が成り立つ。実測 (239 文の `[node+0x42]` と `[node+0x44]` を全数比較) でも
**この写像が 1 例を除いて完全に一致**した (唯一の例外は読点ノードが語列に混ざる文で、
読点がマーカー 0xa で消され 直前語に 4 が立つ。こちらは読点を別扱いするので影響なし)。

### 4.2 語ノードの構造 (v86 実行で実測)

```
+0x00 Word*   (-> +0x10 が record へのポインタ)
+0x04 u32    拍数 (拗音は 1 拍、ー/ッ/ン は各 1 拍)
+0x08 ptr    (エミュレータ上では node+0x48 を指す。融合パスの [[node+8]][0] だけがこれを使う)
+0x24 u32    結合バイト数 jcnt (最大 3)
+0x28 +4k    jcls[k]
+0x34 +4k    jval[k]
+0x40 u16    核 (アクセント)
+0x42 u16    ★ アクセント句境界型 (この分類器が書く)
+0x44 u16    ★ 句境界マーカー (0=なし / 1='+' / 2='/' / 4 / 5 / 6=終端 / 10=融合で消す)
```

品詞クラスは `T[posIdx]`、`posIdx = record[0] | ((record[1] & 0x7f) << 8)`
(emulator では `[[node]+0x10]` が record、`+0x18` が count、`+0x1a` がクラス表)。

### 4.3 補助関数 `f_ca70(node, k, pos1)` (RVA 0xca70, ジャンプテーブル RVA 0xce10, 34 項)

`T[posIdx(node)]` が「k 番のクラス集合」に属するかを返す (1/0)。
k の集合 (すべて POS1 クラス値):

| k | 集合 |
|---|---|
| 1 | [0x1b,0x1e] |
| 2 | [0x24,0x2f] ∪ [0x3d,0x3e] |
| 3 | [0x25,0x28] ∪ {0x3a,0x3d,0x3e} |
| 4 | {0x26} |
| 5 | [0x32,0x3a] |
| 6 | [0x22,0x23] |
| 7 | [0x0a,0x0c] |
| 8 | {0x44} |
| 9 | [0x1f,0x21] |
| 10 | {0x19} |
| 11 | ∅ (常に 0) |
| 12 | {0x24,0x32} |
| 13,19 | {0x19} ∪ [0x0d,0x18] |
| 14 | {0x42} |
| 15,17 | [0x3f,0x42] ∪ {0x45,0x3e,0x21,0x0c} |
| 16 | [0x3f,0x42] ∪ {0x45} |
| 18 | [0x32,0x3a] ∪ {0x20,0x0b} |
| 20 | [0x24,0x31] ∪ [0x3b,0x43] ∪ {0x45} |
| 21 | {0x00,0x01,0x02,0x04,0x1a,0x44} |
| 22 | [0x24,0x31] ∪ [0x3b,0x43] ∪ {0x45,0x22,0x23,0x0a,0x0c,0x1f,0x21} |
| 23 | {0x42,0x43,0x3a} |
| 24 | {0x31} |
| 25 | {0x30} |
| 26 | {0x35} |
| 27 | [0x24,0x40] \ {0x3a} |
| 28 | {0x28} |
| 29 | {7,9} |
| 30 | {0x10} |
| 31 | [0x24,0x43] ∪ {0x45} |
| 32 | posIdx ∈ [R0.lo,R0.hi] = [116,189] |
| 33 | posIdx ∈ [R1.lo,R1.hi] = [51,76] |
| 34 | posIdx ∈ [22,50] ∪ [5,10] |

`pos1 == 0` または `posIdx >= count` なら常に 0。

### 4.4 補助関数 `f_c9a0(node, pos1)` (RVA 0xc9a0)

`3` か `0` を返す (`+` 境界の判定に使う)。

```
T[posIdx] ∈ [0x24,0x31] ∪ [0x3b,0x43] ∪ {0x45,0x0a,0x0c,0x1f,0x21,0x44,0x1a,0x02,0x04,0x00,0x01}
   -> 0
それ以外 -> 3
```

### 4.5 分類器本体 (RVA 0xbc00)

入力は `vector<Node*>`。`n < 2` なら**何もせず戻る** (つまり型は全て 0 のまま)。
それ以外は `[nodes[0]+0x42] = 1` を書き、`i = 1..n-1` を回す。`prev = nodes[i-1]`,
`cur = nodes[i]`, `next = nodes[i+1] or null`、`ref14` = 「型 != 0 だった最後のノードの核」
(初期値は `nodes[0]` の核)。

```
t = 1                                        # 0xbc81 既定
0xbc8a  if (pos1 && T[prev] ∈ [0x1b,0x1e]) -> t = 0
0xbcd0  else if (cur.jcnt == 1 && cur.jval[0] == 0x0c) -> t = 1 (確定)
0xbce0  else if (T[cur] ∈ [0x32,0x3a] ∪ {0x20,0x0b}) -> t = 0
0xbd32  else if (T[cur] ∈ {0x21,0x0c}) ->                       # 0xbe6e
            t = 0
            if (T[cur] ∈ [0x0a,0x0c] && T[prev] ∈ [0x0d,0x18]) t = f_c9a0(next)
            else if (T[cur] ∈ [0x1f,0x21] && T[prev] ∈ [0x0d,0x18] && ref14 != 0)
                 t = f_c9a0(next)                                # 0xbf01
0xbd6c  else if (T[cur] ∈ [0x3f,0x42] ∪ {0x45}) ->               # 0xbdb8
            if (T[prev] ∈ [0x24,0x31] ∪ [0x3b,0x43] ∪ {0x45})
                 t = f_ca70(prev,0x10) ? 3 : 0                   # 0xbe00
            else                                                 # 0xbe16  (ecx = prev !)
                 t = f_ca70(prev,5) ? 0
                   : f_ca70(prev,6) ? 1
                   : f_ca70(prev,8) ? 0
                   : f_ca70(prev,7) ? 0
                   : 3
0xbfa5  else if (f_ca70(cur,0x0a)) ->                            # 0xbfa5
            t = (f_ca70(prev,0x0d) && (cur.accByte & 0x60) != 0x40 && T[prev] == 0x10) ? 1 : 0
0xc02f  else if (f_ca70(cur,0x0d)) -> t = 0
        else:
            if ((cur.accByte & 0x60) == 0x20 && f_ca70(prev,0x0c))
                 t = (prev.核 != 0) ? 3 : 0                      # 0xc064
            else if ((prev.moraByte & 0x20) && (cur.moraByte & 0x20))
                 t = 0                                             # 0xc08b
            else if (f_ca70(cur,9))
                 t = (f_ca70(prev,9) && (prev.moraByte & 0x20)) ? 0 : 1   # 0xc095
            else if (f_ca70(prev,0x19) &&
                     (f_ca70(cur,0x19) || f_ca70(cur,4) || f_ca70(cur,0x0c)))
                 t = 0                                             # 0xc0d1
            else if (f_ca70(prev,2))                               # 0xc115
                 t = f_ca70(cur,3) ? 0
                   : !f_ca70(cur,0x0c) ? 1
                   : !next ? 0
                   : (next.accByte & 0x60) == 0x20 ? 1
                   : 0
            else if (f_ca70(prev,0x15) && f_ca70(cur,0x15) && !f_ca70(cur,8))
                 t = 0                                             # 0xc156
            else t = 1
[nodes[i]+0x42] = t
if (t != 0) ref14 = cur.核
```

**補正パス (0xc1ad..0xc253)** — 主ループの後:

```
for i = 2..n-1:
    if ([nodes[i-1]+0x42] == 1 && f_ca70(nodes[i], 0x1d) && nodes[i-1].拍数 <= 2)
        [nodes[i-1]+0x42] = 3
```

**マーカーパス (0xc253..0xc354)** — 融合 (`[[node+8]][0] ∈ {4,7,8,9}`) の特殊ケースを
除けば `[nodes[i-1]+0x44] = map(nodes[i] の型)`、最後のノードは 6。

### 4.6 実装

* `core/accent_junction.js`: `fca70` / `fca9a0` / `boundaryTypes` / `phraseBreaks`
* `core/kanji_accent.js`: `groupStreamOfficial()` … 語列を分類器に渡し
  「型 != 0 の語の直前で切る」。記号 (非読み) は無条件に句を切る。
* `core/engine.js`: `toKanaDetailed` に `moraByte` / `accByte` を**追加** (既存 API 不変)。
  分類器はこの 2 バイトのビット 5 を読むため必須。

### 4.7 なぜ前回できなかったか (デバッグの勘所)

* **`0xbe16` のチェーンは `cur` ではなく `prev` (ecx=ebx) を引数に取る。**
  ここを取り違えると 47/239 文で型が食い違う (「日」「ため」「悪い」など)。
  見分け方: `f_ca70` の入口に OUT トランポリンを置き、呼ばれた (k, クラス) を記録する。
  実際に「日」の判定で `k=5,6,8,7` が **直前語「いい」のクラス 10** で呼ばれるのが見える。
* **`ref14` は「型 != 0 のノードの核」であって「直前ノードの核」ではない。**
  型 0 のときに更新してしまうと 34/238 文が食い違う。
* **`n < 2` は分類器が丸ごとスキップされる** (型は 0 のまま)。

---

## 5. 実装したアクセント規則

### 5.1 `core/accent_junction.js` (新規 → 今回拡張)

* `junctionCode(prev, next, pos1)` … §3.2 の完全移植
* `applyCode(code, ctx)` … §3.3 の 50 ハンドラ
* `fixupNucleus(accent, morae)` … §3.4 の ン/ッ/ー 補正
* `phraseAccents(nodes, pos1)` … 句ごとの核位置
* **`fca70` / `fca9a0` / `boundaryTypes` / `phraseBreaks`** … §4.3〜4.5

### 5.2 `core/engine.js`

* `parsePos1()` … POS1 セクション (品詞クラス表 + 範囲ペア) を読む (`dict.pos1`)
* `decodeRecords()` が `flag` / `jcnt` / `junc` / **`moraByte` / `accByte`** を返す
* `toKanaDetailed()` にこれらを**追加** (既存フィールド・戻り値構造は不変)

### 5.3 `core/kanji_accent.js`

* `accentRule: 'junction'` (既定) … 公式アルゴリズムで核を置く
* `phraseGroup: 'official'` (既定) … **公式の境界型分類器で句を切る**
* `accentRule: 'heuristic'` … 旧 `phraseCut()` の規則 (比較・退避用)
* `phraseGroup: 'heuristic'` … 公式の核 + 旧来の経験則 grouping (改前と完全同値: DEV 137/140)
* `compoundChain: true` (既定) … 複合名詞の連鎖を無制限にする (公式の挙動)
* `pos1` を持たない辞書 (ユーザ辞書など) は自動で旧規則にフォールバック

### 5.4 旧来の経験則は残してある (退避経路)

`groupStream()` / `phraseCut()` / `AUX_POS` / `AUX_SURF` / `HOJO_SURF` などは
`phraseGroup:'heuristic'` / `accentRule:'heuristic'` のときだけ使われる。
**公式分類器が使えるときは一切参照されない。**

---

## 6. 検証方法 (すべて追跡下のツールで再現可能)

```
# 一致率 (DEV140 / 保留87)
node --no-warnings eval/eval_sentences.mjs
K2K_CORPUS=eval/corpus_holdout87.txt K2K_TRUTH=eval/truth_holdout87.txt \
  node --no-warnings eval/eval_sentences.mjs
node --no-warnings eval/eval_sentences.mjs --detail      # 個別文の内訳

# 境界型分類器の等価性検証 (公式 DLL の [node+0x42] と全数照合)
node --no-warnings eval/tools/boundary_verify.mjs                       # 227 コーパス → 238/238
node --no-warnings eval/tools/boundary_verify.mjs work/probes/_learn_corpus.txt   # → 2892/2892
node --no-warnings eval/tools/boundary_verify.mjs eval/corpus_dev140.txt --mutate-pos1 40 777
        # POS1 クラス表をランダムに 40 箇所書き換え × 40 ラウンド → 800/800 一致
        # (roundsWithEffect で「公式の型が実際に変わったラウンド数」も出る)
node --no-warnings eval/tools/boundary_verify.mjs work/probes/_learn_corpus.txt --mutate-pos1 60 999
        # → roundsWithEffect=60, 1200/1200 一致

# 任意コーパスの真値を公式 DLL から生成 (eval_sentences に食わせられる形式)
node --no-warnings eval/tools/gen_truth.mjs work/probes/_learn_corpus.txt truth.txt

# 公式 DLL の辞書読み出し / アクセント結合ノードの観測
node --no-warnings eval/tools/accent_trace.mjs --nodes 十年前
node --no-warnings eval/tools/accent_trace.mjs 十年前

# 結合バイトの差分実験 (公式 DLL を 1 バイト書き換えて出力の階段関数を見る)
#   eval/tools/official_mut.mjs を import して patch(off, u8) → convert(text)
```

検証コマンド (毎コミットで PASS を確認):

```
cd re/webui && node --no-warnings harness/k2k_loop.mjs     # PASS
cd re/webui && node --no-warnings harness/click_check.mjs  # PASS 无爆音
cd re/engines/k2k && node --test "test/**/*.test.mjs"      # 8/8 pass
```

### 6.1 `f_ca70` の置換テスト (決定的)

`boundary_verify.mjs` と同じ OUT トランポリンで **RVA 0xca70 の入口を JS 実装に差し替え**、
引数 (node, k, pos1) を読み、`core/accent_junction.js` の `fca70` の値を EAX に入れて
`ret 8` をエミュレートした。**公式の出力が 1 文字も変わらなかった** =
34 エントリのジャンプテーブルの解読が完全に正しい。

---

## 7. 証拠に基づく否定的結論 (前エージェント分も含む)

| 仮説 | 判定 |
|---|---|
| extra バイト = 連接コスト | **証偽** (連接は MTX1 にある) |
| extra バイトは疎なルックアップテーブルの索引 | **証偽**。ビットフィールド (cls/val) で、ビット演算と分岐で消費される |
| extra を 1 バイトずつ独立に読めば規則が分かる | **証偽**。次語の val と前接語の POS クラスの組で決まる |
| extra の長さ = `(flag&0x0f)` または `(flag&0x0f)-1` | **証偽 (偶然一致)**。`flag&3` + `(flag&4)?3:0` が正しい |
| 核位置 A は「拍」ではなく「文字」インデックス | **証偽**。読みは 1 拍 = 1 コードの配列で、A は拍番号 |
| ン/ッ/ー の補正は頭語のアクセントクラス依存 (テーブル) | **証偽**。単純な「核が ン/ッ/ー を指したら 1 つ手前」規則 |
| アクセント句の分割はディスパッチャが決める | **証偽 (半分)**。呼び出し側の事前パス (RVA 0xbc00) が決める |
| 複合名詞は 2 語まで | **証偽**。連鎖は無制限 |
| 連接行列が無い辞書でも既定のままでよい | **証偽 (バグ)**。`useMatrix` で分岐 (前エージェント修正済み) |
| 連接コストは位置ごとの最良 1 個の DP で足りる | **証偽**。状態 = (位置, 品詞) が必要 |
| アクセント結合データのテーブル本体が未同定 | **解決**。テーブルは存在せず、POS1 クラス表 + ジャンプテーブル + ビットフィールド |
| `0xbe16` の `f_ca70` チェーンは現語 (cur) を引数に取る | **証偽 (今回の最大の落とし穴)**。`ecx = ebx` = **直前語** |
| `ref14` は直前ノードの核 | **証偽**。「型 != 0 だった最後のノード」の核 |
| 語数 1 のときも先頭ノードの型は 1 になる | **証偽**。`n < 2` は分類器ごとスキップ (型は 0 のまま) |
| 境界型は POS クラスだけの表で近似できる | **証偽**。境界一致 192/227、最終一致率は DEV 89.3% / 保留 87.4% に悪化 |
| 境界型は (直前クラス, 現クラス) のペア表で近似できる | **証偽**。526 ペア中 9 ペアが矛盾、最終一致率 92.5% に悪化 |
| て+補助動詞 / よう / そうです の句分けを全廃して単純化 | **証偽**。DEV 95.7% / 保留 92.0% に悪化 |
| 長い句の分割 (RVA 0xc3e0) が今回の不一致の原因 | **証偽**。0xc3e0 は `[node+0x44]` に 5 を書くだけで `[node+0x42]` は触らない (実測) |
| 語の融合パス (0xceba) が今回の不一致の原因 | **証偽**。`猫飴` は 0xceba の時点で既に 1 ノード (融合はさらに手前の 0x100d170 で完了している)。§8 |

---

## 8. 残る誤差と根因 (227 コーパスでは 0)

227 コーパスは **227/227 = 100%**。より広いコーパス
(`work/probes/_learn_corpus.txt`, 2892 文のうち比較可能 2874 文) では
**2841/2874 = 98.9%** で、残り 33 文はすべて**まったく同じ 1 つの原因**に帰着する。

### OOV 漢字複合語のトークン化 (境界型分類器とは無関係)

```
猫飴   公式 "ヌコアヌ"   我々 "ヌコ'アヌ"
山箸   公式 "サンハシ"   我々 "ヤマバシ"
川花   公式 "センカ"     我々 "カワ'バナ"
```

公式 DLL は **辞書に無い漢字の連続を 1 つの OOV トークンとして扱う**。
その際

* 語ノードは 1 個 (実測: `猫飴` は 0x3bf0 入口で `nodes=1`、`mora=0`・`acc=0`・pos=981)
  → 拍数 0・核 0 なのでアクセントは常に平板になる
* 読みは漢字を**音読み**で連結する (山→サン, 川→セン, 花→カ, 犬→ケン, 橋→キョー)

我々は 2 語に分かち書きして訓読みを当てるため、読みとアクセントの両方が食い違う。
内訳: 読み違い 25 文 + アクセントのみ違い 8 文 = 33 文で、すべてこの 1 機構。
**この融合は RVA 0x100d170 (語ノード列の組み立て) の中で起きており、RVA 0xcea0 の
融合パス (0xceba) ではない** — 0xceba の時点で既に 1 ノードになっている。
自然な複合語 (`天気予報` → 2 ノード, `本屋` → 辞書 1 語) は正しく扱えている。

次の一手 (優先度順):

1. **RVA 0x100d170 の OOV 漢字複合語の扱いを解読** (語ノード列の組み立て)。
   ここが分かれば拡張コーパスも 100% に届く。今回の目標 (227/227) には不要。
2. RVA 0xc3e0 / 0xc5c0 (長い句の分割) の解読。コーパスでは未発火だが長文で必要。
3. コーパス拡大。特に `、` を含む文、複合動詞、サ変動詞。

---

## 9. 制約の遵守

* **API 互換**: `toKana` / `toKanaDetailed` / `segment` / `reading` / `createDict` / `createDictWithUser`
  のシグネチャと戻り値構造は不変。追加フィールドのみ
  (`toKanaDetailed` の `pos`/`cost`/`flag`/`jcnt`/`junc`/`moraByte`/`accByte`)。
  旧挙動は
  `accentModel:'dedupe'` / `segmentMode:'greedy'` / `connCost:'approx'|'off'` /
  `accentRule:'heuristic'` / **`phraseGroup:'heuristic'`** で選択可能
  (`phraseGroup:'heuristic'` は改前と完全に同じ 137/140)。
* 変更ファイル: `core/engine.js` / `core/kanji_accent.js` / `core/accent_junction.js`。
  `core/zh_kana.js` / `core/lang_tag.js` / `core/convert_text.js` / `core/num.js` は無変更。
  `test/` `tools/` `demo/` `README.md` `package.json` は無変更 (test は実行のみ)。
* `work/aqdic.bin` と公式 DLL は未コミット (`work/` は .gitignore)。
  解析ツールは `eval/tools/` に追加 (追跡対象):
  `accent_trace.mjs` / `official_mut.mjs` / `seq.mjs` / **`boundary_verify.mjs`** / **`gen_truth.mjs`**。
* テキスト末尾の尾高 `'` の硬切はユーザ選択のため変更していない
  (`click_check.mjs` PASS 无爆音)。
