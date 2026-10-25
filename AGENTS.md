# 协作约定

给在本仓库工作的 AI 代理和贡献者的规则。

## 发布：必须先问

**不要自行上传版本。** 构建、签名、生成 `latest.json` 都可以做，但
`gh release create`、`gh release upload`、以及任何改动 GitHub Releases 的操作，
都要先说明要发什么，等作者明确同意后再执行。

原因：发布是对外的动作，影响所有已安装的用户，作者需要自己确认版本号、
发布说明和时机。

可以自主做的：

- 改代码、跑测试、构建、签名
- 生成 `release/latest.json` 和分发包 zip
- `git add` / `git commit` / `git push` 到 master
- 写发布说明草稿

需要先问的：

- 创建或修改 GitHub Release
- 删除 Release 或其中的资源
- 打 tag 并推送到远端（`git push --tags`）
- 改仓库的公开设置（描述、主页、可见性）

## 版本号

- 修 bug、调文案、补词条：补丁号（0.2.1 → 0.2.2）
- 加功能、加词书：次版本号（0.2.x → 0.3.0）
- 不确定时问作者

三处版本号必须同步：`package.json`、`src-tauri/tauri.conf.json`、
`src-tauri/Cargo.toml`。

## 改完要跑

```bash
npm run typecheck            # tsc --noEmit
npm test                     # 前端
cd src-tauri && cargo test   # 后端
npm run audit:css            # 组件类名与样式表一致
```

`audit:css` 报出的 `grade--`、`chip--memory-`、空字符串是模板字符串造成的
误报，可以忽略。

## 数据

- `data/lexicon.json` 与 `data/_upstream/` 不进仓库，用 `npm run lexicon:build` 生成
- 词库版权说明写在 `docs/DATA_SOURCES.md`，改动数据源时同步更新
- 从文件导入的词书用 CSV，放在 `data/wordbooks/`，在
  `scripts/build-lexicon.ts` 的 `BOOKS` 里登记

## 提交信息

用英文写，说明**为什么**改，而不只是改了什么。一次提交一件事。

## Windows 上的坑

- PowerShell 5.1 读 UTF-8 脚本需要 BOM，否则中文变乱码
- `git commit -m` 里的引号会被吞，改用 `-F 文件`
- 中文输出到控制台会乱码，需要核对时写到文件再读
- 本机的 Steam++ 加速器会让 `api.github.com` 间歇性 502，发布失败时先看它
