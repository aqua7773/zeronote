/**
 * 启动日志示例插件（rev173.352）—— 把「刚进软件卡一下」的现场读出来。
 *
 * ## 为什么做成插件
 *
 * rev173.351 把启动打点放进了 `window.__znBootMarks()`（`src/lib/boot-marks.ts`），
 * 但 **release 包不回传 logcat** —— 用户手机上是正式包，只能靠页面内自己读：
 * 打点与长任务都常驻内存（`performance.mark` + `PerformanceObserver({ entryTypes:['longtask'] })`），
 * 插件在同一 window 里直接取，不需要任何原生通道。
 *
 * ## 数据
 *
 * `{ at, marks: [{ name, at }], longTasks: [{ start, dur }] }`
 * · `at` / `start` 都是相对**导航开始**的毫秒数（与 logcat 里 `[zn-boot] entry@3 …` 同源）
 * · `longTasks` 只收**启动后 20 秒内** ≥50ms 的主线程任务 —— 「卡顿」就是这一段时间被占住
 *
 * ## 读法
 *
 * 面板「启动日志」：阶段表（每个阶段距上一阶段的间隔）+ 长任务表（按耗时降序）
 * · 「刷新」重新读一次（长任务在 20 秒窗口内还会继续追加）
 * · 「复制日志」把等价的 `[zn-boot] …` 一行文本放进剪贴板，可直接转发
 */

const PANEL_ID = 'boot-log.panel'

/**
 * 读一次打点。`win` 参数只为测试注入 —— 运行时不传，用全局 window。
 * 旧版本内核没有这个全局函数 ⇒ null（面板给提示，不报错）。
 */
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

/** 复原 logcat 里那条同源日志，方便复制转发 */
export function logText(data) {
  const marks = data.marks.map((m) => `${m.name}@${m.at}`).join(' ')
  const tasks = (data.longTasks || []).map((t) => `longtask@${t.start}+${t.dur}ms`).join(' ')
  return `[zn-boot] ${marks}${tasks ? ` | ${tasks}` : ''}`
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
  return {
    type: 'stack',
    gap: 'md',
    children: [
      { type: 'text', value: '本次启动', variant: 'title' },
      {
        type: 'text',
        value: `读于 ${data.at}ms · ${stages.length} 个阶段 · ${tasks.length} 个长任务`,
        variant: 'caption',
        tone: 'muted',
      },
      {
        type: 'table',
        columns: [
          { key: 'stage', label: '阶段' },
          { key: 'at', label: '时刻(ms)', width: '30%', align: 'right' },
          { key: 'gap', label: '间隔(ms)', width: '30%', align: 'right' },
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
          { key: 'start', label: '开始(ms)', width: '40%', align: 'right' },
          { key: 'dur', label: '持续(ms)', width: '40%', align: 'right' },
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
      { type: 'divider' },
      {
        type: 'row',
        gap: 'sm',
        wrap: true,
        children: [
          { type: 'button', label: '刷新', onClick: 'boot-log.refresh' },
          { type: 'button', label: '复制日志', onClick: 'boot-log.copy', variant: 'ghost' },
        ],
      },
      { type: 'text', value: '与 logcat 里那条同源：', variant: 'caption', tone: 'muted' },
      { type: 'code', value: logText(data) },
    ],
  }
}

export default {
  apply(ctx) {
    const { command, view, host, subscriptions } = ctx

    async function copyLog() {
      const data = readBoot()
      if (!data) {
        host.notify('这个版本没有启动打点，没有可复制的日志', 'warn')
        return
      }
      const text = logText(data)
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        host.notify('这台设备不支持直接复制，可在面板里长按选择文本', 'warn')
        return
      }
      try {
        await navigator.clipboard.writeText(text)
        host.notify('启动日志已复制')
      } catch (e) {
        host.notify(`复制失败：${String(e)}`, 'error')
      }
    }

    /**
     * 打开面板。`core.panel.<id>` 由内核为每个面板注册，但要等插件加载后的下一次
     * React 提交才存在 ⇒ 冷启动时先重试几次（tag-panel / doc-reader 同款做法）。
     */
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
        render: () => panelNode(readBoot()),
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
        title: '启动日志：复制日志文本',
        run: () => copyLog(),
      }),
    )

    host.log('info', '启动日志插件已就绪（读 window.__znBootMarks）')
  },
}
