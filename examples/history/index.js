/**
 * 历史版本（history）—— A 档第 3 个插件 · ROADMAP 第 5 项（rev173.99）
 *
 * 需求 §11：
 *   · **每次关闭笔记时，若本次有修改才生成**一个版本；没修改不生成
 *   · 分层精简：最近 7 天每次 · 8–30 天每天留最后一个 · 30 天以上每周一个 · 超过 1 年每月一个
 *   · 支持回滚
 *   · 支持差异对比（首版只做「历史 vs 当前」—— 需求允许选当前版本）
 *
 * 存储：`<库>/.zn/history/<hash32(path)>/<时间戳>.md`
 *   · 放库内 ⇒ 换电脑拷库就带着（2026-10-23 用户拍板）
 *   · `.zn` 不进索引 / 不进文件树（`SKIP_DIRS`）
 *
 * 两条内核能力是本卡新加的（rev173.99，见 contract.ts 的 `FsApi`）：
 *   · `fs.listFiles(dir)` —— 私有目录清单（`listNotes` 只列 `.md` 且跳过 `.zn`，读不出快照）
 *   · `fs.purgePrivate(path)` —— 真删除且只允许 `.zn/` 下（`fs.delete` 是移入回收站，几百份快照会堆爆）
 *
 * 触发（照需求，不照 VS Code）：
 *   · `doc.on('change')` 置脏 → `doc.on('close')` 且脏 ⇒ 存一份
 *   · 兜底：`doc.on('save')` 时若距上次快照 > 10 分钟**也存**（「一直不关」的笔记否则永远没有历史）
 */

const PANEL_ID = 'history.board'
const DIR = '.zn/history'
/** save 兜底的间隔（需求没规定，VS Code 用 10 分钟窗口，这里取"如果有改动且隔了这么久就存一份"） */
const SAVE_GAP_MS = 10 * 60 * 1000
/** 一天 / 一周的毫秒数（分层精简用） */
const DAY = 24 * 60 * 60 * 1000
const WEEK = 7 * DAY
/** 差异对比最多渲染这么多行（超出的截断并提示，避免大笔记把面板拖死） */
const DIFF_MAX_ROWS = 400

/* ───────────────────────── 纯函数（tests/history.test.ts 单测） ───────────────────────── */

