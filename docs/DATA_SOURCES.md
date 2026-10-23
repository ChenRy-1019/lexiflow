# 数据来源与许可说明

LexiFlow 内置的词库由 `scripts/build-lexicon.ts` 从上游开源数据集生成。
本文档说明每一条数据的来源、许可与再分发条件。

## 上游数据集

| 数据集 | 用途 | 许可 | 获取地址 |
| --- | --- | --- | --- |
| [ECDICT](https://github.com/skywind3000/ECDICT) | 单词、音标、释义、词性、词频 | MIT | `ecdict.csv` |
| ECDICT `wordroot.txt` | 词根与词缀 | MIT | 同上仓库 |
| [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | 间隔重复调度算法 | MIT | npm 依赖 |
| [fsrs-rs](https://github.com/open-spaced-repetition/fsrs-rs) | Rust 侧 FSRS 参考实现 | BSD-3-Clause | crates.io |

ECDICT 的 `LICENSE` 文件以 `MIT License` 授权，版权归 Linwei 所有。该许可允许
再分发与再许可，只要求保留版权声明与许可文本。LexiFlow 在
`data/_upstream/` 中保留了下载的原始文件，并在构建产物中记录其 SHA-256 校验和。

## 词书划分

内置词书全部由 ECDICT 的 `tag` 与 `frq`（词频排名）两列筛选得到：

| 词书 ID | 名称 | 筛选条件 |
| --- | --- | --- |
| `cet4` | 大学英语四级词汇 | `tag` 含 `zk` / `cet4`，`frq ≤ 6000` |
| `cet6` | 大学英语六级词汇 | `tag` 含 `zk` / `cet6`，`frq ≤ 8000` |
| `kaoyan` | 考研英语词汇 | `tag` 含 `ky` / `gk`，`frq ≤ 8000` |
| `ielts` | 雅思核心词汇 | `tag` 含 `ielts` |
| `toefl` | 托福核心词汇 | `tag` 含 `toefl` |
| `gre` | GRE 核心词汇 | `tag` 含 `gre` |
| `cet4-phrase` | 四级常用词组 | 同四级，但仅多词短语 |
| `top2000` | 最高频 2000 词 | `frq ≤ 2000` |
| `top5000` | 高频 5000 词 | `frq ≤ 5000` |
| `coca20000` | COCA 20000 词 | `frq ≤ 20000` |
| `roots` | 词根词缀 | 来自 `wordroot.txt` |

词频排名来自 ECDICT 收录的语料库统计，不同版本的口径可能略有差异，因此
各词书的条目数不是严格固定值。生成结果以实际构建输出为准。

## 词根词缀的关联方式

`wordroot.txt` 为每个词根与词缀给出释义、语源和示例词。构建脚本对每个词条
做两步匹配：

1. 词根字符串（去掉非字母字符后）是否是该词的前缀、后缀，或长度不小于 4
   的中段；
2. 该词的示例词列表里是否直接出现这个词。

两步同时成立，或者词根本身长度不小于 5 时才会写入 `etymology` 字段。这样
可以避免把 `art`、`ter` 这类短词根错误地匹配到大量无关单词上。

## 生成检查

构建脚本在写出文件前会检查：

- 每条词条的中文释义非空；
- 词组经过空格归一化处理；
- 同一词书内 ID 唯一；
- 词频区间与标签同时生效，避免一本书被另一本书的规则误伤。

## 再分发

`data/lexicon.json` 是本项目生成的作品，可以随应用一起分发。使用者若要自行
构建词库，需要遵守 ECDICT 的 MIT 许可：保留其版权声明与许可文本。

上游数据集不包含在本仓库中（见 `.gitignore`），首次执行 `npm run lexicon:build`
时会自动下载到 `data/_upstream/`。

## 与 Vocabulary Studio 的关系

本项目参考了 [Frinds-A/Vocabulary_Studio](https://github.com/Frinds-A/Vocabulary_Studio)
的产品形态与交互设计思路（今日计划、三种练习模式、生词本、间隔复习），
但**没有使用其源代码或词库数据**：

- 该仓库根目录没有 LICENSE 文件，按 GitHub 的默认版权规则，它的所有内容
  都是「保留所有权利」，未经作者授权不可复制、修改或再分发；
- 其词库来自第三方 PDF、Excel 与来源不明的 `kajweb/dict` 压缩包，其中
  `kajweb/dict` 明确没有提供许可。

因此 LexiFlow 从零实现了全部代码，并改用许可清晰的 ECDICT 作为数据源。
如需使用 Vocabulary Studio 的词库，请先联系作者取得授权。
