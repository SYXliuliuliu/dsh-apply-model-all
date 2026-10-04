/**
 * dsh-apply-model-all —— 宿主半边。
 *
 * 唯一职责：把「某一个 provider/model/reasoningEffort」写进**所有会话**的会话级
 * 模型选择（`modelSelection`）。官方 API 就是 `ctx.sessionController.selectModel`
 * （GUI 的 /model 弹窗、输入框模型位调的是同一个），它成功返回即表示该会话的选择
 * 已生效，因此本插件**不改会话日志、不碰投影缓存、不侵入任何官方插件**。
 *
 * 为什么放在宿主而不是浏览器里跑循环：211 个会话逐个 selectModel 会依次解锁并
 * 恢复每个冷会话（每个都可能要读一次会话体），是分钟级的长任务。放在宿主跑的
 * 好处是关掉页面也不中断，浏览器那半只负责发起与轮询进度。
 *
 * 两条路由（都注册在插件 fiber 上，卸载即回收）：
 *   POST /apply-model-all/start   body: {provider, model, reasoningEffort?} → {runId}
 *   GET  /apply-model-all/status                                     → 进度快照
 *
 * 与官方模型的兼容性：只用 `sessionController.list` / `selectModel` 两个公开方法，
 * 且都用 try/catch 兜住 —— 官方改了接口，最坏结果是本插件报错、其它一切照常。
 */

/** webServer 是硬依赖：没有 HTTP 服务器就没法给浏览器半边暴露入口。 */
export const inject = ['webServer', 'sessionController'];

const BASE = '/apply-model-all';

/** 同时处理的会话数。会话恢复主要是 I/O 等待，所以提高并发收益明显；
 *  但每个会话会各自解锁并持有写句柄，太高会把会话锁抢得太凶，8 是折中。 */
const CONCURRENCY = 8;

/** 已经启动但还没结束的那次运行；同一时刻只允许一次。 */
let activeRun = null;

/** 把一次运行的状态收成可 JSON 化的快照。 */
function snapshot(run) {
  return {
    runId: run.runId,
    running: run.running,
    model: run.model,
    reasoningEffort: run.reasoningEffort ?? null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt ?? null,
    total: run.total,
    done: run.done,
    ok: run.ok,
    already: run.already ?? 0,
    subagentCount: run.subagentCount ?? 0,
    failedCount: run.failed.length,
    /** 失败明细只回前 50 条，够定位问题又不至于把响应撑爆。 */
    failed: run.failed.slice(0, 50),
    /** 同类失败合并计数：同一条原因刷 150 行原文糊屏没有信息量。 */
    failedByReason: summarize(run.failed),
  };
}

/**
 * 把一串 `{reason}` 归并成 `[{reason, count}]`，按条数降序。
 *
 * @param rows - 明细数组。
 * @returns 归并后的计数。
 */
function summarize(rows) {
  const counts = new Map();
  for (const row of rows) {
    const key = String(row.reason ?? '');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count);
}

/** 子代理会话的失败特征：官方拒绝为它单独选模型，它跟随父会话路由。 */
const SUBAGENT_OWNED = /owned by subagent routing/i;

/** 会话正被写句柄占用（通常就是桌面端自己开着这个会话）。 */
const WRITER_HELD = /already owned by an active write handle/i;

/**
 * 把官方原文的失败原因翻成人话，方便界面上直接显示。
 *
 * @param reason - 官方错误原文。
 * @returns 归一化后的说明。
 */
function explain(reason) {
  if (SUBAGENT_OWNED.test(reason)) return '子代理会话：跟随父会话路由，无需也无法单独设置';
  if (WRITER_HELD.test(reason)) return '会话正被占用（桌面端开着这个会话），关掉它或重启后再试';
  return reason;
}

/**
 * 把一次模型选择写进一个会话。
 *
 * @param sessionController - 宿主会话控制器。
 * @param sessionId - 目标会话。
 * @param selection - `{provider, model, reasoningEffort?}`。
 * @returns `{ok: true}` 或 `{ok: false, reason}`，绝不抛出。
 */
