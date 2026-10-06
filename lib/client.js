/**
 * dsh-apply-model-all —— 浏览器半边。
 *
 * 在输入框那一行、**官方模型位左边**加一个小按钮（slot `conversation.input.right`
 * 是官方声明的 list slot，渲染次序正好在 `conversation.input.model` 之前）。
 * 点开 → 把「当前会话正在用的模型」推给所有会话，并显示进度。
 *
 * 三条纪律（照官方 cordis-plugin-development 的要求）：
 *   1. 不 import 任何 Harness 客户端包（包括 ui-primitives），控件自己写、
 *      配色只用 `--dsw-alias-*` 主题 token，深浅色自动跟随。
 *   2. 不碰其它插件、不抢官方模型位的 slot、不写组件以外的 DOM。
 *   3. 数据只通过 slot 注入的 selector hook 读（useProjection），不自己扫会话。
 *
 * 真正的批量逻辑在宿主半边（lib/index.js），这里只发起 + 轮询进度，因此关掉
 * 页面不会中断已经在跑的批量任务。
 */
window.__ModuleLoader__.load({
  id: 'dsh-apply-model-all',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const START_URL = '/apply-model-all/start';
    const STATUS_URL = '/apply-model-all/status';

    /**
     * 组件局部样式：随组件卸载一起消失，不污染全局。
     *
     * ⚠️ 两个踩过的坑，改样式前务必读：
     *
     * 1. **主按钮必须用官方「成对」token**（`button-primary-fill` +
     *    `label-primary-foreground`）。这对 token 会**随主题一起翻转**：
     *    暗色主题 = 近白底 + 近黑字，亮色主题 = 近黑底 + 近白字。
     *    曾经写成 `background: brand-primary` + 硬编码 `color:#fff`，
     *    结果在暗色主题下 fill 解析成近白 → **白底白字，按钮彻底看不见**。
     *    永远不要硬编码按钮文字色。
     * 2. **不要把基础样式挂在 `.dsh-ama-actions button` 上**：那个选择器特异性
     *    (0,1,1) 高于单类 (0,1,0)，会逼着后面用 `!important` 硬压（而压错的正是
     *    颜色那行）。改成基础类 + 修饰类**两个类挂同一元素**、修饰类排在后面，
     *    靠源序覆盖即可，无需 `!important`。
     */
    const CSS = `
.dsh-ama-wrap { position: relative; display: inline-flex; align-items: center; }
.dsh-ama-btn {
  display: inline-flex; align-items: center; gap: 4px;
  height: 24px; padding: 0 8px; border-radius: var(--dsw-radius-sm, 6px);
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35));
  background: transparent; color: var(--dsw-alias-label-secondary, inherit);
  font: inherit; font-size: 12px; line-height: 1; cursor: pointer; white-space: nowrap;
}
.dsh-ama-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); }
.dsh-ama-btn:disabled { opacity: .4; cursor: not-allowed; }
.dsh-ama-pop {
  position: absolute; bottom: calc(100% + 8px); right: 0; z-index: 1100;
  width: 290px; padding: 12px; border-radius: var(--dsw-radius-md, 10px);
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35));
  background: var(--dsw-alias-bg-layer-1, #fff);
  box-shadow: 0 6px 24px rgba(0,0,0,.28);
  color: var(--dsw-alias-label-primary, inherit); font-size: 12px; line-height: 1.6;
}
.dsh-ama-title { font-weight: 600; margin-bottom: 6px; }
.dsh-ama-model { color: var(--dsw-alias-label-caption, inherit); word-break: break-all; }
.dsh-ama-actions { display: flex; gap: 8px; margin-top: 10px; }
.dsh-ama-action {
  flex: 1; height: 28px; border-radius: var(--dsw-radius-sm, 6px);
  cursor: pointer; font: inherit; font-size: 12px; line-height: 18px; padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l3, rgba(128,128,128,.35));
  background: transparent; color: var(--dsw-alias-label-primary, inherit);
}
.dsh-ama-action:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); }
.dsh-ama-action:disabled { cursor: not-allowed; opacity: .4; }
.dsh-ama-action-primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill, #4d6bfe);
  color: var(--dsw-alias-label-primary-foreground, #fff);
}
.dsh-ama-action-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, #3b56d4); }
.dsh-ama-err { color: var(--dsw-alias-label-error, #d33); word-break: break-all; }
`;

    /** GET/POST JSON；网络错与业务错都收敛成 `{ok, data}`，不抛出。 */
    async function call(url, init) {
      try {
        const res = await fetch(url, init);
        let data = null;
        try { data = await res.json(); } catch { /* 非 JSON 就留 null */ }
        return { ok: res.ok, data };
      } catch (err) {
        return { ok: false, data: { error: String(err?.message ?? err) } };
      }
    }

    /**
     * 从会话的 modelSelection 投影里取出「当前在用」的选择。
     * 客户端投影与宿主缓存字段名略有出入（next / pending / lastUsed），
     * 三个都认，取不到就返回 null（按钮置灰）。
     */
    function currentSelection(projection) {
      if (projection === null || typeof projection !== 'object') return null;
      const pick = projection.next ?? projection.pending ?? projection.lastUsed;
      if (pick === null || typeof pick !== 'object') return null;
      if (typeof pick.provider !== 'string' || typeof pick.model !== 'string') return null;
      return pick;
    }

    /**
     * 「一键应用到所有会话」按钮。
     *
     * @param props - slot 注入的标准 props（含 sessionId / useProjection）。
     */
    function ApplyModelAll(props) {
      const projection = props.useProjection('modelSelection');
      const selection = currentSelection(projection);

      const [open, setOpen] = React.useState(false);
      const [phase, setPhase] = React.useState('idle'); // idle | running | done | error
      const [status, setStatus] = React.useState(null);
      const [error, setError] = React.useState(null);
      const timer = React.useRef(null);

      const stopPolling = React.useCallback(() => {
        if (timer.current !== null) { clearInterval(timer.current); timer.current = null; }
      }, []);

      // 组件卸载时停掉轮询计时器（资源归属自己的 effect）。
      React.useEffect(() => stopPolling, [stopPolling]);

      const poll = React.useCallback(async () => {
        const { data } = await call(STATUS_URL);
        const run = data?.run ?? null;
        setStatus(run);
        if (run === null || run.running === false) {
          stopPolling();
          setPhase(run === null ? 'idle' : 'done');
        }
      }, [stopPolling]);

      const start = React.useCallback(async () => {
        if (selection === null) return;
        setError(null);
        setPhase('running');
        setStatus(null);
        const body = { provider: selection.provider, model: selection.model };
        if (typeof selection.reasoningEffort === 'string') body.reasoningEffort = selection.reasoningEffort;
        const { ok, data } = await call(START_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!ok) {
          setPhase('error');
          setError(String(data?.error ?? '发起失败'));
          // 409 说明上一次还在跑：把它的进度拉出来显示，而不是干等。
          if (data?.run) { setStatus(data.run); setPhase('running'); }
        }
        stopPolling();
        timer.current = setInterval(poll, 1000);
        poll();
      }, [selection, poll, stopPolling]);

      const label = selection === null
        ? '应用到所有会话'
        : `应用到所有会话`;

      const btn = h('button', {
        type: 'button',
        className: 'dsh-ama-btn',
        disabled: selection === null,
        title: selection === null
          ? '当前会话还没有选模型'
          : `把 ${selection.provider}/${selection.model} 应用到所有会话`,
        onClick: () => { setOpen((v) => !v); if (phase === 'done' || phase === 'error') { setPhase('idle'); setError(null); } },
      }, h('span', null, '⇉'), h('span', null, label));

      if (!open) {
        return h('div', { className: 'dsh-ama-wrap' }, h('style', null, CSS), btn);
      }

      let body;
      if (phase === 'running') {
        const done = status?.done ?? 0;
        const total = status?.total ?? 0;
        body = [
          h('div', { className: 'dsh-ama-title', key: 't' }, '正在应用到所有会话…'),
          h('div', { className: 'dsh-ama-model', key: 'm' }, `${status?.model ?? ''}　${done}/${total || '…'}`),
        ];
      } else if (phase === 'done') {
        const ok = status?.ok ?? 0;
        const already = status?.already ?? 0;
        const total = status?.total ?? 0;
        const failedCount = status?.failedCount ?? 0;
        // 只有「真正写入」和「失败」值得说。已经一致的不算成果，子代理会话根本
        // 不是这个按钮的作用对象，两者都不该占一行结果。
        const lines = [];
        if (ok > 0) lines.push(`已写入 ${ok} 个`);
        if (already > 0) lines.push(`${already} 个本来就是该模型，未改动`);
        if (lines.length === 0) lines.push('没有需要改动的会话');
        body = [
          h('div', { className: 'dsh-ama-title', key: 't' },
            failedCount === 0 ? (ok === 0 ? '无需改动' : '完成') : '完成（有失败）'),
          h('div', { className: 'dsh-ama-model', key: 'm' }, `${status?.model ?? ''}`),
          h('div', { className: 'dsh-ama-model', key: 's' },
            `${lines.join('；')}（可设置的会话共 ${total} 个）`),
          // 失败按原因归并展示：同一条原因刷 150 行原文没有信息量。
          ...(status?.failedByReason ?? []).slice(0, 3).map((row, index) =>
            h('div', { className: 'dsh-ama-err', key: `fr${index}` }, `${row.count} 个失败：${row.reason}`)),
          h('div', { className: 'dsh-ama-actions', key: 'a' },
            h('button', { type: 'button', className: 'dsh-ama-action', onClick: () => setOpen(false) }, '关闭')),
        ];
      } else {
        body = [
          h('div', { className: 'dsh-ama-title', key: 't' }, '一键应用到所有会话'),
          h('div', { className: 'dsh-ama-model', key: 'm' },
            selection === null ? '当前会话没有模型' : `将写入：${selection.provider}/${selection.model}` +
              (selection.reasoningEffort ? `（${selection.reasoningEffort}）` : '')),
          h('div', { className: 'dsh-ama-model', key: 'n' },
            '已经是该模型的会话会自动跳过；子代理会话跟随父会话，不在范围内。'),
          error !== null ? h('div', { className: 'dsh-ama-err', key: 'e' }, error) : null,
          h('div', { className: 'dsh-ama-actions', key: 'a' },
            h('button', { type: 'button', className: 'dsh-ama-action', onClick: () => setOpen(false) }, '取消'),
            h('button', {
              type: 'button', className: 'dsh-ama-action dsh-ama-action-primary',
              disabled: selection === null,
              onClick: start,
            }, '确认应用')),
        ];
      }

      return h('div', { className: 'dsh-ama-wrap' },
        h('style', null, CSS),
        btn,
        h('div', { className: 'dsh-ama-pop', role: 'dialog' }, ...body));
    }

    return {
      inject: ['slots'],
      /**
       * 往输入框的 `conversation.input.right`（官方声明的 list slot，就在模型位
       * 左边）注一个自己的格子。`id` 用自己的，绝不占用官方 id。
       */
      apply(ctx) {
        ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
          name: 'conversation.input.right',
          id: 'apply-model-all',
          order: 10,
        }, ApplyModelAll));
      },
    };
  },
});
