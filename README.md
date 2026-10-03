# bakak2k

纯 JS 的 漢字→読み（读音假名）引擎，兼容 AqKanji2Koe 词典格式的开源实现。

它读取官方 **AqKanji2Koe SDK 附带的 `aqdic.bin` 词典**（不开源、不随本仓库分发），在 JS 里直接解码
其中的 Marisa trie + TOK1 词条正文，把日文句子转换成带音高的假名读音；另外内置
**英语单词** 与 **阿拉伯数字** 的读法规则，用于 TTS 前置处理。

> 名称与 AQUEST 的 AqKanji2Koe 无关，仅实现其词典格式与行为，避免商标/版权混淆。
> `AqK2KDict` 类名保留为 API 兼容层（同款形制的接入代码可直接替换）。

## 它能干什么

- 整句转换：`東京都渋谷区` → `トーキョートシブヤク`，`渋谷とShibuya` → `シブヤトシュイブウア`
- 英文句子合成输出**去掉词间空格**：`Hello world` → `ヘロワールド`（一个连贯音流，不会在读词之间停顿；想停顿请自己加 、 或 ，）
- 数字读数：`100円` → `ヒャクマル`*、`在来10時` → `...`、`電話090-1234-5678` → `デンワゼロキュウゼロイチニサンヨン...`
- 英语/罗马字：`iPhone 15` → `アイフォンジュウゴ`*（词表 + 短词逐字母拼读 + g2p 兜底）
- 逐词读音：`山` → `サン / ザン / ヤマ / セン / …`（一音全部读音）
- 分词段信息：`segment()` 返回 surface → reading / accent / mora

\* 数字+量词连读（如 `100円→ヒャクエン`、`10時→ジュウジ`）是日语量词音便规则，
本版读数字部分后接词典读出的量词（`マル/トキ` 为词典首选读），完整音便打磨见下方“已知限制”。

## 安装

```sh
npm install
```

## 拿词典

`aqdic.bin` 是 AQuesTalk 的专有数据，**不要把它提交进仓库**。获取方式任选：

1. 自动从官方 SDK zip 解压（`aqk2k_win_413.zip` 内含 `aqk2k_win/aq_dic/aqdic.bin`），
   本库提供 zip 解包层，运行时把 zip 字节喂进来即可。
2. 直接提供 `aqdic.bin` 的 ArrayBuffer / Uint8Array。

### 浏览器（运行时加载）

JSZip 只有 UMD 构建。**不用打包器**直接在页面里跑时，加一张 import map 把它接到
`dist/jszip.min.js`（详见 `demo/index.html`）：

```html
<script type="importmap">
  { "imports": { "jszip": "./js/jszip-wrapper.mjs" } }
</script>
<script type="module">
  import { createDictAuto } from './src/index.js';
  const zip = new Uint8Array(await fetch('aqk2k_win_413.zip').then(r => r.arrayBuffer()));
  const dict = await createDictAuto(zip);   // 内部用 JSZip 解出 aqdic.bin
  console.log(dict.toKana('東京都渋谷区'));  // トーキョートシブヤク
</script>
```

用 bundler（vite/webpack）时不需要 import map，`import { createDictAuto } from 'bakak2k'` 直接可用。

### Node

```js
import { readFileSync } from 'node:fs';
import { createDictAuto } from 'bakak2k';

const dict = await createDictAuto(readFileSync('aqk2k_win_413.zip'));
console.log(dict.toKana('東京都渋谷区'));
```

解压 zip 用现成的 **JSZip**（`npm install bakak2k` 时自动装上），不自己解析 zip 格式，
zip64 / data descriptor / 各种 flag 组合都能正确处理。

## API