async function applyToOne(sessionController, sessionId, selection) {
  try {
    const result = await sessionController.selectModel({ sessionId, ...selection });
    // Remote 层可能以 `{ok: false, error}` 形态返回而不抛出。
    if (result && result.ok === false) {
      const error = result.error ?? {};
      return { ok: false, reason: `${error.code ?? 'error'}: ${error.message ?? ''}`.trim() };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: String(err && err.message ? err.message : err) };
  }
}

/**
 * 取出一个会话当前生效的模型选择。
 *
 * `list()` 的条目自带投影（`projections.values.modelSelection`），形状是
 * `{lastUsed, next}`；冷会话走缓存投影、活会话走实时基线，两者字段一致。
 * 取不到（会话太新/投影缺列）就返回 `undefined`，表示「不知道」——调用方
 * 必须**照常写入**，不能把「不知道」当成「已经一致」。
 *
 * @param item - list() 的条目。
 * @returns `{provider, model, reasoningEffort?}` 或 undefined。
 */
function currentSelectionOf(item) {
  const value = item?.projections?.values?.modelSelection;
  if (value === null || typeof value !== 'object') return undefined;
  const pick = value.next ?? value.lastUsed;
  if (pick === null || typeof pick !== 'object') return undefined;
  if (typeof pick.provider !== 'string' || typeof pick.model !== 'string') return undefined;
  return pick;
}

/**
 * 判断会话当前选择是否已经等于目标选择（用于去重，省掉昂贵的 selectModel）。
 *
 * **只比 provider/model，不比思考强度**。原因是实测出来的：`list()` 里每个会话的
 * `modelSelection` 只带 provider/model，**强度一律是空的**（本机 59 个主会话全是
 * `effort=none`）——因为 reasoningEffort 属于**设置层**、不是会话级的模型选择字段
 * （见 AGENTS.md）。既然会话里根本存不住强度，拿它比对就永远不相等，结果是
 * 每次都把 59 个会话重写一遍（实测 50 秒变 6.7 秒的那次就是这么来的）。
 * 所以「同一个模型的会话」一律算命中，重复点击因此是秒回。
 *
 * @param current - 会话当前选择，或 undefined（未知）。
 * @param target - 目标选择。
 * @returns 已经一致则为 true。
 */
function alreadyMatches(current, target) {
  if (current === undefined) return false;
  return current.provider === target.provider && current.model === target.model;
}

/**
 * 跑完整个批量应用。并发 CONCURRENCY 个 worker 从同一个游标取会话。
 *
 * 两处关键设计：
 *   1. **先读后写**：list() 的条目已经带着每个会话当前的 modelSelection，所以
 *      一致的会话直接跳过 —— selectModel 会解锁并恢复每个冷会话，是本次操作里
 *      最贵的一步，而它没有任何「已经是了就别写」的短路。重复点按钮因此在
 *      「已经统一」之后应当是秒回，而不是再等一分钟。
 *   2. **子代理会话整个不参与**：它们跟随父会话路由，既不是失败也不是跳过，
 *      压根不是这个按钮的作用对象，所以既不写入也不进结果明细。
 *
 * @param sessionController - 宿主会话控制器。
 * @param selection - 目标模型选择。
 * @param run - 本次运行的进度对象（原地更新）。
 */
