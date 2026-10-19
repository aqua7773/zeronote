/**
 * 标签画廊 —— **展示案例**（2026-10-19 · rev173.28.2）
 *
 * 把两个已有能力连成一条闭环：
 *   ① `editor.addMark` —— 正文里的 `#标签` 着色、可点（editor-marks 里只弹提示）
 *   ② `index.query('', { tag })` —— 按标签筛笔记（tag-demo 里只跑命令）
 *
 * 链路：点标签 → 命令收到 `payload.text` → 重建索引 → 按标签查 → 面板列出一排笔记 → 点开
 *
 * 为什么不直接改 editor-marks：它是 `editor` 原语的**验收件**，改它等于把夹具变产品；
 * 这里单起一个插件，用的还是那两套公开接口 —— **想抄就直接抄这个文件**。
 *
 * 注意：如果同时装并启用了 `editor-marks`，两者会给 `#标签` 各挂一条点击命令
 * （演示时去设置里取消勾选 editor-marks 即可；两条命令都跑也不会出错，只是多一条提示）。
 */

const PANEL_ID = 'tag-showcase.gallery'

/** `#工作` / `# 工作` / 不带 # 的 `工作` → `工作`（纯函数，可单测） */
export function parseTag(text) {
  return String(text == null ? '' : text)
    .trim()
    .replace(/^#+\s*/, '')
    .trim()
}

/** 命中列表 → 面板行文案（纯函数，可单测） */
export function hitLabel(hit) {
  const title = String((hit && hit.title) || '').trim()
  const path = String((hit && hit.path) || '')
  return title || path || '（未命名）'
}

export default {
  apply(api) {
    /** 面板状态：`render` 是同步的，索引查询是异步的 ⇒ 先查好再存这里 */
    let state = { tag: '', hits: [], tags: [], ready: false }

    const refresh = () => {
      try {
        api.view.refresh(PANEL_ID)
      } catch {
        /* 面板还没注册时会抛；忽略 */
      }
    }

    /** 按标签查全库，结果塞进面板 */
    async function openTag(payload) {
      const tag = parseTag(payload && payload.text)
      if (!tag) return
      await api.index.rebuild()
      const hits = await api.index.query('', { tag })
      state = { ...state, tag, hits, ready: true }
      refresh()
      api.host.notify(`#${tag}：${hits.length} 篇 —— 打开 ☰ 菜单里的「标签画廊」看列表`)
    }

    /** 刷新标签统计（面板没数据时的入口） */
    async function refreshAll() {
      const r = await api.index.rebuild()
      const tags = await api.index.tags()
      state = { tag: '', hits: [], tags, ready: true }
      refresh()
      api.host.notify(
        `索引 ${r.count} 篇 / ${tags.length} 种标签：${
          tags
            .slice(0, 8)
            .map((t) => `#${t.tag}(${t.count})`)
            .join('、') || '（无）'
        }`,
      )
    }

    function render() {
      const { tag, hits, tags, ready } = state
      return {
        type: 'stack',
        gap: 'md',
        children: [
          { type: 'text', value: '标签画廊', variant: 'title' },
          {
            type: 'text',
            value: '在任意笔记里点一个 #标签，这里列出同标签的全部笔记；点条目直接打开。',
            variant: 'caption',
            tone: 'muted',
          },
          {
            type: 'row',
            align: 'center',
            wrap: true,
            gap: 'sm',
            children: [
              { type: 'button', label: '刷新标签统计', onClick: 'tag-showcase.refresh', variant: 'ghost' },
            ],
          },
          { type: 'divider' },
          ...(tag
            ? [
                { type: 'text', value: `#${tag} · ${hits.length} 篇` },
                {
                  type: 'list',
                  empty: '这个标签下没有笔记',
                  items: hits.map((h) => ({
                    key: h.path,
                    node: {
                      type: 'button',
                      label: hitLabel(h),
                      onClick: 'tag-showcase.open-note',
                      payload: { path: h.path },
                      variant: 'ghost',
                    },
                  })),
                },
              ]
            : tags.length
              ? [
                  { type: 'text', value: '全部标签（点一个查看）', variant: 'caption', tone: 'muted' },
                  {
                    type: 'row',
                    align: 'center',
                    wrap: true,
                    gap: 'sm',
                    children: tags.map((t) => ({
                      type: 'button',
                      label: `#${t.tag} (${t.count})`,
                      onClick: 'tag-showcase.open-tag',
                      payload: { text: `#${t.tag}` },
                      variant: 'ghost',
                    })),
                  },
                ]
              : [
                  {
                    type: 'text',
                    value: ready ? '还没有标签' : '打开一篇带 #标签 的笔记，点一下标签试试',
                    tone: 'muted',
                  },
                ]),
        ],
      }
    }

    api.subscriptions.push(
      // `#标签` —— 着色 + 可点。lookbehind 要求行首或空白，避免 URL 的 #fragment
      api.editor.addMark({
        id: 'showcase-tag',
        pattern: '(?<=^|\\s)#[^\\s#[\\]]{1,30}',
        className: 'tag',
        onClick: 'tag-showcase.open-tag',
        title: '点击查看同标签的笔记',
      }),
      api.command.register({
        id: 'tag-showcase.open-tag',
        title: '标签画廊：查看同标签笔记',
        run: (p) => openTag(p),
      }),
      api.command.register({
        id: 'tag-showcase.open-note',
        title: '标签画廊：打开一篇笔记',
        run: async (p) => {
          if (p && p.path) await api.doc.open(p.path)
        },
      }),
      api.command.register({
        id: 'tag-showcase.refresh',
        title: '标签画廊：刷新标签统计',
        run: () => refreshAll(),
      }),
      api.view.registerPanel({
        id: PANEL_ID,
        title: '标签画廊',
        location: 'main',
        render,
      }),
    )
  },
}
