/**
 * 反向链接（backlinks）—— A 档第 2 个插件 · ROADMAP 第 4 项（rev173.95）
 *
 * 需求（规格 §2.2）：`[[笔记名]]` 引用与跳转。**正向跳转内核已实现**（A0 探针 rev173.94：
 * `MarkdownEditor` 在 document 捕获阶段监听 `.cm-atomic-link` → `useDocSession.openWikiLink`），
 * 所以本插件只做**反向**那一半：*谁引用了我*。
 *
 * 为什么用 `fs` 扫而不是 `index.query('[[名字]]')`：
 * 索引会**切词**（空格 / 标点 / `[[` 都可能被丢），拿它找引用必然漏（方案 §4.2 已核实）。
 * 所以走 `fs.listNotes()` + 逐篇 `readText` —— 有成本，靠下面两条压住：
 *   1. **只扫最近 30 天**改过的笔记（老笔记里的引用极少变化，且用户当前关心的通常在新笔记里）
 *   2. **按 path + mtime 缓存**到 `store`：mtime 没变就不重读（第二次打开几乎零 IO）
 *
 * 面板形态：`location: 'modal'`（浮层）—— 不顶掉编辑器，看一眼就关（2026-10-23 用户已拍板：
 * 标签 / 历史 / 打卡用主区标签，反链用 modal）。
 *
 * 重名：`[[周报]]` 可能指向两篇同名笔记 —— 本插件**按名字匹配**（不分歧），但会在面板顶部
 * 明说"库里还有 N 篇同名"，不让用户误以为只有一条。
 */

const PANEL_ID = 'backlinks.board'
/** 缓存键：`{ [path]: { mtime, refs: [{ name, line }] } }` */
const CACHE_KEY = 'refs.v1'
/** 只扫最近这么多天改过的笔记（方案 §4.2 的折中） */
const SCAN_DAYS = 30
/** 上下文行截断（一个字一个字算，不用 slice 免得切坏 emoji） */
const CONTEXT_MAX = 120
/** 同一篇里最多展示几条引用（一篇里刷 20 条会把面板撑爆） */
const MAX_REFS_PER_NOTE = 5

/* ───────────────────────── 纯函数（tests/backlinks.test.ts 单测） ───────────────────────── */

/** 归一化引用名：去 `.md`、反斜杠转正斜杠、trim、小写（引用匹配大小写不敏感） */
export function normName(s) {
  return String(s ?? '')
    .replace(/\\/g, '/')
    .trim()
    .replace(/\.md$/i, '')
    .toLowerCase()
}

/** 库内相对路径 → 文件名（去目录与 `.md`） */
export function baseName(path) {
  const p = String(path ?? '')
  const file = p.split('/').pop() ?? p
  return file.replace(/\.md$/i, '')
}

