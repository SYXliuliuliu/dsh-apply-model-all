# dsh-apply-model-all — 发布进度

**状态（2026-10-06）**：**PR 已提交，等审核** ——
https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6693

## 已完成的

| 步骤 | 状态 |
|---|---|
| 本地 git 仓库 + 3 个提交 | ✅ |
| GitHub 仓库 `SYXliuliuliu/dsh-apply-model-all`（public） | ✅ 2026-10-04T16:51:38Z |
| 推送 master | ✅ |
| `dsh-plugin` topic | ✅ |
| **PR 提交**（只改 1 个文件） | ✅ PR #6693，`MERGEABLE` |
| CI `check-submission` 本地预跑 | ✅ `all checked entries pass` |
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

## PR 已提交（2026-10-06）

- PR: https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6693
- 分支：`SYXliuliuliu:add-apply-model-all`（fork 里）
- 改动：**只有** `data/plugins/SYXliuliuliu__dsh-apply-model-all.yml`
- 状态：`OPEN` / `MERGEABLE` / CI `check-submission` pending

**送审前本地预跑了 CI 的同一个脚本**，确认它会过：

```powershell
# 在 upstream 克隆里（浅克隆即可）
git clone --depth 1 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin.git upstream
cd upstream
# check-submission 需要 js-yaml 与 token；本机已有 js-yaml，链接即可，不必安装
cmd /c mklink /J "node_modules\js-yaml" "D:\.dsh\profiles\desktop\node_modules\js-yaml"
$env:GITHUB_TOKEN = (gh auth token)
node scripts/check-submission.mjs --only-list only.txt --base <main 的 sha> --pr-created <iso>
# → checking 1 entry / ok <url> / all checked entries pass
```

### 踩到的两个坑（下次直接照做）

1. **`--base` 单独用会「什么都没检测到」**：`changedEntryFiles()` 返回的是**仓库相对路径**
   （`data/plugins/x.yml`），而 `entries[].file` 是**绝对路径**（`path.join(dir, f)`），
   两者永不相等 → `targets` 为空 → 打印 "no entry files added or changed"。
   **绕法：加 `--only-list <文件>`**（按 basename 匹配），别指望 `--base` 自己选中。
2. **不要用 `--dir` 配 `--base`**：`--dir` 只改「从哪读条目」，目标选择仍走 `--only-list`/`--base`
   分支；两者混用会让 diff 的相对路径对不上 `--dir` 读进来的条目，结果同样是空的。

### 关于 AI 提 PR

**在这个列表里是常态，没人介意。** 实锤：PR #6645 分支名 `flizzywine:codex/add-dsh-tavern-catalog`、
#6633 `loopx-agent:codex/loopx-beta6-catalog`、#6670 `chinahhy:codex/add-tether-ios` ——
`codex/` 前缀就是 AI agent 建的。贡献指南只查：manifest、仓库年龄、描述是否属实、分类是否贴切。

### 审核队列实况（别指望当天合并）

仓库共 6,534 个 PR、已合并 4,814（74%），但**当前积压 683 个待处理**，
最近 60 个 PR 已合并数为 **0**（都还在排）。所以提完要等，属正常。

## 可选（以后再说）

- **发 npm**：用户当前选择**不发**。收录与它无关，发了只是市场能显示下载量。
  若发，包的 `repository` 字段必须指回本仓库。
- **截图**：用户在仓库里放 `screenshots.json`（1-8 张、仓库相对路径），
  市场详情页就会展示。注意：CI 的 awesome-lint 会把截图列入检查项。
  有 347 个条目用了 `tarball:` 字段，但那是**源码装不了时才必需**；
  本插件已验证可从源码安装，故不需要。
