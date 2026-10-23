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
/** 输入框绑定键 —— 带插件前缀，面板 state 是全宿主共享的一张表 */
const FILTER_BIND = 'tag-panel.filter'
/** 标签列表缓存（规格：30 s）—— 期间靠事件置脏，不靠计时器轮询 */
const CACHE_MS = 30_000
/** 置脏后的合并延迟：等 `fs-events` 里那条没 await 的 `upsert` 落进索引 */
const DIRTY_DELAY_MS = 120
/** 摘要截断：列表里一行够看就行，全文在笔记里 */
const EXCERPT_MAX = 120

/* ───────────────────────── 纯函数（tests/tag-panel.test.ts 单测） ───────────────────────── */

/** 按篇数降序；同篇数按名字本地化排序（与内核 `tags()` 的规则一致，这里是防御 + 可测） */
export function sortTags(list) {
  return (Array.isArray(list) ? list : [])
    .map((t) => ({ tag: String(t?.tag ?? ''), count: Number(t?.count) || 0 }))
    .filter((t) => t.tag !== '')
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
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
    async function openPanel() {
      ensureStarted()
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