- `createDict(bytes)` → 词典实例。`bytes` 为 `aqdic.bin` 的字节。
- `createDictAuto(bytes)`（async）→ 同 `createDict`，但自动识别 zip 并解出其中的 `aqdic.bin`。
- `dict.toKana(text)` → 整句转假名（标音标）。未知字符原样透传。
- `dict.toKanaDetailed(text)` → 逐段 `{ surface, reading, accent, mora }`。
- `dict.segment(text)` → 分词段数组 `{ surface, reading, id }`，reading 为 `{ text, accent, mora } | null`。
- `dict.get(surface)` → 某词的候选读音数组（多条：音读/训读/读法差异）。
- `dict.reading(surface)` → 首选读音。
- `dict.mergeUserDict(userBytes)` → 合并用户词典（`aq_user.dic` 的字节），用户词**覆盖**同名系统词、新词追加。
- `createDictWithUser(sysBytes, userBytes)` → 一次构建（系统词典 + 用户词典）。
- `parseUserDict(userBytes)` → 解析 `aq_user.dic`，返回 `Map<surface, {text, accent, mora}[]>`。

### 英文

连续 `[A-Za-z]` 串按类 AqKanji2Koe 的英语规则处理（`src/en_rules.js`）：

- 词表命中 → 词读（`src/en_rules.js` WORD_TABLE，约 1300 词，采集自 SDK DLL 掩码语料）
- 未命中且 ≤3 字母 → 逐字母名拼读（`PC` → `ピーシー`、`go` → `ジーオー`）
- 其余 → g2p 兜底

规则训练自 SDK DLL 的**评估版掩码语料**（评估授权把 ナ行/マ行 打成 `ヌ`）。本实现输出未掩码读音，
交叉验证：340 词主语料掩码比对 **100% 一致**，exact 字符串命中 79 个。

### 数字

`src/num.js` 把阿拉伯数字串转成读音假名，规则对齐 DLL 的分界：

| 输入 | 输出 | DLL 行为 |
| --- | --- | --- |
| `123` / `12,345` / `2024` | `ヒャクニジュウサン` / `イチマンニセンサンビャクヨンジュウゴ` / `ニセンニジュウヨン` | ≤4 位或有千分位 → 数值读（NUMK） |
| `12345` / `1234567` | 逐位读（`イチニサンヨンゴ`…） | ≥5 位无千分位 → 逐位（NUM） |
| `090-1234-5678` | `ゼロキュウゼロイチニ…` | 电话/前导 0 → 逐位 |
| `3.14` / `0.5` | `サンテンイチヨン` / `ゼロテンゴ` | 整数+テン+小数逐位 |
| `-5` / `+5` | `マイナスゴ` / `プラスゴ` | 符号读 |
| `10%` | `ジュウパーセント` | パーセント |

### アクセント（音高）

`src/kanji_accent.js` + `src/accent_junction.js` 处理音高记号 `'`（アクセント核），规则如下：

- **连接コスト行列**：`aqdic.bin` 的 `0x9640`（`MTXD`/`MTX1`，1182×1182 的 int16）。
  索引 = 记录的 `pos & 0x7fff`，index 0 = 文頭/文末；方向为 `cost(prev→next) = M[next][prev]`。
  配合**状态为 `(文字位置, 直前品詞)` 的 Viterbi 分词**（连接コスト依赖前一词的品詞）。
- **アクセント結合**：每条记录尾部的可变长「结合字节」（个数 `flag & 3`，位置见下方词典格式），
  结合コードと核位置テーブルで核位置を決め、 `ン`/`ッ`/`ー` 的前移补正。
- **句境界型**：アクセント句は語ごとの境界型で分割する。
- **一句一下降**：各アクセント句の核 `'` は高々 1 つ。

与官方 AqKanji2Koe 的一致率：**227/227 = 100%**（开发 140 句 + 保留 87 句），
含 `'` 的假名序列逐字完全一致。

```js
import { createDict, convertJapanese } from 'bakak2k';
const dict = createDict(aqdicBytes);
convertJapanese(dict, '天気予報によると明日は雨らしいです').kana;
// → テンキヨ'ホーニヨルトアシタ'ワア'メラシイデス
```

