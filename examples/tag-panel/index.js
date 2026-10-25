/**
 * 标签面板（tag-panel）—— A 档第 2 个插件 · ROADMAP 第 2 项（rev173.93）
 *
 * 需求（规格 §6.1）：标签由 AI 自动打；「点击标签后跳转到『所有带这个标签的笔记』列表」。
 * 本插件只做**浏览**这一半（AI 打标签属 B 档「AI 分类」，不在本卡）：
 *   面板 = 全库标签列表（按篇数降序）→ 点一个标签 → 下面列出该标签下的笔记 → 点标题打开。
 *
 * 为什么是 `location: 'main'` 而不是侧栏：
 *   内核**没有独立侧栏载体**（契约 `PanelLocation` 的注释：`sidebar` 与 `main` 一样渲染在主区）。
 *   要"与编辑器同屏"只能挤在 `editor-topbar` / `editor-toolbar`（很窄），而标签列表会很长。
 *   所以走主区面板：与 doc-reader / outline-map 同一形态 —— 进标签条、可拖出成独立窗口（桌面）。
 *
 * 数据源两条（都是内核现成原语，本插件不碰 fs）：
 *   · `index.tags()`                 → `{ tag, count }[]`（已按篇数降序、同数按名）
 *   · `index.query('', { tag })`     → 该标签下的 `SearchHit[]`
 *
 * 三条真实约束（读源码核实过，别改回去）：
 *   1. `index.tags()` 只统计**已经 upsert/rebuild 进索引**的笔记。刚启动时索引是空的
 *      （App 只在打开搜索面板 / 本插件时重建）⇒ 首次打开若为空，自动 `rebuild()` 一次。
 *   2. `fs-events.ts` 里写盘后是 `void index.upsert(...)` **不 await** 再 emit `note:saved`
 *      ⇒ 事件到达时索引可能还差一拍。所以置脏后**延迟 120ms** 再读，并合并连续事件。
 *   3. 面板 `render` 是**纯函数、在渲染期被调用**：不能在里面同步 `view.refresh()`
 *      （React 会报"渲染期间更新另一个组件"）。首次懒加载因此放到 `setTimeout(0)` 里。
 *
 * 状态放哪：`filter` 必须走 `ctx.state`（`input` 的 `bind` 值由宿主受控），
 * 选中标签与查询结果放插件闭包（面板切走再回来不丢；图标模板不变）。
 */

const PANEL_ID = 'tag-panel.board'
/** 「点正文里的 #标签」弹出的悬浮面板（rev173.96）—— 与主区面板共用一份数据 */
const PEEK_ID = 'tag-panel.peek'
/** 输入框绑定键 —— 带插件前缀，面板 state 是全宿主共享的一张表 */
const FILTER_BIND = 'tag-panel.filter'
/** 标签列表缓存（规格：30 s）—— 期间靠事件置脏，不靠计时器轮询 */
const CACHE_MS = 30_000
/** 置脏后的合并延迟：等 `fs-events` 里那条没 await 的 `upsert` 落进索引 */
const DIRTY_DELAY_MS = 120
/** 摘要截断：列表里一行够看就行，全文在笔记里 */
const EXCERPT_MAX = 120
/**
 * 正文 `#标签` 的正则 —— 与 `tagsOf`（`src/kernel/index-api.ts:142`）**逐字一致**。
 * 不一致的后果（实测）：`#工作。` 会把句号算进标签名，点开浮层查不到任何笔记。
 */
const TAG_PATTERN = String.raw`(?<=^|\s)#([^\s#[\]{}()（）【】「」，。！？、；：""''.,!?;:]{1,30})`

/* ───────────────────────── 纯函数（tests/tag-panel.test.ts 单测） ───────────────────────── */

/** 按篇数降序；同篇数按名字本地化排序（与内核 `tags()` 的规则一致，这里是防御 + 可测） */
export function sortTags(list) {
  return (Array.isArray(list) ? list : [])
    .map((t) => ({ tag: String(t?.tag ?? ''), count: Number(t?.count) || 0 }))
    .filter((t) => t.tag !== '')
    // 显式 'zh'：不传 locale 时结果随运行环境默认 locale 变化（CI 的 en-US 下中文序不同）
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh'))
}

/** 按名字筛选（大小写不敏感、中文子串）；空查询原样返回 */
export function filterTags(list, query) {
  const rows = Array.isArray(list) ? list : []
  const q = String(query ?? '')
    .trim()
    .toLowerCase()
  if (!q) return rows
  return rows.filter((t) => t.tag.toLowerCase().includes(q))
}

