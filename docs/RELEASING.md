# 发布流程

发一个新版本只需要四步。

> **第 4 步要人工确认。** AI 代理可以改版本号、写说明、构建、签名、打包，
> 但**不能自己上传**。发布前要先说明版本号和内容，等作者同意。

## 1. 改版本号

三个地方要同步改：

- `package.json` → `version`
- `src-tauri/tauri.conf.json` → `version`
- `src-tauri/Cargo.toml` → `[package] version`

补丁号（修 bug、补词条）还是次版本号（加功能、加词书），见 `AGENTS.md`。

## 2. 写更新说明

编辑仓库根目录的 `release-notes.md`。这段文字会同时出现在：

- GitHub Release 页面
- 软件内的更新弹窗「本次更新」

写得具体一点，用户会在这里看到这次改了什么。

## 3. 构建并签名

第一次构建需要设置签名密钥的环境变量。密钥在 `~/.lexiflow-keys/`，
**不要提交到仓库**。

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.lexiflow-keys\lexiflow.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "你的密码"

npm run tauri:build
```

构建产物：

```
src-tauri/target/release/bundle/nsis/
  LexiFlow_<版本>_x64-setup.exe
  LexiFlow_<版本>_x64-setup.exe.sig   ← 签名，更新器用它验证
```

## 4. 生成清单并发布

```powershell
npm run release:manifest        # 生成 release/latest.json
npm run release:publish         # 打 tag、传三个文件、发布
```

或者手动：

```powershell
powershell -File scripts/manifest.ps1 -Repo ChenRy-1019/lexiflow

gh release create v<版本> `
  src-tauri/target/release/bundle/nsis/LexiFlow_<版本>_x64-setup.exe `
  src-tauri/target/release/bundle/nsis/LexiFlow_<版本>_x64-setup.exe.sig `
  release/latest.json `
  --title "LexiFlow <版本>" --notes-file release-notes.md
```

**三个文件缺一不可**：安装包、签名、清单。少传签名，更新器会拒绝安装；
少传清单，客户端不知道有新版本。

## 更新是怎么生效的

```
用户打开软件
   ↓
读取 …/releases/latest/download/latest.json
   ↓
版本比当前新？
   ↓ 是
弹窗显示更新说明
   ↓ 用户点「下载并安装」
下载 exe → 用编译进去的公钥验证签名
   ↓ 验证通过
静默安装 → 自动重启到新版本
```

签名验证是关键：如果下载的文件被替换或损坏，签名对不上，安装会被拒绝。
所以**私钥不能泄露**，一旦泄露任何人都能发布「更新」。

## 镜像

更新器配置了两个端点，先用 `ghproxy.net` 镜像，失败再走 GitHub 直连：

```json
"endpoints": [
  "https://ghproxy.net/https://github.com/ChenRy-1019/lexiflow/releases/latest/download/latest.json",
  "https://github.com/ChenRy-1019/lexiflow/releases/latest/download/latest.json"
]
```

国内用户较多时这是必要的，直连 GitHub 常常超时。

## 0.1.0 的老用户

0.1.0 没有内置更新器，他们收不到自动更新，需要手动下载一次 0.1.1。
从 0.1.1 起，后续版本都能自动更新。

## 密钥丢失会怎样

**私钥或密码丢了，就再也无法给新版本签名了。** 已经安装的用户会拒绝所有
更新，只能让他们手动下载新包。

所以：把 `~/.lexiflow-keys/lexiflow.key` 和密码备份到安全的地方
（密码管理器、加密 U 盘）。不要放进 Git 仓库，也不要发到聊天工具里。
