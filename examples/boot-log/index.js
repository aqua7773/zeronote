/**
 * 启动日志示例插件（rev173.352 · 0.2.0）—— 把「刚进软件卡一下」的现场读出来。
 *
 * ## 为什么做成插件
 *
 * rev173.351 把启动打点放进了 `window.__znBootMarks()`（`src/lib/boot-marks.ts`），
 * 但 **release 包不回传 logcat** —— 用户手机上是正式包，只能靠页面内自己读。
 *
 * ## 0.2.0：三路探针（手机 release 包实测出一次 6.96 秒长任务后加的）
 *
 * 单有「哪一刻卡了」不够，要「卡的时候在干什么」：
 *  1. **IPC 探针** —— 包装 `__TAURI_INTERNALS__.invoke`，记启动 20 秒内每条命令的耗时。
 *     读文件 / 列目录 / 索引 / 备份 / 同步都会在这里留痕，按总耗时排序就能看出是谁在压主线程。
 *  2. **长任务快照** —— 每个 ≥50ms 任务结束时抓 DOM 规模（图片数 / 已加载数 / 节点数），
 *     用来区分「卡在图片解码」还是「卡在纯 JS 循环」。
 *  3. **资源加载 Top** —— `performance.getEntriesByType('resource')` 启动期最慢的请求。
 *
 * 探针都在 `apply()` 里装、`dispose` 时还原；记录只留前 20 秒，避免长时间运行后无限增长。
 *
 * ## 读法
 *
 * 面板「启动日志」：阶段表 · 长任务表 · IPC Top · 资源 Top · 等价 `[zn-boot]` 文本
 * · 「复制报告」把整份数据变成可读文本，直接转发
 */

const PANEL_ID = 'boot-log.panel'
/** 只记启动期（与内核 longtask 窗口一致） */
const WINDOW_MS = 20000
/** IPC 记录上限 —— 启动期命令调用可能上千条，超出后只累计不再存明细 */
const MAX_IPC = 2000

/* ───────────────────────── 探针（模块级，一个页面一份） ───────────────────────── */

const probe = {
  /** 明细：{ cmd, start, dur, ok } */
  ipc: [],
  /** 长任务快照：{ start, dur, imgs, loaded, nodes } */
  snaps: [],
  installed: false,
  /** Tauri 把 invoke 定义成不可写 —— 探针装不上时置 true，面板给提示 */
  ipcUnavailable: false,
  savedInvoke: null,
  observer: null,
}

function nowMs() {
  try {
    return performance.now()
  } catch {
    return 0
  }
}

/** 包装 Tauri IPC —— 记录命令耗时，不改返回值/异常语义 */
export function installProbe(win) {
  const w = win ?? (typeof window === 'undefined' ? undefined : window)
  if (!w || probe.installed) return
  const internals = w.__TAURI_INTERNALS__
  if (internals && typeof internals.invoke === 'function') {
    /**
     * ⚠️ 0.2.0 的教训（真机实测）：Tauri 2 把 `__TAURI_INTERNALS__.invoke` 定义成
     * `writable: false, configurable: false` —— 直接赋值会抛
     * `TypeError: Cannot assign to read only property 'invoke'`，并让**整个插件加载失败**。
     * 所以这里必须 try 住；拿不到就标记 `ipcUnavailable`，其它探针照常工作。
     */
    try {
      const orig = internals.invoke
      const wrapped = function (cmd, args, options) {
        const t0 = nowMs()
        const p = orig.call(this, cmd, args, options)
        if (p && typeof p.then === 'function' && probe.ipc.length < MAX_IPC) {
          p.then(
            () => {
              const dur = Math.round(nowMs() - t0)
              if (t0 <= WINDOW_MS) probe.ipc.push({ cmd: String(cmd), start: Math.round(t0), dur, ok: true })
            },
            () => {
              const dur = Math.round(nowMs() - t0)
              if (t0 <= WINDOW_MS) probe.ipc.push({ cmd: String(cmd), start: Math.round(t0), dur, ok: false })
            },
          )
        }
        return p
      }
      Object.defineProperty(internals, 'invoke', { value: wrapped, configurable: true, writable: true })
      probe.savedInvoke = orig
      probe.installed = true
    } catch {
      probe.ipcUnavailable = true
    }
  }

  // 长任务快照：内核也会记 longtask，但只有这里能顺手抓 DOM 规模
  try {
    if (typeof w.PerformanceObserver !== 'undefined') {
      probe.observer = new w.PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.startTime > WINDOW_MS) continue
          let imgs = 0
          let loaded = 0
          let nodes = 0
          try {
            const list2 = w.document?.images
            imgs = list2 ? list2.length : 0
            if (list2) for (const img of list2) if (img.complete && img.naturalWidth > 0) loaded++
            nodes = w.document?.getElementsByTagName?.('*')?.length ?? 0
          } catch {
            /* DOM 读不到就记 0 */
          }
          probe.snaps.push({
            start: Math.round(e.startTime),
            dur: Math.round(e.duration),
            imgs,
            loaded,
            nodes,
          })
        }
      })
      probe.observer.observe({ entryTypes: ['longtask'] })
    }
  } catch {
    /* 老 WebView 不支持 longtask —— 其它数据仍可用 */
  }
}

