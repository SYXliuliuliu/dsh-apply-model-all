# dsh-apply-model-all — 发布进度

**状态（2026-10-04）**：已建仓 + 已推送 + topic 已打。**PR 未提**（等仓库满 1 天）。

## 已完成的

| 步骤 | 状态 |
|---|---|
| 本地 git 仓库 + 2 个提交 | ✅ |
| GitHub 仓库 `SYXliuliuliu/dsh-apply-model-all`（public） | ✅ 2026-10-04T16:51:38Z |
| 推送 master | ✅ |
| `dsh-plugin` topic | ✅ |
| `dsh.bundle` manifest 核验 | ✅（CI 的必检项） |
| 隐私清扫 | ✅ 8 类模式零命中，git 全历史零命中 |
| peer 范围修正 | ✅ 见下 |
| 装一次真跑（一次性 profile） | ✅ `exit=0`、零错误、自动进 bundles |

## 仓库身份（关键）

- **提交作者**用的是**仓库局部** `user.email`：
  `SYXliuliuliu@users.noreply.github.com`
- **全局** git 身份是 `1054239100@qq.com`，**没有被改**（QQ 邮箱绝不能进公开仓库）。
- 建仓用 `gh repo create --public`（不带 `--add-readme`，避免与本地历史冲突）。
- 推送用 `git -c http.proxy= push`——本机全局 `http.proxy=127.0.0.1:7897`，
  代理关着时会把 git 卡死（不是墙）。

## peer 依赖范围的坑（已修，值得记住）

原先写的：

```
>=0.0.0-0 <0.3.0-0 || >=0.3.0-rc.1 <0.4.0-0
```

**对本机运行版本 `0.2.0-rc.2` 判定为 FAIL。** node-semver 规矩：带 prerelease
的版本要满足某 range，range 里必须有**某个 comparator 与它 major.minor.patch
完全相同、且自身也带 prerelease**。上面两个 comparator 落在 `0.0.0` 和 `0.3.0`
两个 tuple 上，**没有一个是 0.2.0** → 所有 `0.2.0-*` 构建被静默排除，
安装者会撞 `ERESOLVE`。

现用形态（与 awesome-dsh-plugin 贡献指南给的处方一致）：

```
>=0.2.0-rc.1 <0.3.0-0
```

判据工具：`node D:\DSH\tools\semver-check.mjs "<range>" <version...>`
（本机没有可 require 的 semver 模块，所以自带了一份按 spec 实现的判定，
含上面那条 prerelease 特例。）

**注意**：`@deepseek-ai/*` 这几个包本机 profile 的 node_modules 里**根本没装**
（由 app 自带依赖解析），而且本插件**没有 import 它们任何一个**
（`lib/index.js` 零 import；`lib/client.js` 只有 `require('react')`）。
所以这四个 peer 是**声明性**的，标了 `optional: true`，不阻断安装。

## 明天要做的事（一条命令级别的简单）

1. 把投稿 YAML 放进 awesome-dsh-plugin 仓库：
   - 文件名：`data/plugins/SYXliuliuliu__dsh-apply-model-all.yml`
   - 内容：见 `D:\DSH\plugins\dsh-apply-model-all\submission\SYXliuliuliu__dsh-apply-model-all.yml`
2. 提 PR。**只加这一个文件**；README 是生成的，**不要手工改**。
3. CI 会依次查：条目数 ≤3 → `dsh.bundle` → **仓库年龄 ≥1 天** → awesome-lint。

其余收录条件都已满足（有真实代码、有 dsh.bundle、有 topic、描述只讲功能）。

## 可选（以后再说）

- **发 npm**：用户当前选择**不发**。收录与它无关，发了只是市场能显示下载量。
  若发，包的 `repository` 字段必须指回本仓库。
- **截图**：用户在仓库里放 `screenshots.json`（1-8 张、仓库相对路径），
  市场详情页就会展示。注意：CI 的 awesome-lint 会把截图列入检查项。