/** 压成一行（上下文行不改写标点，只收空白） */
export function oneLine(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 从一篇正文里抽出所有 `[[名字]]` / `[[名字|显示名]]`，带**所在行**当上下文。
 *
 * 规则：
 * · 名字 1–80 字、不含 `[` `]` 与换行（与 `editor-marks` 的 mark 正则同一尺度）；
 * · 同一名字只留**第一处**（同一篇反复引用同一篇笔记不重复刷屏）；
 * · 每篇最多 `MAX_REFS_PER_NOTE` 条。
 */
export function extractRefs(text) {
  const src = String(text ?? '')
  const out = []
  const seen = new Set()
  const re = /\[\[([^[\]\n|]{1,80})(?:\|([^[\]\n]*))?\]\]/g
  for (const m of src.matchAll(re)) {
    const name = m[1].trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push({ name, line: contextLine(src, m.index ?? 0) })
    if (out.length >= MAX_REFS_PER_NOTE) break
  }
  return out
}

/** 取 `pos` 所在的整行（截断到 CONTEXT_MAX） */
function contextLine(src, pos) {
  const start = src.lastIndexOf('\n', Math.max(0, pos - 1)) + 1
  const endIdx = src.indexOf('\n', pos)
  const raw = src.slice(start, endIdx === -1 ? src.length : endIdx)
  const one = oneLine(raw)
  const chars = Array.from(one)
  return chars.length > CONTEXT_MAX ? `${chars.slice(0, CONTEXT_MAX).join('')}…` : one
}

/**
 * 在「已扫描的笔记」里找引用了 `names`（标题 / 文件名等）的那些。
 *
 * @param {Array<{path:string,title:string,refs:{name:string,line:string}[]}>} entries
 * @param {string[]} names 目标名（标题、文件名…）
 * @param {string} [selfPath] 排除自己（自己引用自己不算反链）
 */
export function matchRefs(entries, names, selfPath) {
  const want = new Set((names ?? []).map(normName).filter(Boolean))
  if (want.size === 0) return []
  const hits = []
  for (const e of entries ?? []) {
    if (selfPath && e.path === selfPath) continue
    for (const r of e.refs ?? []) {
      if (!want.has(normName(r.name))) continue
      hits.push({ path: e.path, title: e.title || baseName(e.path), name: r.name, line: r.line })
    }
  }
  // 稳定顺序：先按来源标题，再按路径（同名笔记也能分开看）
  hits.sort((a, b) => a.title.localeCompare(b.title) || a.path.localeCompare(b.path))
  return hits
}

/** 库里还有哪些笔记与目标同名（用于"可能有歧义"提示） */
export function findAmbiguous(notes, names, selfPath) {
  const want = new Set((names ?? []).map(normName).filter(Boolean))
  if (want.size === 0) return []
  return (notes ?? []).filter(
    (n) =>
      n.path !== selfPath &&
      (want.has(normName(n.title)) || want.has(normName(baseName(n.path)))),
  )
}

/** 面板视图（纯数据 UINode） */
export function noteNode(view) {
  const {
    target = '',
    hits = [],
    ambiguity = [],
    summary = '',
    scanning = false,
  } = view ?? {}

  const children = [
    {
      type: 'row',
      align: 'center',
      wrap: true,
      gap: 'sm',
      children: [
        { type: 'text', value: `引用「${target}」的笔记`, variant: 'title' },
        { type: 'badge', text: `${hits.length} 条` },
        { type: 'button', label: '重新扫描', onClick: 'backlinks.rescan', variant: 'ghost' },
      ],
    },
  ]

  if (summary) {
    children.push({ type: 'text', value: summary, variant: 'caption', tone: 'muted' })
  }
  if (ambiguity.length > 0) {
    children.push({
      type: 'text',
      value:
        `注意：库里还有 ${ambiguity.length} 篇同名笔记（${ambiguity
          .map((n) => n.path)
          .join('、')}）—— ` + '按名字匹配时分不清引用指向谁。',
      variant: 'caption',
      tone: 'warn',
    })
  }

  children.push({
    type: 'list',
    empty: scanning ? '正在扫描引用…' : `还没有笔记引用「${target}」`,
    items: hits.map((h, i) => ({
      key: `${h.path}#${i}`,
      node: {
        type: 'stack',
        gap: 'sm',
        children: [
          {
            type: 'link',
            label: h.title,
            onClick: 'backlinks.open',
            payload: { path: h.path },
          },
          ...(h.line ? [{ type: 'text', value: h.line, variant: 'caption', tone: 'muted' }] : []),
        ],
      },
    })),
  })

  return { type: 'stack', gap: 'md', children }
}

/* ───────────────────────── 插件本体 ───────────────────────── */

export default {
  apply(api) {
    /** 当前展示的数据（面板 render 读它；切面板回来不丢） */
    let view = {
      target: '',
      names: [],
      selfPath: '',
      hits: [],
      ambiguity: [],
      summary: '',
      scanning: false,
    }
    let scanSeq = 0

    function refresh() {
      api.view.refresh(PANEL_ID)
    }

    /**
     * 扫描全库引用（带缓存）。返回 `{ entries, total, recent }`。
     *
     * 缓存语义：**path + mtime 都没变 ⇒ 直接用上次抽出的 refs**。删掉的笔记用"新缓存表覆盖"
     * 自然淘汰（不必主动清）。`force` 时整表作废（「重新扫描」按钮）。
     */
    async function scan(force, prefetched) {
      const all = ((prefetched ?? (await api.fs.listNotes())) || []).filter(
        (n) => n.kind === 'note',
      )
      const cutoff = Date.now() - SCAN_DAYS * 24 * 60 * 60 * 1000
      const recent = all.filter((n) => n.mtime >= cutoff)
      let cached = {}
      if (!force) {
        try {
          cached = (await api.store.get(CACHE_KEY, {})) ?? {}
        } catch {
          cached = {}
        }
      }
      const nextCache = {}
      const entries = []
      for (const n of recent) {
        const hit = cached[n.path]
        let entry = hit && hit.mtime === n.mtime ? hit : null
        if (!entry) {
          try {
            entry = { mtime: n.mtime, refs: extractRefs(await api.fs.readText(n.path)) }
          } catch {
            continue // 刚删 / 读不了：这篇跳过，不影响其它
          }
        }
        nextCache[n.path] = entry
        entries.push({ path: n.path, title: n.title, refs: entry.refs })
      }
      try {
        await api.store.set(CACHE_KEY, nextCache)
      } catch {
        /* 缓存写失败不影响本次结果 */
      }
      return { entries, total: all.length, recent: recent.length }
    }

    /** 用当前 target 重算命中（`view.names` 由 show 时定） */
    async function rescan(force, prefetched) {
      const seq = ++scanSeq
      view = { ...view, scanning: true, summary: '正在扫描引用…' }
      refresh()
      try {
        const r = await scan(force, prefetched)
        if (seq !== scanSeq) return // 期间又发起了新扫描，丢弃这次结果
        view = {
          ...view,
          hits: matchRefs(r.entries, view.names, view.selfPath),
          ambiguity: findAmbiguous(r.entries, view.names, view.selfPath),
          scanning: false,
          summary: `最近 ${SCAN_DAYS} 天改过 ${r.recent} 篇 / 全库 ${r.total} 篇 · ${new Date().toLocaleTimeString()}`,
        }
      } catch (e) {
        view = { ...view, scanning: false, hits: [], summary: `扫描失败：${String(e)}` }
      }
      refresh()
    }

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

    /**
     * 打开「谁引用了当前笔记」。
     *
     * 先同步拿出一份 target（文件名），**先把面板打开**（显示"正在扫描"），再异步补结果 ——
     * 大库扫描可能要一两秒，点了命令没反应是最糟的体验。
     */
    async function showForCurrent(payload) {
      const override = String(payload?.title ?? '').trim()
      const doc = api.doc.active()
      if (!override && !doc) {
        api.host.notify('先打开一篇笔记，再看谁引用了它', 'warn')
        return
      }
      const path = doc?.path ?? ''
      const guess = override || baseName(path)

      view = {
        target: guess,
        names: [guess],
        selfPath: path,
        hits: [],
        ambiguity: [],
        summary: '正在扫描引用…',
        scanning: true,
      }

      await openPanel()

      /**
       * 目标名要**先补齐再扫**：笔记可能被 `[[文件名]]` 或 `[[标题]]` 引用，两个都算。
       * `listNotes()` 顺手拿一次，扫描直接复用（不重复读目录）。
       */
      let notes = null
      try {
        notes = await api.fs.listNotes()
      } catch {
        /* 拿不到标题就只用文件名，不影响反链 */
      }
      const meta = path ? notes?.find((n) => n.path === path) : null
      const names = [...new Set([guess, meta?.title, path ? baseName(path) : ''].filter(Boolean))]
      view = { ...view, target: meta?.title || guess, names }
      refresh()

      await rescan(false, notes)
    }

    const render = () => noteNode(view)

    api.subscriptions.push(
      api.view.registerPanel({
        id: PANEL_ID,
        title: '反向链接',
        location: 'modal',
        render,
      }),
    )

    api.subscriptions.push(
      api.command.register({
        id: 'backlinks.show-for-current',
        title: '反向链接：看谁引用了当前笔记',
        run: (payload) => showForCurrent(payload),
      }),
    )

    api.subscriptions.push(
      api.command.register({
        id: 'backlinks.rescan',
        title: '反向链接：重新扫描',
        run: () => rescan(true),
      }),
    )

    api.subscriptions.push(
      api.command.register({
        id: 'backlinks.open',
        title: '反向链接：打开这条引用的来源笔记',
        run: async (payload) => {
          const path = String(payload?.path ?? '').trim()
          if (!path) return
          try {
            await api.command.execute('core.openNote', { path })
          } catch (e) {
            api.host.notify(`打不开「${path}」：${String(e)}`, 'error')
          }
        },
      }),
    )
  },
}
