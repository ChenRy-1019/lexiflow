# 发布流程

发版分两半：**Gitee 是主发布渠道**（安装包放这里，用户从这下载），
**GitHub 由 Actions 自动镜像**（只作为备份和代码主页）。

> **发布要人工确认。** AI 代理可以改版本号、写说明、构建、签名、打包、
> 生成清单，但**不能自己决定发布**。发之前要先说明版本号和内容，等作者同意。

## 前提

- 签名密钥在 `~/.lexiflow-keys/lexiflow.key`，密码单独记着。**不要提交到仓库**
- 发布需要 `GITEE_TOKEN` 环境变量（Gitee 私人令牌，勾选 `projects` 权限）
- 密钥丢了就再也签不了新版本，已装用户会拒绝所有更新，务必单独备份

## 一条命令发完

```powershell
$env:GITEE_TOKEN = "<你的 Gitee 令牌>"
powershell -File scripts/release.ps1
```

`scripts/release.ps1` 会按顺序做这些事：

| 步骤 | 做什么 |
|---|---|
| 1 | 类型检查、前端测试、后端测试（不过就中止） |
| 2 | 读 `tauri.conf.json` 里的版本号，构建并签名 |
| 3 | 传安装包和签名到 Gitee Release |
| 4 | 生成清单，下载地址指向 Gitee |
| 5 | 把清单提交到 `updates/latest.json` 并传到 Gitee |
| 6 | 打包 `release/LexiFlow-<版本>.zip` 分发包 |

跑完它会打印剩下的一条命令——那是 GitHub 部分，需要你确认后再执行。

## 版本号

三个地方必须同步，`release.ps1` 不会替你改：

- `package.json` → `version`
- `src-tauri/tauri.conf.json` → `version`
- `src-tauri/Cargo.toml` → `[package] version`

补丁号（修 bug、调文案、补词条）还是次版本号（加功能、加词书），见 `AGENTS.md`。

## 更新说明

编辑仓库根目录的 `release-notes.md`。这段文字会同时出现在：

- GitHub Release 页面
- Gitee Release 页面
- 软件内的更新弹窗「本次更新」

写得具体，用户会在这里看到这次改了什么。

## GitHub：推 tag 即自动发布

发布 Gitee 之后，打一个 tag 推上去，GitHub Actions 会自动建 Release：

```powershell
git tag -a v0.4.0 -m "LexiFlow 0.4.0"
git push origin --tags
```

工作流 `.github/workflows/release.yml` 会：

1. 从 Gitee 下载同版本的 `LexiFlow_<版本>_x64-setup.exe` 和 `.sig`
2. 校验文件大小（小于 1MB 视为没传好，直接失败）
3. 校验 `updates/latest.json` 里的版本号与 tag 一致（防错发）
4. 创建 Release，或用 `--clobber` 补附件

**不需要 GitHub 令牌**，用的是仓库自带的 `GITHUB_TOKEN`。

### 为什么要这样

作者的机器到 `api.github.com` 和 `uploads.github.com` 常常连不上（本地加速器
只代理了 git 协议），于是代码和 tag 推得上去，带附件的 Release 却建不出来。
把上传挪到 GitHub 自己的服务器上执行，就绕开了这个限制。

### tag 已经推了、但没触发？

tag 指向的提交如果早于工作流文件，推 tag 不会触发。这时用手动入口：

```powershell
gh workflow run "release.yml" -f tag=v0.4.0
```

或者网页：仓库 → Actions → Mirror a release from Gitee → Run workflow，
填入 tag 名。

### 工作流跑完了 Release 还是草稿？

GitHub 里手动建过草稿又没发出去的，工作流会识别成「已存在」并只补附件，
草稿状态不会自动变。手动发布一下：

```powershell
gh release edit v0.4.0 --draft=false --latest
```

## 更新是怎么生效的

```
用户打开软件
   ↓
依次尝试三个端点读 latest.json：
   https://gitee.com/chens-code-rythm/lexiflow/raw/master/updates/latest.json
   https://ghproxy.net/https://github.com/.../latest/download/latest.json
   https://github.com/.../latest/download/latest.json
   ↓
版本比当前新？
   ↓ 是
弹窗显示更新说明
   ↓ 用户点「下载并安装」
按清单里的 url 下载 exe（指向 Gitee）
   ↓
用编译进去的公钥验证签名
   ↓ 通过
静默安装 → 自动重启到新版本
```

**清单决定从哪下载**，端点只决定从哪读清单。所以换了下载源，旧版本的用户
也能拿到新地址。

签名验证是关键：文件被替换或损坏时签名对不上，安装会被拒绝。所以私钥不能泄露。

## 各版本状态

GitHub 上 v0.3.2 只有 tag、没有 Release——它的功能都并进 0.3.3 了，
不需要补发。tag 保留在仓库里当历史记录。

## 出问题先看这里

| 现象 | 原因 | 处理 |
|---|---|---|
| `gh release create` 报 502 / 504 | 本机到 `api.github.com` 不通 | 改推 tag 让 Actions 发 |
| 上传附件卡住、报 "process that file" | `uploads.github.com` 不通 | 同上，Actions 在服务器上做 |
| `git push` 也超时 | 加速器没开 | 开加速器，或换网络 |
| 工作流报「清单版本不一致」 | 忘了先跑 `release.ps1` | 先发 Gitee，再推 tag |
| 用户收不到更新 | 清单没更新 | 检查 `updates/latest.json` 的 version |

## 密钥丢失会怎样

**私钥或密码丢了，就再也无法给新版本签名了。** 已安装的用户会拒绝所有更新，
只能让他们手动下载新包。

把 `~/.lexiflow-keys/lexiflow.key` 和密码备份到安全的地方（密码管理器、加密 U 盘）。
不要放进 Git 仓库，也不要发到聊天工具里。
