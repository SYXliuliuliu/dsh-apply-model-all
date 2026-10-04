# dsh-apply-model-all

[English](README.md) | 中文

一键把**当前会话正在用的模型**写进**所有会话**。

## 它长什么样

输入框那一行的控件区，官方「模型位」的**旁边**多一个小按钮：

```
[⇉ 应用到所有会话]  [ deepseek-v4.1-flash ▾ ]   ← 官方模型位在这里，没被动
```

点一下 → 弹出确认（显示将要写入的 `provider/model` 和思考强度）→ 确认后开始，
按钮旁实时显示 `已完成/总数`，跑完给出结果统计。

## 为什么是插件而不是改官方

DSH 的模型选择是**会话级**状态（每个会话各存一份 `modelSelection`）。官方的
「默认模型」（`dsh-agent-default-model`）只作用于**新建**会话，`/model` 弹窗只改
**当前**会话——所以「一次改所有会话」官方没有这个能力。

本插件**不修改任何官方插件、不改会话日志、不碰投影缓存**，只调用官方公开 API
`sessionController.selectModel()`（GUI 的 `/model` 弹窗调的就是它）逐个会话写入。
因此：

- 官方插件一行不改，本插件卸载后一切回到原样；
- 官方升级把接口改了，最坏结果是本插件报错，其它功能照常；
- 会话选择本身始终是官方语义，不产生任何私有格式。

## 架构

| 半边 | 文件 | 职责 |
|---|---|---|
| 宿主 | `lib/index.js` | 注册两条 HTTP 路由；用 `sessionController.list()` 列出全部会话、`selectModel()` 逐个写入（并发 8）。长任务跑在宿主，关掉页面不中断。 |
| 浏览器 | `lib/client.js` | 往 slot `conversation.input.right` 注一个按钮；读 `useProjection('modelSelection')` 拿当前会话的模型；发起点按后每秒轮询进度。 |

两条路由：

```
POST /apply-model-all/start    {provider, model, reasoningEffort?} → {runId}
GET  /apply-model-all/status                                      → {run: {...}}
```

### 先读后写（去重）

`selectModel` 会**解锁并恢复**每个目标会话，是本次操作里最贵的一步，而且它**没有**
「已经是了就别写」的短路。所以本插件先读后写：`list()` 的条目自带每个会话当前的
`modelSelection`，一致的会话直接跳过。同一时刻只允许一次运行（重复发起返回 409 并
带上正在跑的那次进度）。

### 去重只比 provider/model，不比思考强度（实测结论，重要）

`list()` 里每个会话的 `modelSelection` **只带 provider/model，强度一律为空**
（实测所有主会话都是 `effort=none`）——因为 `reasoningEffort` 属于**设置层**、
不是会话级的模型选择字段。

一开始按三项比对（含强度），结果是**每次都把所有会话重写一遍**：目标带
`effort=high`，会话存的是空，两者永不相等 → 去重完全失效，重复点击依然要等
约 50 秒。改成只比 provider/model 后，同样的点击 **0.4 秒**完成、零写入。

## 已知边界

- **子代理会话**（`origin: "subagent"` 或带 `parentSessionId`）跟随父会话路由，官方
  不允许单独设置。它们**整个不在本次操作范围内**：既不写入，也不进失败/跳过明细，
  只在计数里留一个 `subagentCount`。
- **正在被别的写句柄占用的会话**返回 `already owned by an active write handle`。
  **跨进程调用会撞上**（比如另一个 profile 的进程去写桌面端开着的会话）；**在桌面端
  自己点按钮不会**，因为锁的持有者就是同一个宿主。
- 按钮读的是**当前会话**的选择；当前会话没选模型时按钮置灰。
- 失败明细在 `/status` 里只回前 50 条，并按原因归并计数（`failedByReason`）。

## 安装

```sh
dsh plugin --profile <你的 profile> add dsh-apply-model-all
```

装完**必须重启**（bundle 的 patch 行不热加载；客户端 bundle 也需要重新扫描）。

本地开发时用 `link:` 而不是 `file:` —— `file:` 会拷一份快照，pnpm 之后一律回
`Already up to date`，改了源码不生效。`link:` 建 junction 指向源码目录，改完重启即生效。

## 实测数字

### 范围

| 结果 | 说明 |
|---|---|
| 可独立选择的会话 | 按钮真正作用的范围 |
| 子代理会话 | `origin: "subagent"` / 有 `parentSessionId`，整个不参与 |

子代理会话跟随父会话路由，官方**不允许**单独设置（报 `owned by subagent routing`），
所以本插件按设计排除它们；父会话改了，它们自然跟着变。

### 耗时

| 场景 | 耗时 | 行为 |
|---|---:|---|
| 目标模型**已一致** | **0.4 s** | 全部跳过，零写入 |
| 目标模型**需变更** | ~6.5 s | 真的逐会话写入 |

跨进程实测时，写入会全部报 `already owned by an active write handle` —— 因为那些
会话被另一个运行的实例持有写句柄。**在应用内点这个按钮不会**：锁的持有者就是同一个宿主。

## 许可

MIT