/** 还原 IPC 包装、停掉 observer（卸载插件 / 面板 dispose 时调） */
export function uninstallProbe(win) {
  const w = win ?? (typeof window === 'undefined' ? undefined : window)
  if (!probe.installed) return
  try {
    if (w && probe.savedInvoke) w.__TAURI_INTERNALS__.invoke = probe.savedInvoke
  } catch {
    /* 无所谓 */
  }
  try {
    probe.observer?.disconnect()
  } catch {
    /* 无所谓 */
  }
  probe.observer = null
  probe.savedInvoke = null
  probe.installed = false
}

export function probeSnapshot() {
  return {
    ipc: [...probe.ipc],
    snaps: [...probe.snaps],
    ipcUnavailable: probe.ipcUnavailable,
  }
}

/* ───────────────────────── 纯函数 ───────────────────────── */

/** 读一次打点。`win` 参数只为测试注入 —— 运行时不传，用全局 window。 */
export function readBoot(win) {
  const w = win ?? (typeof window === 'undefined' ? undefined : window)
  try {
    const fn = w?.__znBootMarks
    if (typeof fn !== 'function') return null
    const data = fn()
    if (!data || !Array.isArray(data.marks)) return null
    return data
  } catch {
    return null
  }
}

/** 阶段表：间隔 = 与上一个打点的差（0 表示同一时刻） */
export function stageRows(data) {
  let prev = 0
  return data.marks.map((m) => {
    const gap = m.at - prev
    prev = m.at
    return { stage: m.name, at: m.at, gap }
  })
}

/** 长任务按耗时降序 —— 最慢的那条就是用户感知到的「卡一下」 */
export function longTaskRows(data) {
  return [...(data.longTasks || [])].sort((a, b) => b.dur - a.dur)
}

/**
 * IPC 聚合：按命令名合并成 `{ cmd, count, total, max, firstAt }`，按总耗时降序。
 * 「总耗时」= 同一命令所有调用的时长和 —— 主线程被压住时这里会有一列变大。
 */
export function aggregateIpc(entries, limit = 10) {
  const map = new Map()
  for (const e of entries || []) {
    const cur = map.get(e.cmd) ?? { cmd: e.cmd, count: 0, total: 0, max: 0, firstAt: e.start }
    cur.count++
    cur.total += e.dur
    cur.max = Math.max(cur.max, e.dur)
    cur.firstAt = Math.min(cur.firstAt, e.start)
    map.set(e.cmd, cur)
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, limit)
}

/** 启动期资源条目 → 按耗时降序的短表（长 URL 截短，只留能认出来的尾部） */
export function resourceRows(entries, limit = 10) {
  const rows = []
  for (const e of entries || []) {
    if (e.startTime > WINDOW_MS) continue
    if (!e.duration || e.duration < 1) continue
    const name = String(e.name)
    const short = name.length > 90 ? '…' + name.slice(-90) : name
    rows.push({ name: short, start: Math.round(e.startTime), dur: Math.round(e.duration) })
  }
  return rows.sort((a, b) => b.dur - a.dur).slice(0, limit)
}

/** 复原 logcat 里那条同源日志（含 IPC / 长任务摘要），方便复制转发 */
export function logText(data) {
  const marks = (data.marks || []).map((m) => `${m.name}@${m.at}`).join(' ')
  const tasks = (data.longTasks || []).map((t) => `longtask@${t.start}+${t.dur}ms`).join(' ')
  const ipc = aggregateIpc(data.ipc, 3)
    .map((r) => `${r.cmd}×${r.count}@${r.total}ms`)
    .join(' ')
  return `[zn-boot] ${marks}${tasks ? ` | ${tasks}` : ''}${ipc ? ` | ipc: ${ipc}` : ''}`
}