async function runBatch(sessionController, selection, run) {
  const listed = await sessionController.list({});
  const all = Array.isArray(listed?.items) ? listed.items : [];

  // 子代理会话（`origin: "subagent"`，或带血缘字段 `parentSessionId`）**不能**
  // 单独选模型：官方以 `owned by subagent routing` 拒绝。它们跟随父会话的路由，
  // 父会话改了它们自然就跟着变 —— 因此整个排除在本次操作之外。
  const items = [];
  for (const item of all) {
    const isSubagent = item?.origin === 'subagent'
      || (item?.parentSessionId !== undefined && item?.parentSessionId !== null);
    if (isSubagent) {
      run.subagentCount += 1;
      continue;
    }
    items.push(item);
  }
  run.total = items.length;

  // 先按「已经是目标模型」筛一遍，剩下的才需要真的写。
  const pending = [];
  for (const item of items) {
    if (alreadyMatches(currentSelectionOf(item), selection)) {
      run.already += 1;
      run.done += 1;
    } else {
      pending.push(item);
    }
  }

  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor++;
      if (index >= pending.length) return;
      const sessionId = pending[index]?.sessionId;
      if (typeof sessionId !== 'string' || sessionId === '') {
        run.failed.push({ sessionId: String(sessionId), reason: '会话没有 id' });
        run.done += 1;
        continue;
      }
      const outcome = await applyToOne(sessionController, sessionId, selection);
      if (outcome.ok) run.ok += 1;
      else if (SUBAGENT_OWNED.test(outcome.reason)) {
        // 兜底：list 没标出来但官方这么拒绝，说明它也是子代理会话 —— 不计失败。
        run.subagentCount += 1;
      } else run.failed.push({ sessionId, reason: explain(outcome.reason) });
      run.done += 1;
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
}

/** 读请求体（有上限，防呆）。 */
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * 宿主半边：注册两条路由。
 *
 * @param ctx - 插件上下文（已注入 webServer 与 sessionController）。
 */
export function apply(ctx) {
  const webServer = ctx.webServer;
  if (!webServer || typeof webServer.register !== 'function') {
    ctx.logger?.warn?.('[apply-model-all] 没有 webServer 服务，插件不启用');
    return;
  }

  const jsonOut = (res, status, payload) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(payload));
  };

  // 路由注册的 disposer 收在这里，apply 结束时一起交回 Loader。
  // （用「return 一个 disposer」这种最基础的 Cordis 形态，不依赖 ctx.effect
  //  在宿主上下文里一定存在 —— 本部署里 wallpaper-engine 用的就是这个形态。）
  const disposers = [];

  // 1. 发起一次批量应用。
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/start`,
    handler: async (req, res) => {
      if (req.method !== 'POST') { jsonOut(res, 405, { error: 'method not allowed' }); return; }
      let body;
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch (err) {
        jsonOut(res, 400, { error: `请求体不是合法 JSON：${String(err?.message ?? err)}` });
        return;
      }
      const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
      const model = typeof body.model === 'string' ? body.model.trim() : '';
      if (provider === '' || model === '') {
        jsonOut(res, 400, { error: '必须提供 provider 与 model' });
        return;
      }
      const reasoningEffort = typeof body.reasoningEffort === 'string' && body.reasoningEffort !== ''
        ? body.reasoningEffort
        : undefined;

      if (activeRun?.running) {
        jsonOut(res, 409, { error: '上一次批量应用还在跑', run: snapshot(activeRun) });
        return;
      }

      const run = {
        runId: `run-${Date.now().toString(36)}`,
        running: true,
        model: `${provider}/${model}`,
        reasoningEffort,
        startedAt: Date.now(),
        finishedAt: null,
        total: 0,
        done: 0,
        ok: 0,
        already: 0,
        subagentCount: 0,
        failed: [],
      };
      activeRun = run;

      // 立刻回 runId，循环在后台跑（浏览器半边轮询 /status 拿进度）。
      runBatch(ctx.sessionController, { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) }, run)
        .catch((err) => {
          run.failed.push({ sessionId: '-', reason: `批量任务本身失败：${String(err?.message ?? err)}` });
        })
        .finally(() => {
          run.running = false;
          run.finishedAt = Date.now();
        });

      jsonOut(res, 200, { runId: run.runId, started: true, model: run.model });
    },
  }));

  // 2. 查询进度（没有运行过就回 null）。
  disposers.push(webServer.register({
    kind: 'exact',
    path: `${BASE}/status`,
    handler: async (req, res) => {
      if (req.method !== 'GET') { jsonOut(res, 405, { error: 'method not allowed' }); return; }
      jsonOut(res, 200, activeRun === null ? { run: null } : { run: snapshot(activeRun) });
    },
  }));

  // Cordis 约定：apply 返回的清理函数在插件卸载时调用一次。
  return () => {
    for (const dispose of disposers) {
      try { dispose(); } catch { /* 卸载路径吞掉即可 */ }
    }
  };
}