### 中文（拼音 → かな）

`src/zh_kana.js` 把拼音转成假名（用 `pinyin-pro` 取拼音；音高模式下 4 声与句末降调用 `'` 表示）。
`src/convert_text.js` 做混在文本的分段转换与标点归一化，`src/lang_tag.js` 提供闭合语言标签
`[zh]…[/zh]` / `[ja]…[/ja]`。

```js
import { convertSegments } from 'bakak2k';
const r = convertSegments(dict, '你好，世界');
r.kana;                       // ニーハオ、シージエ
r.parts.map(p => p.lang);     // ['zh', 'zh']  ← 逐段判定结果
```

自动判别：文本含假名 → 日语；否则「汉字未解析率 ≥ 0.3」→ 中文。

## 词典格式（解码备忘）

词条正文 TOK1 记录布局：

```
[pos2][cost2][flag][moraByte][accentByte][mora×(读音 kana 码)][flag&0x0f 字节附加]
```

- `mora 数 = moraByte & 0x1f`（= `moraByte` 低 5 位）
- `accentByte` 的核位置为 **低 5 位**（`& 0x1f`；高位不是 accent 的一部分）
- 附加字节数 = `flag & 3`，起始偏移 = `rec + 7 + mora + ((flag & 4) ? 3 : 0)`
- 尾部读 kana 码右对齐的 `e7 83` 前缀记录按右侧对齐规则读
- kana 码表见 `src/kana.js`（来源：逆向 aqk2k_win_413/lib 相关常量）

## 用户词典（aq_user.dic）

官方引擎会同时加载 `aqdic.bin`（系统）+ `aq_user.dic`（用户），用户词优先。`aq_user.dic`
由配套工具 **AqUsrDic.dll** 从 CSV（表記, 読み[带 `'` 音高记号], 品詞コード）生成，格式与
`aqdic.bin` 同源（`HDR1` + MARISA `TRI1` + `MAP1` + `TOK1`）。注意它依赖同一份系统词典
（换一套 `aqdic.bin` 不保证兼容）。

```js
import { createDictWithUser } from 'bakak2k';
const dict = createDictWithUser(aqdicBytes, aqUserBytes); // 用户词自动优先
```

已用真实 DLL 交叉验证：用户词典覆盖系统词后，`東京 → トホホホ`（覆盖）+ 新增词
均与官方输出一致。

## 已知限制 / 待打磨

- **量词语义连读**：`100円`/`10時`/`5分` 等，数字本身读对数，但“円/時/分”按词典字面读
  （`マル`/`トキ`/`フン`），日语量词音便（`ヒャクエン`、`ジュウジ`、`ゴフン`）未实现。
- **句尾逗号句号**：`。` 等仍原样透传，未输出 AQV 的句读代码。
- **英语 g2p 兜底**对生僻词质量一般（常见词基本在词表内）。
- **n/m 行掩码**：评估版把 マ行/ナ行 打成 `ヌ`，本实现按标准读音还原，付费版可最终对拍。
- **纯假名输入**：纯假名文本的行为与汉字混排文本不同，本实现的アクセント対応以含汉字的句子为对象。
- **词典外汉字连続**：词典里没有的汉字连続会按音读连接成一个节点，本实现未对应。

## 许可

- 本仓库代码：MIT。
- `aqdic.bin`：AQuesTalk 的专有词典，从官方 SDK zip 中解出，仅限你自己已获许可的副本使用，不要随库分发。
- 官方 SDK 中 `CREDITS` 注明其使用基于 BSD 的 NAIST 日文词典与 MARISA（见 `aqk2k_win/aq_dic/CREDITS`），但在你自己的应用中分发 AQ 的词典仍需遵守其 EULA。

## 浏览器性能测试

```sh
npm run demo
```

然后打开 http://localhost:4173/demo/ 看加载/整句转换耗时控制台输出。