/**
 * 去掉开头的 frontmatter —— 摘要不该从 `--- tags: [工作] ---` 开始（那是元数据，不是正文）。
 * 两种形态都要剥：原文的多行块，以及**内核已压成一行**的 `SearchHit.excerpt`
 * （`--- tags: [工作] --- # 标题 …`）——只按 `\n` 匹配会漏掉后者（实测踩到）。
 */
function stripFrontmatter(text) {
  return String(text ?? '')
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    .replace(/^---\s[\s\S]*?\s---\s*/, '')
}

/** 把检索摘要压成一行可读文本（`SearchHit.excerpt` 可能带换行 / 多段 / frontmatter） */
export function cleanExcerpt(text) {
  const one = stripFrontmatter(text)
    .replace(/\s+/g, ' ')
    .trim()
  return one.length > EXCERPT_MAX ? `${Array.from(one).slice(0, EXCERPT_MAX).join('')}…` : one
}

/** 检索结果 → 面板行数据（只留渲染要用的字段；纯函数便于断言） */
export function toNoteRows(hits) {
  return (Array.isArray(hits) ? hits : []).map((h) => ({
    path: String(h?.path ?? ''),
    title: String(h?.title ?? '') || String(h?.path ?? ''),
    excerpt: cleanExcerpt(h?.excerpt),
  }))
}

/**
 * 面板视图（纯数据，UINode）。
 *
 * 结构：
 *   标签行（标题 + 种数 + 重建 / 取消筛选）· 筛选输入框 · 状态行 · 标签列表
 *   选中后追加：分隔线 · 「某标签 · N 篇」· 该标签下的笔记列表
 */
export function panelNode(view) {
  const { tags = [], filter = '', selected = '', notes = [], status = '', loading = false } =
    view ?? {}
  const visible = filterTags(tags, filter)

  const children = [
    {
      type: 'row',
      align: 'center',
      wrap: true,
      gap: 'sm',
      children: [
        { type: 'text', value: '标签', variant: 'title' },
        { type: 'badge', text: `${tags.length} 种` },
        { type: 'button', label: '重建索引', onClick: 'tag-panel.rebuild', variant: 'ghost' },
        ...(selected
          ? [{ type: 'button', label: '取消筛选', onClick: 'tag-panel.clear', variant: 'ghost' }]
          : []),
      ],
    },
    { type: 'input', bind: FILTER_BIND, placeholder: '筛选标签…' },
    ...(status
      ? [{ type: 'text', value: status, variant: 'caption', tone: loading ? 'muted' : 'warn' }]
      : []),
    {
      type: 'list',
      /**
       * 空态要区分「全库没标签」与「筛掉了」—— 只说前者会让用户以为库坏了（实测发现）。
       */
      empty: filter.trim()
        ? `没有匹配「${filter.trim()}」的标签`
        : '还没有标签。在正文里写 #标签，或在笔记开头加 tags: [a, b]。',
      items: visible.map((t) => ({
        key: t.tag,
        node: {
          type: 'row',
          align: 'center',
          wrap: true,
          gap: 'sm',
          children: [
            { type: 'badge', text: String(t.count), tone: t.tag === selected ? 'success' : 'default' },
            { type: 'link', label: t.tag, onClick: 'tag-panel.select', payload: { tag: t.tag } },
          ],
        },
      })),
    },
  ]

  if (selected) {
    children.push({ type: 'divider' })
    children.push({
      type: 'row',
      align: 'center',
      wrap: true,
      gap: 'sm',
      children: [
        { type: 'text', value: `「${selected}」下的笔记`, variant: 'title' },
        { type: 'badge', text: `${notes.length} 篇` },
      ],
    })
    children.push({
      type: 'list',
      empty: '这个标签下还没有笔记。刚打的标签/刚保存的笔记可能还没进索引 —— 点上面的「重建索引」。',
      items: notes.map((n) => ({
        key: n.path,
        node: {
          type: 'stack',
          gap: 'sm',
          children: [
            { type: 'link', label: n.title, onClick: 'tag-panel.openNote', payload: { path: n.path } },
            ...(n.excerpt
              ? [{ type: 'text', value: n.excerpt, variant: 'caption', tone: 'muted' }]
              : []),
          ],
        },
      })),
    })
  }

  return { type: 'stack', gap: 'md', children }
}

