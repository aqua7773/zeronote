/**
 * 反向链接（backlinks）—— A 档第 2 个插件 · ROADMAP 第 4 项（rev173.95）
 *
 * 需求（规格 §2.2）：`[[笔记名]]` 引用与跳转。**正向跳转内核已实现**（A0 探针 rev173.94：
 * `MarkdownEditor` 在 document 捕获阶段监听 `.cm-atomic-link` → `useDocSession.openWikiLink`），
 * 所以本插件只做**反向**那一半：*谁引用了我*。
 *
 * 为什么用 `fs` 扫而不是 `index.query('[[名字]]')`：
 * 索引会**切词**（空格 / 标点 / `[[` 都可能被丢），拿它找引用必然漏（方案 §4.2 已核实）。
 *
 * rev173.134：从「只扫最近 30 天」升级为**全库持久反链索引**。成本靠三条压住：
 *   1. **`mtime` 缓存**：磁盘 mtime 没变就不重读（rev173.95 起就有）；
 *   2. **`at` 信任窗口**：`note:saved` 现在带 `text`（rev173.133），保存后**零读盘**就能
 *      更新这一篇的 refs；`at >= mtime` 表示我们手里的内容比磁盘那次修改还新，不必重读；
 *   3. **事件增量**：保存 / 外部改 / 删除 / 改名都只动这一篇，不再全库重扫。
 * 老库第一次加载会全量读一遍（后台跑、不挡界面），之后基本零 IO。
 *
 * 面板形态：`location: 'modal'`（浮层）—— 不顶掉编辑器，看一眼就关（2026-10-23 用户已拍板：
 * 标签 / 历史 / 打卡用主区标签，反链用 modal）。
 *
 * 重名：`[[周报]]` 可能指向两篇同名笔记 —— 本插件**按名字匹配**（不分歧），但会在面板顶部
 * 明说"库里还有 N 篇同名"，不让用户误以为只有一条。
 */

const PANEL_ID = 'backlinks.board'
/** 状态栏入口：显示「被 N 篇引用」（2026-10-24 用户要求） */
const STATUS_ID = 'backlinks.status'
/**
 * 缓存键：`{ [path]: { mtime, at, refs: [{ name, line }] } }`
 *
 * · `mtime` —— 读盘时那篇的磁盘修改时间（判"磁盘没变"用）
 * · `at`    —— 我们**最后一次拿到这篇内容**的时刻（事件 / 读盘）。
 *              `at >= mtime` ⇒ 手里的内容不比磁盘旧，可以不重读（rev173.134）
 */