/** 运行期快照（IPC + 长任务 DOM 规模）—— 与内核打点合并成面板数据 */
export function collect(getResourceEntries) {
  const base = readBoot() ?? { at: 0, marks: [], longTasks: [] }
  const snap = probeSnapshot()
  let resources = []
  try {
    resources = getResourceEntries?.() ?? []
  } catch {
    resources = []
  }
  return { ...base, ...snap, resources }
}

/* ───────────────────────── 面板 ───────────────────────── */

function ipcRows(data) {
  return aggregateIpc(data.ipc, 10).map((r) => ({
    cmd: r.cmd,
    count: r.count,
    total: r.total,
    max: r.max,
    firstAt: r.firstAt,
  }))
}

function snapshotRows(data) {
  // 与内核 longtask 对齐：按开始时间匹配，补上 DOM 规模
  const snaps = data.snaps || []
  return snaps
    .slice()
    .sort((a, b) => b.dur - a.dur)
    .slice(0, 10)
    .map((s) => ({
      start: s.start,
      dur: { type: 'text', value: String(s.dur), tone: s.dur >= 100 ? 'danger' : 'default' },
      dom: `图 ${s.loaded}/${s.imgs} · 节点 ${s.nodes}`,
    }))
}

/** 面板内容（纯函数，render 与测试共用） */
export function panelNode(data) {
  if (!data) {
    return {
      type: 'stack',
      gap: 'md',
      children: [
        { type: 'text', value: '这个版本没有启动打点', variant: 'title' },
        {
          type: 'text',
          value: '启动打点从 0.9.24（rev173.351）起才有。确认应用已更新到该版本后再打开本面板。',
          variant: 'caption',
          tone: 'muted',
        },
      ],
    }
  }
  const stages = stageRows(data)
  const tasks = longTaskRows(data)
  const longest = tasks[0]
  const ipc = ipcRows(data)
  const snaps = snapshotRows(data)
  const resources = resourceRows(data.resources, 10)
  return {
    type: 'stack',
    gap: 'md',
    children: [
      { type: 'text', value: '本次启动', variant: 'title' },
      {
        type: 'text',
        value: `读于 ${data.at}ms · ${stages.length} 个阶段 · ${tasks.length} 个长任务 · ${ipc.reduce((n, r) => n + r.count, 0)} 次 IPC`,
        variant: 'caption',
        tone: 'muted',
      },
      {
        type: 'table',
        columns: [
          { key: 'stage', label: '阶段' },
          { key: 'at', label: '时刻(ms)', width: '28%', align: 'right' },
          { key: 'gap', label: '间隔(ms)', width: '28%', align: 'right' },
        ],
        rows: stages,
        empty: '没有打点',
      },
      { type: 'text', value: '主线程长任务（>50ms）', variant: 'title' },
      {
        type: 'text',
        value: longest
          ? `最长的 ${longest.dur}ms 出现在 ${longest.start}ms 处`
          : '本次启动没有 >50ms 的长任务',
        variant: 'caption',
        tone: longest ? 'warn' : 'muted',
      },
      {
        type: 'table',
        columns: [
          { key: 'start', label: '开始(ms)', width: '34%', align: 'right' },
          { key: 'dur', label: '持续(ms)', width: '30%', align: 'right' },
        ],
        rows: tasks.map((t) => ({
          start: t.start,
          dur: {
            type: 'text',
            value: String(t.dur),
            tone: t.dur >= 100 ? 'danger' : 'default',
          },
        })),
        empty: '—',
      },
      { type: 'text', value: '长任务结束时的页面规模', variant: 'title' },
      {
        type: 'table',
        columns: [
          { key: 'start', label: '开始(ms)', width: '30%', align: 'right' },
          { key: 'dur', label: '持续(ms)', width: '26%', align: 'right' },
          { key: 'dom', label: 'DOM' },
        ],
        rows: snaps,
        empty: '探针没抓到（插件加载前的任务不在此列）',
      },
      { type: 'text', value: 'IPC 调用 Top（按总耗时）', variant: 'title' },
      {
        type: 'table',
        columns: [
          { key: 'cmd', label: '命令' },
          { key: 'count', label: '次数', width: '16%', align: 'right' },
          { key: 'total', label: '总耗时(ms)', width: '24%', align: 'right' },
          { key: 'max', label: '最长(ms)', width: '22%', align: 'right' },
        ],
        rows: ipc.map((r) => ({
          cmd: r.cmd,
          count: r.count,
          total: r.total,
          max: r.max,
        })),
        empty: data.ipcUnavailable
          ? '正式包里 Tauri IPC 只读，探针装不上（看上面 DOM 快照与资源表）'
          : '没有记录到（可能不是 Tauri 环境）',
      },
      { type: 'text', value: '资源加载 Top（按耗时）', variant: 'title' },
      {
        type: 'table',
        columns: [
          { key: 'start', label: '开始(ms)', width: '22%', align: 'right' },
          { key: 'dur', label: '耗时(ms)', width: '22%', align: 'right' },
          { key: 'name', label: '资源' },
        ],
        rows: resources,
        empty: '启动期没有慢资源',
      },
      { type: 'divider' },
      {
        type: 'row',
        gap: 'sm',
        wrap: true,
        children: [
          { type: 'button', label: '刷新', onClick: 'boot-log.refresh' },
          { type: 'button', label: '复制报告', onClick: 'boot-log.copy', variant: 'ghost' },
        ],
      },
      { type: 'text', value: '与 logcat 里那条同源：', variant: 'caption', tone: 'muted' },
      { type: 'code', value: logText(data) },
    ],
  }
}

