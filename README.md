# LexiFlow · 词汇流

一个本地优先的英语词汇学习桌面应用。数据全部留在本机，用 **FSRS** 科学记忆算法
安排复习，用 **词根词缀** 帮你拆解生词。

> 灵感来自 [Vocabulary Studio](https://github.com/Frinds-A/Vocabulary_Studio) 的产品
> 形态，但代码与词库全部重新实现。详见 [数据来源与许可说明](docs/DATA_SOURCES.md)。

## 为什么做这个

现有的背单词软件大多在两个方向上走极端：要么塞满花哨的功能，要么只是一张
单词卡列表。LexiFlow 想解决的问题很具体——

**记忆该在什么时候发生，由算法决定，而不是由我决定。**

Vocabulary Studio 用的是固定间隔：1 天 → 2 天 → 4 天 → 7 天 → 15 天 → 30 天。
这个阶梯把「abandon」和「ubiquitous」当成同一类词，结果是前者被拖到该忘的时候
才复习，后者被反复打扰。FSRS 为每个词单独维护**记忆稳定度**（stability）和
**难度**（difficulty），按目标留存率反推下次复习时间：记得牢的词自动拉长间隔，
记不牢的词很快回来。

## 功能

- **三种练习模式** — 拼写（看中文写英文）、词义选择、听音拼写
- **FSRS 调度** — 四个评分按钮（忘记 / 困难 / 记得 / 简单），每个按钮实时显示
  下次复习间隔，例如「3d」「2.1mo」
- **记忆强度** — 每个词显示当前预计留存率，让你知道哪些词正在变模糊
- **逐字母判定** — 拼错时用最长公共子序列对齐，标出真正错的那一个字母，
  而不是笼统地判错
- **词根词缀** — 内置 611 条词根词缀，其中 5,394 个词条附带了拆解
- **词库浏览** — 按分类筛选、全库搜索、查看任意词书的全部词条
- **生词本** — 答错不会自动收录，只有主动点击才进入
- **本地存储** — SQLite 单文件，学习记录不上传任何服务器
- **数据导出** — 完整学习记录导出为 JSON

内置词库共 **52,523** 条，分布在 10 本词书：

| 词书 | 条数 | 词书 | 条数 |
| --- | ---: | --- | ---: |
| 大学英语四级词汇 | 4,756 | 雅思核心词汇 | 5,039 |
| 大学英语六级词汇 | 6,455 | 托福核心词汇 | 6,974 |
| 考研英语词汇 | 6,221 | GRE 核心词汇 | 7,504 |
| 最高频 2000 词 | 1,791 | 词根词缀 | 608 |
| 高频 5000 词 | 4,394 | 高频 10000 词 | 8,781 |

## 界面

今日计划

![今日计划](screenshots/01-home.png)

练习页：看释义写英文，答完后按记忆程度评分

![练习](screenshots/05-graded.png)

词库浏览

![词库](screenshots/02-library.png)

## 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 桌面外壳 | [Tauri 2](https://tauri.app) | Rust 后端，安装包约 10 MB |
| 前端 | React 19 + TypeScript + Vite | 无 UI 框架，样式全部手写 CSS 变量 |
| 存储 | SQLite（`rusqlite`） | WAL 模式，单文件数据库 |
| 调度 | [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | FSRS 官方 TypeScript 实现 |
| 数据 | [ECDICT](https://github.com/skywind3000/ECDICT) | MIT 许可的英汉词典数据集 |

调度算法放在前端而非后端，是有意的：算法只有一份实现，且可以脱离数据库直接
做单元测试。后端只负责持久化。

## 快速开始

### 环境要求

- Node.js 20+
- Rust 1.77+
- Windows 上还需要 [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)
  （勾选「使用 C++ 的桌面开发」）

### 安装依赖

```bash
npm install
```

### 构建词库

首次运行会下载 ECDICT 数据集（约 65 MB）并生成 `data/lexicon.json`：

```bash
npm run lexicon:build
```

生成的词库不提交到仓库，按需本地构建即可。

### 开发

```bash
npm run tauri:dev
```

### 打包

```bash
npm run tauri:build
```

产物在 `src-tauri/target/release/bundle/nsis/`。

## 项目结构

```
src/
  lib/
    fsrs.ts          FSRS 封装：评分、间隔预览、留存率估算
    api.ts           与 Rust 后端的 IPC 桥接
    types.ts         领域类型定义
  pages/
    HomePage.tsx     今日计划
    PracticePage.tsx 练习页，评分与反馈
    LibraryPage.tsx  词库浏览
    NotebookPage.tsx 生词本
    StatsPage.tsx    学习统计
    SettingsPage.tsx 偏好设置
  components/
    TitleBar.tsx     无边框窗口的标题栏
  styles/global.css  设计令牌与全部样式

src-tauri/src/
  lib.rs       Tauri 命令：会话构建、评分记录、统计聚合
  session.rs   会话选择与进度统计（纯逻辑，可单测）
  db.rs        SQLite 存储层
  lexicon.rs   词库加载与查询
  util.rs      日期、文本归一化等工具
  error.rs     错误类型

src-tauri/tests/
  storage.rs     数据库读写
  lexicon.rs     词库查询
  review_flow.rs 完整复习流程

scripts/
  build-lexicon.ts      词库生成脚本
  check-backend.py      词库完整性检查
  capture-screenshots.ps1 界面截图（冒烟测试）
  make-icon.py          图标生成
```

## 测试

```bash
npm test                        # 前端：FSRS 调度与 IPC 契约
cd src-tauri && cargo test      # 后端：存储、词库、复习流程
python scripts/check-backend.py # 词库完整性
```

前端测试里有一项会直接读取 `src-tauri/src/lib.rs`，比对 `#[tauri::command]`
函数与 `generate_handler!` 注册表是否一致，也检查前端调用到的每个命令名都
真实存在。两边不同步时，测试会失败而不是让程序在运行时崩溃。

## 设计说明

### 键盘操作

| 按键 | 作用 |
| --- | --- |
| `Ctrl+1` … `Ctrl+5` | 今日计划 / 我的词库 / 开始学习 / 生词本 / 学习统计 |
| `Ctrl+,` | 偏好设置 |
| `Enter` | 判定答案（拼写模式）／确认选项（选择模式） |
| `Ctrl+Enter` | 跳过当前词 |
| `Esc` | 返回上一页 |
| `1` … `4` | 选择模式中直接选第 N 个选项 |

页面切换用数字键而不是字母键，是因为 `Ctrl+L`、`Ctrl+P` 这类组合被 WebView
自己占用，事件根本到不了页面。

### 为什么用 FSRS 而不是固定间隔

FSRS 建模的是**每个词各自的记忆状态**，而不是按学习次数套用一张时间表：

- **stability** — 这个词目前能撑多少天不忘（以 90% 留存率为基准）
- **difficulty** — 这个词本身有多难，范围 1–10

下次复习时间由 `I(r, S) = (r^(1/DECAY) - 1) / FACTOR × S` 推出，`r` 是目标留存率。
记得牢的词 stability 涨得快，间隔自然拉长；反复记错的词 stability 被压低，
很快就要再见。

在 Anki 社区的基准测试里，FSRS-6 相比默认算法能减少约 20% 的复习量，同时
保持相近的长期留存率。

### 为什么答错不自动进生词本

自动收录会让生词本迅速膨胀成第二份词库，失去筛选的意义。Vocabulary Studio
选择了同样的策略，LexiFlow 沿用了这一点——但把「错过次数」记了下来，方便按
错误次数排序复习。

### 为什么词库是打包进应用的

词库在运行时不变，所以没有必要放进数据库。用 JSON 资源文件分发有三个好处：
启动快、可以直接 diff、体积对安装包影响可忽略。

## 贡献

欢迎提交 issue 和 pull request。请注意：

- 代码风格遵循现有文件的风格，不引入新的格式化工具
- 涉及算法改动的 PR 请附带说明，以及改动前后的间隔对比
- 不要提交 `data/_upstream/` 和 `data/lexicon.json`

## 许可

代码采用 [MIT 许可](LICENSE)。

词库数据来自 ECDICT（MIT 许可），详见 [数据来源与许可说明](docs/DATA_SOURCES.md)。