/**
 * 从正文 + 光标偏移解析出「光标落在哪个 `#标签` 上」（rev173.96）。
 *
 * 为什么不用点击事件的 `payload.text`：那是 mark 元素的 `textContent`，一旦 atomic 在标签里
 * 插了 widget（或将来 mark 被拆）就不完整。`from` 偏移是内核算好的绝对位置，配合正文解析最稳。
 *
 * @param {string} content 当前文档正文
 * @param {number} from 编辑器偏移（0 起）
 * @returns {string} 标签名（不含 `#`）；不在任何标签上 ⇒ `''`
 */
export function resolveTagAt(content, from) {
  const src = String(content ?? '')
  const pos = Number(from)
  if (!src || !Number.isFinite(pos) || pos < 0 || pos > src.length) return ''
  for (const m of src.matchAll(new RegExp(TAG_PATTERN, 'gm'))) {
    const start = m.index ?? 0
    const end = start + m[0].length
    // 含两端：点在 `#` 上、点在末尾（光标贴在标签后）都算"在这个标签上"
    if (pos >= start && pos <= end) return m[1]
  }
  return ''
}

/**
 * 「点标签」的悬浮面板（`modal`）。
 *
 * 用户 2026-10-23 的口径：**在笔记里点一个标签 → 弹出浮层 → 列出所有打了这个标签的笔记 →
 * 点某一篇 → 直接在那篇的独立窗口里打开**。所以这里的 link 走 `tag-panel.openInWindow`
 * （桌面真窗口；手机降级为当前编辑器打开 —— 手机没有多窗口）。
 */
export function peekNode(view) {
  const { tag = '', notes = [], loading = false } = view ?? {}
  return {
    type: 'stack',
    gap: 'md',
    children: [
      {
        type: 'row',
        align: 'center',
        wrap: true,
        gap: 'sm',
        children: [
          { type: 'text', value: `#${tag}`, variant: 'title' },
          { type: 'badge', text: `${notes.length} 篇` },
          { type: 'button', label: '打开标签面板', onClick: 'tag-panel.open', variant: 'ghost' },
        ],
      },
      {
        type: 'text',
        value: '点一篇 → 在独立窗口打开（手机在主区打开）',
        variant: 'caption',
        tone: 'muted',
      },
      {
        type: 'list',
        empty: loading ? '正在读取索引…' : '还没有笔记用这个标签',
        items: notes.map((n) => ({
          key: n.path,
          node: {
            type: 'stack',
            gap: 'sm',
            children: [
              {
                type: 'link',
                label: n.title,
                onClick: 'tag-panel.openInWindow',
                payload: { path: n.path },
              },
              ...(n.excerpt
                ? [{ type: 'text', value: n.excerpt, variant: 'caption', tone: 'muted' }]
                : []),
            ],
          },
        })),
      },
    ],
  }
}

/* ───────────────────────── 插件本体 ───────────────────────── */

