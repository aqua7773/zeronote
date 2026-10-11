/**
 * 灵感流插件 —— ZeroNote 的第一个真插件（也是「声明式 UI 主路」的压力测试）
 *
 * 需求（来自 NoteCode P1 的 R-25/26/27 + C2）：
 *   - 一次发送 = **一篇独立 `.md`**，落在「灵感/当日日期/」下
 *   - 正文空 → 拒发
 *   - 快速连点 → 只 +1
 *   - 失败 → **保留输入**（不清空）
 *
 * 它不使用任何框架代码、不写 React、不开 WebView —— 全部界面由 `UINode` 声明，
 * 内核用统一组件渲染（这就是「风格统一」由架构保证的原因）。
 *
 * 用到的原语：`fs`（读写）/ `command`（命令）/ `view`（面板 + refresh + setState）/ `host`（通知 + 日志）
 */

const BIND_DRAFT = 'inspiration-flow.draft'
const DEDUP_MS = 500

const pad = (n) => String(n).padStart(2, '0')
const todayDir = (d = new Date()) =>
  `灵感/${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** @type {import('../../src/kernel/contract').Plugin} */
export default {
  apply(ctx) {
    const { fs, command, view, host, subscriptions } = ctx

    /** 今天已捕捉的条目（新 → 旧） */
    let items = []
    /** 面板底部的一行状态（成功路径 / 失败原因） */
    let status = ''
    /** 连点保护 */
    let lastSentAt = 0

    async function reload() {
      try {
        const notes = await fs.listNotes(todayDir())
        items = notes.slice().sort((a, b) => b.mtime - a.mtime)
      } catch {
        items = [] // 目录还不存在 = 今天还没写过，不是错误
      }
      view.refresh()
    }

    async function capture(rawValue) {
      const text = String(rawValue ?? '').replace(/\s+$/, '')

      // ① 正文空 → 拒发
      if (!text.trim()) {
        status = '内容为空，已拒发'
        host.notify('内容为空，没有落盘', 'warn')
        view.refresh()
        return
      }

      // ② 快速连点 → 只 +1
      const now = Date.now()
      if (now - lastSentAt < DEDUP_MS) return
      lastSentAt = now

      const d = new Date()
      const rel = `${todayDir(d)}/${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.md`
      try {
        // ③ 一次发送 = 一篇独立 .md
        await fs.createNote(rel, text + '\n')
        view.setState(BIND_DRAFT, '') // 成功才清空输入
        status = `已捕捉 → ${rel}`
        await reload()
        host.notify('已捕捉 ✎')
      } catch (e) {
        // ④ 失败保留输入（不清空），把原因显示出来
        status = `失败：${String(e)}`
        host.notify('捕捉失败，输入已保留', 'error')
        view.refresh()
      }
    }

    subscriptions.push(
      command.register({
        id: 'inspiration-flow.capture',
        title: '灵感：捕捉当前输入',
        run: (payload) => capture(payload && payload.value),
      }),
      command.register({
        id: 'inspiration-flow.refresh',
        title: '灵感：刷新今天的列表',
        run: () => reload(),
      }),
      view.registerPanel({
        id: 'inspiration-flow.stream',
        title: '灵感流',
        location: 'main',
        render: () => ({
          type: 'stack',
          children: [
            { type: 'text', value: '灵感流', variant: 'title' },
            {
              type: 'text',
              value: `今天（${todayDir()}）已捕捉 ${items.length} 条`,
              variant: 'caption',
            },
            { type: 'divider' },
            {
              type: 'input',
              bind: BIND_DRAFT,
              placeholder: '随手记一句，回车即落盘…',
              onSubmit: 'inspiration-flow.capture',
            },
            {
              type: 'button',
              label: '捕捉',
              onClick: 'inspiration-flow.capture',
              send: BIND_DRAFT,
            },
            { type: 'divider' },
            items.length
              ? {
                  type: 'list',
                  items: items.map((n) => ({
                    type: 'text',
                    value: `${n.title} · ${new Date(n.mtime).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`,
                  })),
                }
              : { type: 'text', value: '今天还没有灵感', variant: 'caption' },
            ...(status ? [{ type: 'text', value: status, variant: 'caption' }] : []),
          ],
        }),
      }),
    )

    void reload()
    host.log('info', `灵感流就绪（${todayDir()}）`)
  },

  dispose() {
    // 命令与面板都在 subscriptions 里，由宿主统一 dispose
  },
}