/* ───────────────────────── 插件主体 ───────────────────────── */

export default {
  apply(ctx) {
    const { command, view, host, subscriptions } = ctx

    installProbe()

    /** 完整报告：面板三张表 + 明细，纯文本，便于贴回来 */
    function reportText() {
      const data = collect(() => performance.getEntriesByType('resource'))
      const lines = []
      lines.push('=== ZeroNote 启动日志 ===')
      lines.push(logText(data))
      lines.push('')
      lines.push('[阶段]')
      for (const r of stageRows(data)) lines.push(`  ${r.stage} @${r.at}ms (+${r.gap}ms)`)
      lines.push('[长任务]')
      for (const t of longTaskRows(data)) lines.push(`  @${t.start} +${t.dur}ms`)
      lines.push('[长任务时 DOM]')
      for (const s of data.snaps || []) lines.push(`  @${s.start} +${s.dur}ms 图 ${s.loaded}/${s.imgs} 节点 ${s.nodes}`)
      lines.push('[IPC Top]')
      for (const r of aggregateIpc(data.ipc, 10)) {
        lines.push(`  ${r.cmd} ×${r.count} 总${r.total}ms 最长${r.max}ms 首次@${r.firstAt}`)
      }
      lines.push('[资源 Top]')
      for (const r of resourceRows(data.resources, 10)) lines.push(`  @${r.start} ${r.dur}ms ${r.name}`)
      return lines.join('\n')
    }

    async function copyReport() {
      const text = reportText()
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        host.notify('这台设备不支持直接复制，可在面板里长按选择文本', 'warn')
        return
      }
      try {
        await navigator.clipboard.writeText(text)
        host.notify('启动报告已复制')
      } catch (e) {
        host.notify(`复制失败：${String(e)}`, 'error')
      }
    }

    /** 打开面板（`core.panel.<id>` 要等下一次 React 提交才存在，冷启动先重试几次） */
    async function openPanel() {
      for (let i = 0; i < 5; i++) {
        try {
          await command.execute(`core.panel.${PANEL_ID}`)
          return
        } catch (e) {
          if (i === 4) host.notify(`打开启动日志失败：${String(e)}`, 'error')
          await new Promise((r) => setTimeout(r, 120))
        }
      }
    }

    subscriptions.push(
      view.registerPanel({
        id: PANEL_ID,
        title: '启动日志',
        location: 'main',
        render: () => {
          let resources = []
          try {
            resources = typeof performance === 'undefined' ? [] : performance.getEntriesByType('resource')
          } catch {
            resources = []
          }
          const base = readBoot() ?? { at: 0, marks: [], longTasks: [] }
          const snap = probeSnapshot()
          return panelNode({ ...base, ...snap, resources })
        },
      }),
    )

    subscriptions.push(
      command.register({
        id: 'boot-log.open',
        title: '启动日志：查看本次启动耗时',
        run: () => openPanel(),
      }),
    )
    subscriptions.push(
      command.register({
        id: 'boot-log.refresh',
        title: '启动日志：刷新',
        run: () => view.refresh(PANEL_ID),
      }),
    )
    subscriptions.push(
      command.register({
        id: 'boot-log.copy',
        title: '启动日志：复制报告',
        run: () => copyReport(),
      }),
    )

    host.log('info', '启动日志插件已就绪（打点 + IPC 探针 + 长任务快照）')
  },

  dispose() {
    uninstallProbe()
  },
}