/** 稳定的 32 位哈希（FNV-1a）→ 8 位十六进制。用来把笔记路径映射成目录名（路径里的 `/` 不能当目录名用） */
export function hash32(input) {
  let h = 0x811c9dc5
  const s = String(input ?? '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

const pad = (n, w = 2) => String(n).padStart(w, '0')

/** 时间戳 → 快照文件名（本地时间，冒号换成 `-`：Windows 文件名不允许冒号） */
export function snapshotName(ts) {
  const d = new Date(ts)
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}.md`
  )
}

/** 快照文件名 → 时间戳；不合格式返回 0 */
export function parseSnapshotName(name) {
  const base = String(name ?? '')
    .split('/')
    .pop()
    ?.replace(/\.md$/i, '')
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})$/.exec(base ?? '')
  if (!m) return 0
  const [, y, mo, d, h, mi, s, ms] = m
  return new Date(+y, +mo - 1, +d, +h, +mi, +s, +ms).getTime()
}

/** 文件大小 → 人类可读（面板里显示「1.2 KB」） */
export function humanSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 某个时刻的"自然周"键（周一为一周开始）—— 分层精简按周分组用 */
export function weekKey(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  const dow = (d.getDay() + 6) % 7 // 周一 = 0
  d.setDate(d.getDate() - dow)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 某个时刻的"月"键 */
export function monthKey(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

/**
 * 分层精简（需求 §11）：算出**保留谁、删谁**。
 *
 * | 年龄 | 规则 |
 * |---|---|
 * | ≤ 7 天 | 全留 |
 * | 8–30 天 | 每个自然日留**最后一版** |
 * | 31–365 天 | 每个自然周留**最后一版** |
 * | > 365 天 | 每个月留**最后一版** |
 *
 * @param {{name:string, ts:number}[]} entries
 * @param {number} now
 * @returns {{ keep: string[], drop: string[] }}
 */
export function prunePlan(entries, now) {
  const list = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && e.name && Number.isFinite(e.ts) && e.ts > 0)
    .sort((a, b) => a.ts - b.ts)
  const keep = new Set()
  /** 每个分组只留最后（ts 最大）—— 分组键：`d:<日>` / `w:<周>` / `m:<月>` */
  const buckets = new Map()
  for (const e of list) {
    const age = now - e.ts
    if (age <= 7 * DAY) {
      keep.add(e.name)
      continue
    }
    let key
    if (age <= 30 * DAY) key = `d:${new Date(e.ts).toDateString()}`
    else if (age <= 365 * DAY) key = `w:${weekKey(e.ts)}`
    else key = `m:${monthKey(e.ts)}`
    buckets.set(key, e) // 按 ts 升序遍历，后写覆盖 ⇒ 天然留最后一版
  }
  for (const e of buckets.values()) keep.add(e.name)
  return {
    keep: [...keep],
    drop: list.map((e) => e.name).filter((n) => !keep.has(n)),
  }
}

/**
 * 行级差异（LCS）。返回按顺序的 `{ t: 'same'|'add'|'del', text }`。
 *
 * 为什么自己写：项目里 `merge3.ts` 是三方合并、没有 diff；需求要"增删改高亮"，
 * 而 atomic 与 CM6 都不提供文本 diff。笔记规模小（几百行），DP 足够。
 * 超过 1200 行 × 1200 行的乘积就退化为「整段替换」（避免把主线程卡住）。
 */
export function lineDiff(before, after) {
  const A = String(before ?? '').split('\n')
  const B = String(after ?? '').split('\n')
  if (A.length * B.length > 1200 * 1200) {
    return [
      ...A.map((text) => ({ t: 'del', text })),
      ...B.map((text) => ({ t: 'add', text })),
    ]
  }
  const n = A.length
  const m = B.length
  // dp[i][j] = A[i..] 与 B[j..] 的 LCS 长度
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      ops.push({ t: 'same', text: A[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: 'del', text: A[i] })
      i++
    } else {
      ops.push({ t: 'add', text: B[j] })
      j++
    }
  }
  while (i < n) ops.push({ t: 'del', text: A[i++] })
  while (j < m) ops.push({ t: 'add', text: B[j++] })
  return ops
}

/** 差异统计（面板条目上显示 `+3 / -1`） */
export function diffSummary(ops) {
  let added = 0
  let removed = 0
  for (const op of ops ?? []) {
    if (op.t === 'add') added++
    else if (op.t === 'del') removed++
  }
  return { added, removed }
}

/** HTML 转义 —— 笔记正文是用户输入，直接塞 innerHTML 会执行脚本 */
export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 差异 → 高亮 HTML（UINode `html` 节点）。
 *
 * 只渲染有变化的部分 + 少量上下文：整篇 same 行全画出来既长又没信息量。
 */
export function diffHtml(ops, maxRows = DIFF_MAX_ROWS) {
  const list = Array.isArray(ops) ? ops : []
  const rows = []
  let shown = 0
  let truncated = false
  for (const op of list) {
    if (op.t === 'same') continue
    if (shown >= maxRows) {
      truncated = true
      break
    }
    shown++
    const cls = op.t === 'add' ? 'zn-diff-add' : 'zn-diff-del'
    const sign = op.t === 'add' ? '+' : '−'
    rows.push(
      `<div class="zn-diff-row ${cls}"><span class="zn-diff-sign">${sign}</span>${escapeHtml(op.text) || '&nbsp;'}</div>`,
    )
  }
  if (!rows.length) return ''
  if (truncated) {
    rows.push(`<div class="zn-diff-row"><span class="zn-diff-sign">…</span>还有变化未显示</div>`)
  }
  return rows.join('')
}

/** 面板视图（纯数据 UINode） */
export function historyNode(view) {
  const { title = '', entries = [], selected = '', diff = '', summary = '', status = '' } = view ?? {}
  /**
   * 直接打开面板（命令面板里的「打开面板：历史版本」—— 内核给**每个**面板自动注册的那条）
   * 时插件还没拿到"哪篇笔记"，标题会是空。以前这里会渲染成「「」的历史 0 版」，像是坏了。
   * 现在给引导态 + 一个能直达正确命令的按钮。
   */
  if (!title) {
    return {
      type: 'stack',
      gap: 'md',
      children: [
        { type: 'text', value: '历史版本', variant: 'title' },
        {
          type: 'text',
          value: '这个面板需要一个"当前笔记"。点下面的按钮，或在命令面板搜「历史版本：看当前笔记的历史」。',
          variant: 'caption',
          tone: 'muted',
        },
        { type: 'button', label: '看当前笔记的历史', onClick: 'history.show-for-current' },
      ],
    }
  }
  const children = [
    {
      type: 'row',
      align: 'center',
      wrap: true,
      gap: 'sm',
      children: [
        { type: 'text', value: `「${title}」的历史`, variant: 'title' },
        { type: 'badge', text: `${entries.length} 版` },
        { type: 'button', label: '刷新', onClick: 'history.refresh', variant: 'ghost' },
        { type: 'button', label: '现在存一版', onClick: 'history.snapshot-now', variant: 'ghost' },
      ],
    },
  ]
  if (status) children.push({ type: 'text', value: status, variant: 'caption', tone: 'muted' })
  children.push({
    type: 'list',
    empty: '这篇还没生成过历史版本 —— 改动后关闭或切到别的笔记会自动存一版（也可以点上面的「现在存一版」）。',
    items: entries.map((e) => ({
      key: e.file,
      node: {
        type: 'row',
        align: 'center',
        wrap: true,
        gap: 'sm',
        children: [
          {
            type: 'link',
            label: e.label,
            onClick: 'history.pick',
            payload: { file: e.file },
          },
          { type: 'text', value: e.meta, variant: 'caption', tone: 'muted' },
        ],
      },
    })),
  })
  if (selected) {
    children.push({ type: 'divider' })
    children.push({
      type: 'row',
      align: 'center',
      wrap: true,
      gap: 'sm',
      children: [
        { type: 'text', value: summary || '与当前版本的差异', variant: 'title' },
        {
          type: 'button',
          label: '回滚到这一版',
          onClick: 'history.rollback',
          payload: { file: selected },
          variant: 'danger',
        },
      ],
    })
    children.push(
      diff
        ? { type: 'html', value: diff }
        : { type: 'text', value: '与当前版本没有差别。', variant: 'caption', tone: 'muted' },
    )
  }
  return { type: 'stack', gap: 'md', children }
}

/* ───────────────────────── 插件本体 ───────────────────────── */

export default {
  apply(api) {
    /** 当前面板展示的笔记（路径 + 标题）与快照清单 */
    let target = { path: '', title: '' }
    let entries = []
    let selected = ''
    let diff = ''
    let summary = ''
    let status = ''
    /** 有未落盘改动的笔记（close / 切换时据此决定要不要存快照） */
    const dirtyPaths = new Set()
    /** 每篇最后一次 change 的正文 —— 切换笔记时旧文档已经读不到了，靠它存快照 */
    const lastContent = new Map()
    /** 插件自己记的"当前文档"（open/close 事件不保证成对） */
    let currentPath = ''
    /** 每篇最近一次存快照的时间（save 兜底间隔用） */
    const lastAt = new Map()

    function refresh() {
      api.view.refresh(PANEL_ID)
    }

    const dirOf = (path) => `${DIR}/${hash32(path)}`

    /** 库内路径 → 展示用标题（面板标题栏 / 空态文案） */
    const titleOf = (path) => String(path ?? '').split('/').pop()?.replace(/\.md$/i, '') ?? String(path ?? '')

    async function listEntries(path) {
      const dir = dirOf(path)
      let files = []
      try {
        files = await api.fs.listFiles(dir)
      } catch {
        return []
      }
      const out = []
      for (const file of files) {
        const ts = parseSnapshotName(file)
        if (!ts) continue
        out.push({ file, ts })
      }
      out.sort((a, b) => b.ts - a.ts) // 新的在前
      return out
    }

    /**
     * 存一份快照并做分层精简（需求 §11）。
     * `reason` 只用于日志，不进 UI。
     */
    async function snapshot(path, content, reason) {
      if (!path || typeof content !== 'string') return
      const dir = dirOf(path)
      try {
        await api.fs.mkdir(dir)
        // ⚠️ `snapshotName()` 自带 `.md` —— 别再拼一次（实测写成过 `….md.md`）
        await api.fs.writeText(`${dir}/${snapshotName(Date.now())}`, content)
        lastAt.set(path, Date.now())
        api.host.log('info', `历史快照 ${reason}：${path}`)
        await prune(path)
      } catch (e) {
        api.host.log('warn', `历史快照失败（${reason}）：${String(e)}`)
      }
    }

    /** 分层精简：只淘汰**旧**快照，`purgePrivate` 只允许 `.zn/` 下 */
    async function prune(path) {
      const listed = await listEntries(path)
      const { drop } = prunePlan(listed, Date.now())
      for (const file of drop) {
        try {
          await api.fs.purgePrivate(file)
        } catch (e) {
          api.host.log('warn', `清理旧快照失败 ${file}：${String(e)}`)
        }
      }
    }

    /* 事件：change 置脏；close 存快照；save 兜底 */
    api.subscriptions.push(
      api.doc.on('change', (d) => {
        dirtyPaths.add(d.path)
        // 切换笔记时拿不到"上一篇"的内容了 ⇒ change 时先按篇缓存最新正文
        lastContent.set(d.path, d.content)
        currentPath = d.path
      }),
    )
    /**
     * 切换笔记**不一定**发 close（`useDocSession.openNote` 是直接换文档），
     * 所以这里再兜一层：打开另一篇时，若上一篇有改动 ⇒ 用缓存的内容存快照。
     * 不这么做的话，「改完直接点另一篇」这条最常见的路径会一条历史都不留。
     */
    api.subscriptions.push(
      api.doc.on('open', (d) => {
        const prev = currentPath
        currentPath = d.path
        if (prev && prev !== d.path && dirtyPaths.has(prev)) {
          dirtyPaths.delete(prev)
          void snapshot(prev, lastContent.get(prev) ?? '', 'switch')
        }
        lastContent.delete(prev)
      }),
    )
    api.subscriptions.push(
      api.doc.on('close', (d) => {
        if (!dirtyPaths.has(d.path)) return // 没改过 ⇒ 不生成（需求原文）
        dirtyPaths.delete(d.path)
        lastContent.delete(d.path)
        if (d.path === currentPath) currentPath = ''
        void snapshot(d.path, d.content, 'close')
      }),
    )
    api.subscriptions.push(
      api.doc.on('save', (d) => {
        if (!dirtyPaths.has(d.path)) return
        const last = lastAt.get(d.path)
        /**
         * 从没存过 ⇒ 不在这里存：这篇迟早会因为 close / 切换收口。
         * 否则「首次保存」会在 close 之外多出一份**内容相同**的快照（实测多出来的那版就是这么来的）。
         */
        if (last == null) return
        if (Date.now() - last < SAVE_GAP_MS) return
        // save 时不删脏标记：真正的"有改动"由 close 收口
        void snapshot(d.path, d.content, 'save-gap')
      }),
    )

    async function openPanel() {
      for (let i = 0; i < 5; i++) {
        try {
          await api.command.execute(`core.panel.${PANEL_ID}`)
          return
        } catch (e) {
          if (i === 4) throw e
          await new Promise((r) => setTimeout(r, 120))
        }
      }
    }

    /** 当前笔记的正文：优先编辑器里的（可能有未保存改动），否则读盘 */
    async function currentContent(path) {
      const doc = api.doc.active()
      if (doc && doc.path === path) return doc.content
      try {
        return await api.fs.readText(path)
      } catch {
        return ''
      }
    }

    async function showForCurrent() {
      const doc = api.doc.active()
      if (!doc) {
        api.host.notify('先打开一篇笔记，再看它的历史版本', 'warn')
        return
      }
      target = { path: doc.path, title: titleOf(doc.path) }
      selected = ''
      diff = ''
      summary = ''
      status = ''
      await openPanel()
      await reloadEntries()
    }

    async function reloadEntries() {
      entries = await listEntries(target.path)
      status = entries.length ? '' : '还没有历史版本'
      refresh()
    }

    /** 选中一条快照 → 与当前版本对比 */
    async function pick(file) {
      selected = file
      summary = ''
      diff = ''
      refresh()
      try {
        const [oldText, curText] = await Promise.all([
          api.fs.readText(file),
          currentContent(target.path),
        ])
        const ops = lineDiff(oldText, curText)
        const { added, removed } = diffSummary(ops)
        summary = added || removed ? `与当前版本：+${added} 行 / −${removed} 行` : '与当前版本一致'
        diff = diffHtml(ops)
      } catch (e) {
        summary = `读取快照失败：${String(e)}`
      }
      refresh()
    }

    /**
     * 回滚：**先把当前存一份**（回滚本身也可撤销），再写回；编辑器打开着就同步内容。
     * 不删当前文件、不进回收站 —— 当前内容已经进历史，删盘反而更容易丢东西。
     */
    async function rollback(file) {
      if (!target.path) return
      try {
        const cur = await currentContent(target.path)
        await snapshot(target.path, cur, 'pre-rollback')
        const old = await api.fs.readText(file)
        await api.fs.writeText(target.path, old)
        const doc = api.doc.active()
        if (doc && doc.path === target.path) {
          api.doc.replaceRange(0, doc.content.length, old)
        }
        // 回滚后当前版本即"历史里那份"，清脏标记免得 close 再存一次相同内容
        dirtyPaths.delete(target.path)
        api.host.notify(`已回滚到 ${new Date(parseSnapshotName(file)).toLocaleString()}`)
        await reloadEntries()
        await pick(file)
      } catch (e) {
        api.host.notify(`回滚失败：${String(e)}`, 'error')
      }
    }

    /**
     * 状态栏入口（rev173.100）—— 用户：「历史版本没有入口啊，只能命令面板进入」。
     * 状态栏在编辑器 / 起始页都在，比只留命令面板强；按钮极轻，不占版面。
     */
    api.subscriptions.push(
      api.view.registerPanel({
        id: 'history.status',
        title: '历史版本',
        location: 'statusbar',
        render: () => ({
          type: 'button',
          label: '历史版本',
          onClick: 'history.show-for-current',
          variant: 'ghost',
        }),
      }),
    )

    api.subscriptions.push(
      api.view.registerPanel({
        id: PANEL_ID,
        title: '历史版本',
        location: 'modal',
        render: () => {
          /**
           * 从 ☰ 菜单直接打开（rev173.100 新开的入口）时插件还不知道"哪篇笔记"——
           * 这里自动绑定当前打开的那篇。异步列快照放 next tick（render 期间不能同步 refresh）。
           */
          if (!target.path) {
            const doc = api.doc.active()
            if (doc) {
              target = { path: doc.path, title: titleOf(doc.path) }
              setTimeout(() => void reloadEntries(), 0)
            }
          }
          return historyNode({
            title: target.title,
            entries: entries.map((e) => ({
              file: e.file,
              label: new Date(e.ts).toLocaleString(),
              meta: '',
            })),
            selected,
            diff,
            summary,
            status,
          })
        },
      }),
    )

    api.subscriptions.push(
      api.command.register({
        id: 'history.show-for-current',
        title: '历史版本：看当前笔记的历史',
        run: () => showForCurrent(),
      }),
    )

    api.subscriptions.push(
      api.command.register({
        id: 'history.refresh',
        title: '历史版本：刷新列表',
        run: () => reloadEntries(),
      }),
    )

    /** 手动存一版（用户不想等"关闭"时用；存完清脏标记，免得 close 再存一份相同的） */
    api.subscriptions.push(
      api.command.register({
        id: 'history.snapshot-now',
        title: '历史版本：现在存一版',
        run: async () => {
          const doc = api.doc.active()
          if (!doc) {
            api.host.notify('先打开一篇笔记', 'warn')
            return
          }
          await snapshot(doc.path, doc.content, 'manual')
          dirtyPaths.delete(doc.path)
          if (target.path === doc.path) await reloadEntries()
          api.host.notify('已存一版')
        },
      }),
    )

    api.subscriptions.push(
      api.command.register({
        id: 'history.pick',
        title: '历史版本：与当前对比',
        run: (payload) => pick(String(payload?.file ?? '')),
      }),
    )

    api.subscriptions.push(
      api.command.register({
        id: 'history.rollback',
        title: '历史版本：回滚到这一版',
        run: (payload) => rollback(String(payload?.file ?? '')),
      }),
    )
  },
}