export default {
  apply(api) {
    /** 全库标签（已排序） */
    let tags = []
    let notes = []
    let selected = ''
    let status = ''
    let loading = false
    /** 缓存时间点 + 脏标记（事件置脏；30 s 内不重读） */
    let cacheAt = 0
    let dirty = true
    /** 首次打开时的"空索引自动重建"只做一次（免得空库每次刷新都扫全库） */
    let rebuiltOnce = false
    /** 面板首次渲染才开始加载（不在插件加载时扫全库，避免拖慢启动） */
    let started = false
    let dirtyTimer = 0

    function refresh() {
      api.view.refresh(PANEL_ID)
    }

    /** 标签 + （选中时）该标签下的笔记 —— 一个函数收口，事件与命令都走它 */
    async function loadNotes(tag) {
      if (!tag) {
        notes = []
        return
      }
      try {
        const hits = await api.index.query('', { tag })
        // 选中的标签可能在两次读取之间被改名/删光：结果为空是合法状态，不当错误
        notes = toNoteRows(hits)
      } catch (e) {
        notes = []
        status = `查询标签「${tag}」失败：${String(e)}`
      }
    }

    async function loadTags(force) {
      if (!force && !dirty && Date.now() - cacheAt < CACHE_MS) return
      loading = true
      status = ''
      refresh()
      try {
        let list = await api.index.tags()
        if (list.length === 0 && !rebuiltOnce) {
          /**
           * 首次打开且索引为空 ⇒ 扫一遍库（契约：`tags()` 只认已经 upsert/rebuild 的笔记）。
           * 只在插件生命周期里做一次：空库（真的没有标签）不该每次打开都全库扫描。
           */
          rebuiltOnce = true
          status = '索引里还没有标签，正在扫一遍库…'
          refresh()
          await api.index.rebuild()
          list = await api.index.tags()
        }
        tags = sortTags(list)
        cacheAt = Date.now()
        dirty = false
        status = tags.length === 0 ? '这个库还没有标签。在正文写 #标签，或在开头加 tags: [a, b]。' : ''
      } catch (e) {
        status = `读取标签失败：${String(e)}`
      } finally {
        if (selected) await loadNotes(selected)
        loading = false
        refresh()
      }
    }

    /** 事件置脏：合并 120ms（见文件头约束 2），然后重读标签 + 当前标签下的笔记 */
    function markDirty() {
      dirty = true
      if (dirtyTimer) return
      dirtyTimer = setTimeout(() => {
        dirtyTimer = 0
        void loadTags(true)
      }, DIRTY_DELAY_MS)
    }

    /** 面板首次渲染时启动加载（`setTimeout(0)`：render 期间不能同步 refresh） */
    function ensureStarted() {
      if (started) return
      started = true
      setTimeout(() => void loadTags(true), 0)
    }

    function currentFilter(ctx) {
      const v = ctx?.state?.[FILTER_BIND]
      return typeof v === 'string' ? v : ''
    }

    api.subscriptions.push(
      api.view.registerPanel({
        id: PANEL_ID,
        title: '标签',
        location: 'main',
        render: (ctx) => {
          ensureStarted()
          return panelNode({
            tags,
            filter: currentFilter(ctx),
            selected,
            notes,
            status,
            loading,
          })
        },
      }),
    )

    /**
     * 「点正文 `#标签`」弹出的浮层（rev173.96 · 用户口径：浮层里点一篇 → 独立窗口打开）。
     * 与主区面板**共用同一份索引数据**，只是承载位置不同（`modal`）。
     */
    let peekTag = ''
    let peekNotes = []
    let peekLoading = false

    api.subscriptions.push(
      api.view.registerPanel({
        id: PEEK_ID,
        title: '标签',
        location: 'modal',
        render: () => peekNode({ tag: peekTag, notes: peekNotes, loading: peekLoading }),
      }),
    )

    /* 索引随时在变：保存 / 外部改动 / 删除 / 重建都会让标签与列表过期 */
    for (const topic of [
      'note:saved',
      'note:changed',
      'note:deleted',
      'note:renamed',
      'index:rebuilt',
    ]) {
      api.subscriptions.push(api.event.on(topic, markDirty))
    }

    /**
     * 打开面板（命令面板 / 手机 ☰ 菜单里的入口）。
     * `core.panel.<id>` 由内核**为每个面板**注册，但要等插件加载后的下一次 React 提交
     * 才存在 ⇒ 冷启动时先重试几次（doc-reader 同样做法，rev173.84）。
     */
    async function openPanel(id = PANEL_ID) {
      ensureStarted()
      for (let i = 0; i < 5; i++) {
        try {
          await api.command.execute(`core.panel.${id}`)
          return
        } catch (e) {
          if (i === 4) throw e
          await new Promise((r) => setTimeout(r, 120))
        }
      }
    }

    /**
     * 点标签 → 先开浮层（显示"正在读取"），再查索引补列表 ——
     * 查询是异步的，先开面板才不会"点了没反应"。
     */
    async function showPeek(tag) {
      peekTag = tag
      peekNotes = []
      peekLoading = true
      await openPanel(PEEK_ID)
      try {
        let hits = await api.index.query('', { tag })
        // 索引还是空的（刚启动）⇒ 扫一遍再查，否则用户看到"0 篇"以为是空的
        if (hits.length === 0 && !rebuiltOnce) {
          rebuiltOnce = true
          await api.index.rebuild()
          hits = await api.index.query('', { tag })
        }
        peekNotes = toNoteRows(hits)
      } catch (e) {
        api.host.notify(`读取标签「${tag}」失败：${String(e)}`, 'error')
      } finally {
        peekLoading = false
        api.view.refresh(PEEK_ID)
      }
    }

    /** 正文里的 `#标签` 变成可点（着色 + 悬停提示）；点击走上面那条命令 */
    api.subscriptions.push(
      api.editor.addMark({
        id: 'hashtag',
        pattern: TAG_PATTERN,
        className: 'tag',
        onClick: 'tag-panel.show-for-tag',
        title: '点击看这个标签下的笔记',
      }),
    )

    api.subscriptions.push(
      api.command.register({
        /**
         * 点正文 `#标签` → 浮层。
         * 优先用 payload.text（mark 的整段文本），拿不到再用 `from` + 正文解析兜底。
         */
        id: 'tag-panel.show-for-tag',
        title: '标签：看这个标签下的笔记',
        run: async (payload) => {
          const text = String(payload?.text ?? '').trim()
          let tag = text.replace(/^#/, '').trim()
          if (!tag) {
            const from = Number(payload?.from)
            const doc = api.doc.active()
            if (doc && Number.isFinite(from)) tag = resolveTagAt(doc.content, from)
          }
          if (!tag) return
          await showPeek(tag)
        },
      }),
    )

    api.subscriptions.push(
      api.command.register({
        /**
         * 浮层里点一篇 → **独立窗口**（用户 2026-10-23：「点某一篇笔记就会直接打开这个笔记的独立窗口」）。
         * 桌面走 `core.openInNewWindow { path }`（rev173.96 才支持按路径）；
         * 手机没有多窗口 ⇒ 降级为当前编辑器打开，并明说（不静默失效）。
         */
        id: 'tag-panel.openInWindow',
        title: '标签：在那篇的独立窗口打开',
        run: async (payload) => {
          const path = String(payload?.path ?? '').trim()
          if (!path) return
          try {
            if (api.host.platform === 'android') {
              api.host.notify('手机不支持独立窗口 —— 已在主区打开', 'warn')
              await api.command.execute('core.openNote', { path })
            } else {
              await api.command.execute('core.openInNewWindow', { path })
            }
          } catch (e) {
            api.host.notify(`打不开「${path}」：${String(e)}`, 'error')
          }
          // 收掉浮层：动作做完了，别挡着主编辑器（rev173.96 新内核命令）
          try {
            await api.command.execute('core.closePanel')
          } catch {
            /* 老内核没有这条：浮层留着，用户自己点 X */
          }
        },
      }),
    )

    api.subscriptions.push(
      api.command.register({
        id: 'tag-panel.open',
        title: '标签：打开标签面板',
        run: () => openPanel(),
      }),
    )

    api.subscriptions.push(
      api.command.register({
        id: 'tag-panel.rebuild',
        title: '标签：重建索引',
        run: async () => {
          rebuiltOnce = true
          dirty = true
          loading = true
          status = '正在重建索引…'
          refresh()
          try {
            const r = await api.index.rebuild()
            status = `索引已重建：${r.count} 篇 / ${r.ms}ms`
          } catch (e) {
            status = `重建索引失败：${String(e)}`
          } finally {
            loading = false
            await loadTags(true)
          }
        },
      }),
    )

    api.subscriptions.push(
      api.command.register({
        /**
         * 点标签 → 列出该标签下的笔记。
         * 用命令而不是 `list.onClick`：`link` 能直接带 `payload.tag`，标签名里可能有
         * 空格 / 中文 / `#`，靠 index 反查太脆。
         */
        id: 'tag-panel.select',
        title: '标签：筛选这个标签',
        run: async (payload) => {
          const tag = String(payload?.tag ?? '').trim()
          if (!tag) return
          selected = tag
          loading = true
          status = ''
          refresh()
          try {
            await loadNotes(tag)
          } finally {
            loading = false
            refresh()
          }
        },
      }),
    )

    api.subscriptions.push(
      api.command.register({
        id: 'tag-panel.clear',
        title: '标签：取消筛选',
        run: () => {
          selected = ''
          notes = []
          status = ''
          refresh()
        },
      }),
    )

    api.subscriptions.push(
      api.command.register({
        /**
         * 点笔记标题 → 打开那篇（rev173.93 新增内核命令 `core.openNote`）。
         * 内核 `<173.93` 没有这条命令 ⇒ 明确提示，不静默失败（硬约束 4）。
         */
        id: 'tag-panel.openNote',
        title: '标签：打开该笔记',
        run: async (payload) => {
          const path = String(payload?.path ?? '').trim()
          if (!path) return
          try {
            await api.command.execute('core.openNote', { path })
          } catch (e) {
            api.host.notify(`打不开「${path}」：内核缺少 core.openNote（${String(e)}）`, 'error')
          }
        },
      }),
    )
  },
}