const CACHE_KEY = 'refs.v1'
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

    /* ── 全库持久反链索引（rev173.134） ── */

    /**
     * 内存缓存 `{ [path]: { mtime, at, refs } }` —— 全库的引用表，也是状态栏计数的唯一数据源。
     *
     * 为什么放进内存：状态栏「被 N 篇引用」原来每次事件都 `listNotes()` + 全库扫描，
     * 大库上每保存一次就是一次全库 IO。现在事件只增量改这一篇，计数直接从内存算。
     */
    let cache = {}
    let cacheLoaded = false
    /** store 写入防抖（保存一次写一次 store 太重） */
    let persistTimer = 0

    /** 从 store 恢复缓存（只做一次；坏数据当空表，别让插件起不来） */
    async function loadCache() {
      if (cacheLoaded) return
      cacheLoaded = true
      try {
        const saved = (await api.store.get(CACHE_KEY, {})) ?? {}
        if (saved && typeof saved === 'object') cache = { ...saved, ...cache }
      } catch {
        /* 读不出来就当空表：下一次扫描会重建 */
      }
    }

    /** 落盘（500 ms 防抖） */
    function persistSoon() {
      if (persistTimer) return
      persistTimer = setTimeout(() => {
        persistTimer = 0
        void Promise.resolve(api.store.set(CACHE_KEY, cache)).catch(() => {})
      }, 500)
    }

    /**
     * 这条缓存够不够新 —— 够新就不必读盘。
     *
     * · `mtime` 相等 ⇒ 磁盘没动过（老判据）；
     * · `at >= mtime` ⇒ 我们手里这份内容来自事件 / 读盘，比磁盘那次修改**不旧**。
     *   事件总是发生在写盘之后，所以 `at` 天然 ≥ 文件 mtime；之后别处再改，
     *   mtime 会越过 `at` ⇒ 判定失效 ⇒ 自动重读。这一条是「保存后零读盘」的关键。
     */
    function freshEnough(hit, meta) {
      if (!hit) return false
      if (hit.mtime === meta.mtime) return true
      return typeof hit.at === 'number' && hit.at >= meta.mtime
    }

    /** 记一篇的 refs */
    function putEntry(path, refs, mtime, at) {
      cache[path] = { mtime, at, refs }
      persistSoon()
    }

    /** 从磁盘重读一篇（`note:changed` 用；读不到就当作被删） */
    async function refreshEntry(path) {
      try {
        const text = await api.fs.readText(path)
        putEntry(path, extractRefs(text), 0, Date.now())
      } catch {
        delete cache[path]
        persistSoon()
      }
    }

    /**
     * 扫描全库引用（带缓存）。返回 `{ entries, total, read }`。
     *
     * rev173.134：**全库**（不再只扫最近 30 天）。`read` = 这一轮真正读了几篇盘 ——
     * 稳态下应该是 0（全靠 mtime / at 命中）。大库每读 25 篇让出一次事件循环，
     * 免得首次全扫把界面顶死。
     */
    async function scan(force, prefetched) {
      const all = ((prefetched ?? (await api.fs.listNotes())) || []).filter(
        (n) => n.kind === 'note',
      )
      await loadCache()
      const source = force ? {} : cache
      const entries = []
      let read = 0
      for (const n of all) {
        const hit = source[n.path]
        let entry = freshEnough(hit, n) ? hit : null
        if (!entry) {
          try {
            entry = {
              mtime: n.mtime,
              at: Date.now(),
              refs: extractRefs(await api.fs.readText(n.path)),
            }
            read += 1
          } catch {
            continue // 刚删 / 读不了：这篇跳过，不影响其它
          }
        }
        cache[n.path] = entry
        entries.push({ path: n.path, title: n.title, refs: entry.refs })
        // 分片让出：每读完 25 篇喘一口气（只有首次全扫会走到）
        if (read > 0 && read % 25 === 0) await new Promise((r) => setTimeout(r, 0))
      }
      // 磁盘上已经没有的篇：缓存里一并淘汰（用 listNotes 的结果当权威）
      const alive = new Set(all.map((n) => n.path))
      for (const path of Object.keys(cache)) if (!alive.has(path)) delete cache[path]
      persistSoon()
      return { entries, total: all.length, read }
    }

    /**
     * 后台补齐全库索引（启动 / 切库后跑一次；不挡界面）。
     *
     * 用 promise 缓存：`updateCount` 会 `await` 它 —— 否则冷启动那一下状态栏先显示
     * 「被 0 篇引用」再跳成真实数字（测试里也暴露了同样的时序）。补齐完成后延迟一拍
     * 重算一次，避免和 `updateCount` 自己的等待互相递归。
     */
    let catchUpPromise = null
    function ensureCaughtUp() {
      if (catchUpPromise) return catchUpPromise
      catchUpPromise = (async () => {
        await loadCache()
        try {
          await scan(false)
        } catch (e) {
          api.host.log?.('debug', `反链索引补齐失败：${String(e)}`)
        }
        setTimeout(() => touchCount(), 0)
      })()
      return catchUpPromise
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
          summary: `全库 ${r.total} 篇 · 本轮读盘 ${r.read} 篇 · ${new Date().toLocaleTimeString()}`,
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

    const render = () => {
      /**
       * 从 ☰ 菜单直接打开（rev173.100 新开的入口）时还没有 target ——
       * 自动绑定当前笔记并扫一遍，否则面板会停在「引用「」的笔记 0 条」。
       */
      if (!view.target) {
        const doc = api.doc.active()
        if (doc) {
          const guess = baseName(doc.path)
          view = {
            ...view,
            target: guess,
            names: [guess],
            selfPath: doc.path,
            scanning: true,
            summary: '正在扫描引用…',
          }
          setTimeout(() => void rescan(false), 0)
        }
      }
      return noteNode(view)
    }

    api.subscriptions.push(
      api.view.registerPanel({
        id: PANEL_ID,
        title: '反向链接',
        location: 'modal',
        render,
      }),
    )

    /* ───────── 状态栏：被 N 篇引用（2026-10-24 用户：「给底部状态栏加一条」） ───────── */

    /** 当前笔记被多少**篇**引用（去重后）、以及它的展示名 */
    let refCount = 0
    let refTarget = ''
    let countSeq = 0

    /**
     * 重算状态栏计数。
     *
     * rev173.134：**从内存缓存算**，不再 `scan()` 全库。以前每收到一个 `note:*` 事件
     * 就 `listNotes()` + 扫描一轮，大库上「每保存一次 = 一次全库 IO」。现在缓存由事件
     * 增量维护，这里只剩一次目录列举（拿标题）。
     */
    async function updateCount(path) {
      const seq = ++countSeq
      try {
        await ensureCaughtUp() // 冷启动先让全库索引就位，避免先显示 0 再跳数字
        const notes = await api.fs.listNotes()
        const meta = notes.find((n) => n.path === path)
        const names = [...new Set([meta?.title, baseName(path)].filter(Boolean))]
        const entries = (notes ?? [])
          .filter((n) => n.kind === 'note')
          .map((n) => ({ path: n.path, title: n.title, refs: cache[n.path]?.refs ?? [] }))
        if (seq !== countSeq) return // 期间又切了笔记，丢弃旧结果
        const hits = matchRefs(entries, names, path)
        refTarget = meta?.title || baseName(path)
        // 「篇数」而不是「条数」：同一篇里引用两次只算一篇（与标签面板的口径一致）
        refCount = new Set(hits.map((h) => h.path)).size
      } catch {
        if (seq !== countSeq) return
        refTarget = baseName(path)
        refCount = 0
      }
      api.view.refresh(STATUS_ID)
    }

    api.subscriptions.push(
      api.view.registerPanel({
        id: STATUS_ID,
        title: '反向链接',
        location: 'statusbar',
        render: () => ({
          type: 'button',
          // 没有打开的笔记时给中性文字（点它会给"先打开一篇笔记"的提示）
          label: refTarget ? `被 ${refCount} 篇引用` : '被引用',
          onClick: 'backlinks.show-for-current',
          variant: 'ghost',
        }),
      }),
    )

    /* 切笔记 / 当前笔记内容变化 / 库里别的笔记增删，都可能改变"被引用数" */
    api.subscriptions.push(
      api.doc.on('open', (d) => {
        if (d?.path) void updateCount(d.path)
      }),
    )

    /** 有打开的笔记就顺手重算状态栏（缓存已经更新，这一步很便宜） */
    function touchCount() {
      const doc = api.doc.active()
      if (doc?.path) void updateCount(doc.path)
    }

    /* 事件增量：增删改都只动这一篇，不再触发全库扫描（rev173.134） */
    api.subscriptions.push(
      api.event.on('note:saved', (payload) => {
        const path = String(payload?.path ?? '')
        if (!path) return
        // 内核随事件带正文（rev173.133）⇒ 保存后零读盘就能更新这篇的引用表
        if (typeof payload?.text === 'string') {
          putEntry(path, extractRefs(payload.text), 0, Date.now())
        } else {
          void refreshEntry(path) // 旧内核：退回读盘
        }
        touchCount()
      }),
    )

    api.subscriptions.push(
      api.event.on('note:changed', (payload) => {
        const path = String(payload?.path ?? '')
        if (!path) return
        // 插件自己写盘（rev173.120）不算内容变化，跳过避免无谓读盘
        if (payload?.origin === 'plugin') return
        if (payload?.kind === 'delete') {
          delete cache[path]
          persistSoon()
        } else {
          void refreshEntry(path)
        }
        touchCount()
      }),
    )

    api.subscriptions.push(
      api.event.on('note:deleted', (payload) => {
        const path = String(payload?.path ?? '')
        if (!path) return
        delete cache[path]
        persistSoon()
        touchCount()
      }),
    )

    api.subscriptions.push(
      api.event.on('note:renamed', (payload) => {
        const from = String(payload?.from ?? '')
        const to = String(payload?.to ?? '')
        if (!from || !to) return
        if (cache[from]) {
          cache[to] = cache[from]
          delete cache[from]
          persistSoon()
        }
        touchCount()
      }),
    )

    /**
     * 插件加载时可能已经有打开的笔记（热重载 / 切换插件）：
     * 先恢复缓存 → 后台补齐全库（老库第一次会全量读一遍）→ 再算一次状态栏。
     */
    void (async () => {
      await ensureCaughtUp()
      const doc = api.doc.active()
      if (doc?.path) void updateCount(doc.path)
    })()

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
