/**
 * AI 管家（0.1.0 · rev173.196）—— 骨架 + 设置页
 *
 * 这一刀只做三件事：
 *   ① 注册主区面板「AI」（对话区先占位，rev197 接模型）
 *   ② 设置：服务商 / 模型名 / 自有端点 / API Key
 *   ③ 测试连接：GET `{baseUrl}/models`，把 status 与响应原文摊开
 *
 * ## 为什么 Key 不进 `store`
 * `store` 落库（`<库>/.zn/...`），而库会被同步插件、备份插件搬到云端与备份包里。
 * API Key 走 `ctx.host.secrets` → Rust 的 keyring-store（Windows 凭据管理器 /
 * Android Keystore），**不入库、不随同步走、不进出包** —— 与 `security` 插件
 * 存本机 id 是同一套机制（契约 `HostApi.secrets`）。
 *
 * ## 为什么测试连接走 `ctx.net.fetch` 而不是浏览器 `fetch`
 * 浏览器 `fetch` 要过 CORS + CSP 两道；失败时插件只看得到一句
 * `TypeError: Failed to fetch`，**分不清是被谁拦的**（见 `examples/net-demo` 的教训）。
 * `net.fetch` 由 Rust 侧发出，没有 CORS 这回事，状态码与响应原样带回。
 * 真流式对话（rev197）才需要浏览器 `fetch`（读 SSE），届时按需降级。
 *
 * ## 配置存在哪
 * | 项 | 位置 | 换库会怎样 |
 * |---|---|---|
 * | 服务商 / 模型 / 端点 | `store`（键 `config`） | 跟着库走 |
 * | API Key | keyring（账号 `ai.api-key.<provider>`） | **不跟**（换库仍可用，各设备各配一次） |
 */

const PANEL_ID = 'ai.chat'

/** 服务商预设。baseUrl 按 OpenAI 兼容格式拼（`/chat/completions`、`/models`） */
const PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  },
  {
    id: 'kimi',
    name: 'Kimi（月之暗面）',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-latest',
  },
  {
    id: 'qwen',
    name: '通义千问（兼容模式）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  {
    id: 'custom',
    name: '自定义（OpenAI 兼容端点）',
    baseUrl: '',
    model: '',
  },
]

const DEFAULT_PROVIDER = 'deepseek'

/** 发给模型的上下文窗口（条）· 需求 Q38 */
export const CONTEXT_WINDOW = 20

/** 一次回复里最多允许几步工具调用（需求 Q28「现场判断」的上限） */
export const MAX_TOOL_STEPS = 4

/**
 * 只读工具（rev198）。
 *
 * 都是「查」：不移动、不写盘、不删。写工具在 rev199，届时每个写操作都要过预览确认。
 * 参数用 JSON Schema —— 模型靠它决定调什么、传什么。
 */
export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_dirs',
      description: '列出笔记库里的全部文件夹（库内相对路径，/ 分隔）',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_notes',
      description: '列出笔记，返回路径与标题（默认全库，可按目录过滤）',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: '只列这个目录下的笔记（库内相对路径，留空 = 全库）' },
          limit: { type: 'integer', description: '最多返回几条，默认 100' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_note',
      description: '读一篇笔记的全文（超过 8000 字会截断）',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '笔记的库内相对路径，例如 工作/周报.md' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_notes',
      description: '全文搜索笔记（空格分隔的多关键词按 AND 匹配），返回路径、标题与命中片段',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: '关键词' },
          tag: { type: 'string', description: '只返回带这个标签的笔记' },
          dir: { type: 'string', description: '只在这个目录（含子目录）下搜' },
          limit: { type: 'integer', description: '最多几条，默认 20' },
        },
        required: ['q'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tags',
      description: '列出库里所有标签及各自笔记数（按数量降序）',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
]

/**
 * 从一段 SSE 缓冲里解析出所有增量。
 *
 * 纯函数：不碰网络、不碰状态（`tests/ai.test.ts` 覆盖半包 / 多事件 / [DONE] / 坏行）。
 * 返回 `{ deltas, toolDeltas, done, rest }`：
 * · `deltas` —— 正文增量（`choices[0].delta.content`）
 * · `toolDeltas` —— 工具调用增量（`choices[0].delta.tool_calls[]`，**参数是分片来的**，调用方要按 index 累积）
 * · `rest` —— **最后一行可能不完整**的尾巴，调用方必须拼回下一段缓冲，否则长回复会在 chunk 边界丢字
 */
export function parseSseBuffer(buf) {
  const deltas = []
  const toolDeltas = []
  let done = false
  const parts = String(buf ?? '').split('\n')
  const rest = parts.pop() ?? ''
  for (const raw of parts) {
    const line = raw.trim()
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload) continue
    if (payload === '[DONE]') {
      done = true
      continue
    }
    try {
      const j = JSON.parse(payload)
      const ch = j?.choices?.[0]
      const d = ch?.delta?.content
      if (typeof d === 'string' && d) deltas.push(d)
      if (Array.isArray(ch?.delta?.tool_calls)) {
        for (const tc of ch.delta.tool_calls) {
          if (!tc || typeof tc !== 'object') continue
          toolDeltas.push({
            index: Number.isInteger(tc.index) ? tc.index : 0,
            id: tc.id,
            name: tc.function?.name,
            args: tc.function?.arguments,
          })
        }
      }
    } catch {
      /* 半包 / 非 JSON 行：跳过（下一轮会重新拼） */
    }
  }
  return { deltas, toolDeltas, done, rest }
}

/**
 * 按 `index` 累积工具调用分片（纯函数，原地改 `state` 并返回它）。
 *
 * OpenAI 兼容接口把一次工具调用的 `arguments` **切成多片**发（{"path":… 可能断在任意位置），
 * 所以只能字符串拼接，不能每片各自 JSON.parse。`name` 一般只给一次，但也按拼接处理。
 */
export function accumulateToolCalls(state, toolDeltas) {
  const out = state ?? {}
  for (const d of Array.isArray(toolDeltas) ? toolDeltas : []) {
    const i = Number.isInteger(d?.index) ? d.index : 0
    const cur = out[i] ?? (out[i] = { id: '', name: '', arguments: '' })
    if (d.id) cur.id = d.id
    if (d.name) cur.name += d.name
    if (d.args) cur.arguments += d.args
  }
  return out
}

/** 工具调用分片收尾：丢掉没有 name 的残片；有些服务商不回 id，补一个（回灌 tool 消息要它） */
export function finalizeToolCalls(state) {
  return Object.values(state ?? {})
    .filter((t) => t && t.name)
    .map((t) => ({
      id: t.id || `call_${Math.random().toString(36).slice(2, 10)}`,
      name: t.name,
      arguments: t.arguments || '',
    }))
}

/** 只保留最近 N 条（纯函数）· 首条若是 assistant 也允许 —— 模型能接受 */
export function windowMessages(list, n = CONTEXT_WINDOW) {
  return (Array.isArray(list) ? list : [])
    .slice(-n)
    .map((m) => ({ role: m.role, content: String(m.content ?? '') }))
}


/** @type {import('../../src/kernel/contract').Plugin} */
export default {
  apply(ctx) {
    const { command, view, host, store, net, fs, index, subscriptions } = ctx

    /** 配置（落 store） */
    let cfg = { provider: DEFAULT_PROVIDER, model: '', baseUrl: '' }
    /** API Key 状态：unknown（读不出来）/ set / missing */
    let keyState = 'unknown'
    let busy = false
    /** 最近一次测试结果 { ok, text, detail } */
    let result = null
    let loadError = ''

    /** 对话消息（持久化到 store 的 `history`） */
    let messages = []
    let streaming = false
    let streamError = ''
    /** @type {AbortController | null} */
    let abortCtrl = null
    /** 流式回复的节流刷新计时器（80ms 一次，不逐字重排整个面板） */
    let refreshTimer = 0

    const providerOf = (id) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]
    const accountOf = (id) => `ai.api-key.${id}`
    const trimBase = (s) => String(s || '').trim().replace(/\/+$/, '')
    const effectiveBase = () => trimBase(cfg.baseUrl || providerOf(cfg.provider).baseUrl)
    const effectiveModel = () => cfg.model || providerOf(cfg.provider).model

    const refresh = () => {
      try {
        view.refresh(PANEL_ID)
      } catch {
        /* 面板还没注册好 / 已被卸载 —— 刷新失败不该冒泡 */
      }
    }

    /** 流式增量：80ms 合并一次重渲染（逐字刷整个面板会很卡） */
    const scheduleRefresh = () => {
      if (refreshTimer) return
      refreshTimer = setTimeout(() => {
        refreshTimer = 0
        refresh()
      }, 80)
    }

    async function readKeyState() {
      try {
        const v = await host.secrets.get(accountOf(cfg.provider))
        keyState = v ? 'set' : 'missing'
      } catch (e) {
        keyState = 'unknown'
        host.log('warn', `读 API Key 失败：${String(e)}`)
      }
    }

    async function load() {
      try {
        const saved = await store.get('config', null)
        if (saved && typeof saved === 'object') {
          cfg = {
            provider: String(saved.provider || DEFAULT_PROVIDER),
            model: String(saved.model || ''),
            baseUrl: String(saved.baseUrl || ''),
          }
        }
      } catch (e) {
        loadError = `读配置失败：${String(e)}`
      }
      await readKeyState()
      await loadHistory()
      refresh()
    }

    async function saveConfig() {
      try {
        await store.set('config', { provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl })
      } catch (e) {
        result = { ok: false, text: '保存配置失败', detail: String(e) }
      }
    }

    /** 一次最小连通性检查：GET {base}/models */
    async function testConnection() {
      if (busy) return
      const base = effectiveBase()
      if (!base) {
        result = { ok: false, text: '还没有端点地址 —— 先选服务商或填自有端点', detail: '' }
        refresh()
        return
      }
      busy = true
      result = { ok: true, text: `正在连接 ${base} …`, detail: '' }
      refresh()
      try {
        const key = await host.secrets.get(accountOf(cfg.provider))
        if (!key) throw new Error('还没有保存 API Key（先在上面填，再点保存）')
        const res = await net.fetch({
          url: `${base}/models`,
          method: 'GET',
          headers: { authorization: `Bearer ${key}` },
          timeoutMs: 20000,
        })
        const body = res.text()
        if (res.status === 200) {
          result = { ok: true, text: `连接成功（HTTP 200 · ${base}）`, detail: '' }
        } else if (res.status === 401 || res.status === 403) {
          result = {
            ok: false,
            text: `API Key 被拒（HTTP ${res.status}）`,
            detail: body.slice(0, 400),
          }
        } else if (res.status === 404) {
          result = {
            ok: false,
            text: '端点不存在（HTTP 404）—— 检查「自有端点」是否少写或多写了 /v1',
            detail: body.slice(0, 400),
          }
        } else {
          result = { ok: false, text: `服务端回 HTTP ${res.status}`, detail: body.slice(0, 400) }
        }
      } catch (e) {
        result = { ok: false, text: '请求失败', detail: String(e?.message ?? e) }
      } finally {
        busy = false
        refresh()
      }
    }

    /* ───────── 对话 ───────── */

    async function loadHistory() {
      try {
        const h = await store.get('history', [])
        if (Array.isArray(h)) {
          messages = h
            .filter(
              (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
            )
            .slice(-40)
        }
      } catch (e) {
        host.log('warn', `读对话历史失败：${String(e)}`)
      }
    }

    async function saveHistory() {
      try {
        await store.set('history', messages.slice(-40))
      } catch (e) {
        host.log('warn', `存对话历史失败：${String(e)}`)
      }
    }

    /**
     * 流式请求：走**浏览器 fetch**（要服务商回 CORS 头；DeepSeek 预检实测允许）。
     * 失败（CORS / 网络 / 不支持流）由调用方降级 `nonStreamChat`。
     */
    /* ───────── 工具（只读 · rev198） ───────── */

    /**
     * 执行一个只读工具，返回**给模型看**的字符串。
     *
     * 失败也以 `throw` 出去、由调用方包成 `错误：…` 回灌 —— 模型看到错误能自己换参数重试，
     * 而不是整个对话崩掉（这与「静默失效比报错危险」同向）。
     */
    async function runTool(name, args) {
      const a = args && typeof args === 'object' ? args : {}
      if (name === 'list_dirs') {
        const dirs = await fs.listDirs()
        return JSON.stringify({ count: dirs.length, dirs: dirs.slice(0, 200) })
      }
      if (name === 'list_notes') {
        const dir = typeof a.dir === 'string' && a.dir.trim() ? a.dir.trim() : undefined
        const all = await fs.listNotes(dir)
        const limit = Math.min(Math.max(Number(a.limit) || 100, 1), 200)
        const notes = all.slice(0, limit).map((n) => ({ path: n.path, title: n.title }))
        return JSON.stringify({ total: all.length, returned: notes.length, notes })
      }
      if (name === 'read_note') {
        const p = String(a.path || '').trim()
        if (!p) throw new Error('缺少 path 参数')
        const text = await fs.readText(p)
        const cut = text.slice(0, 8000)
        return cut.length < text.length
          ? `${cut}\n\n[已截断：原文 ${text.length} 字符，只给了前 8000]`
          : cut
      }
      if (name === 'search_notes') {
        const q = String(a.q || '').trim()
        if (!q) throw new Error('缺少 q 参数')
        const hits = await index.query(q, {
          limit: Math.min(Math.max(Number(a.limit) || 20, 1), 50),
          dir: typeof a.dir === 'string' && a.dir.trim() ? a.dir.trim() : undefined,
          tag: typeof a.tag === 'string' && a.tag.trim() ? a.tag.trim() : undefined,
        })
        return JSON.stringify({
          count: hits.length,
          hits: hits.map((h) => ({
            path: h.path,
            title: h.title,
            excerpt: h.excerpt.slice(0, 200),
          })),
        })
      }
      if (name === 'list_tags') {
        const tags = await index.tags()
        return JSON.stringify({ count: tags.length, tags: tags.slice(0, 100) })
      }
      throw new Error(`未知工具：${name}`)
    }

    /** 模型给的参数可能是空串或坏 JSON —— 坏 JSON 要报出来（静默当成 {} 会调错工具） */
    function parseArgs(raw) {
      const s = String(raw ?? '').trim()
      if (!s) return {}
      try {
        return JSON.parse(s)
      } catch {
        throw new Error(`工具参数不是合法 JSON：${s.slice(0, 120)}`)
      }
    }

    /** 步骤流里显示的一行摘要 */
    function summarize(s) {
      const t = String(s ?? '').replace(/\s+/g, ' ')
      return t.length > 80 ? `${t.slice(0, 80)}…` : t
    }

    /* ───────── 模型调用 ───────── */

    /** 流式：返回 `{ content, toolCalls }`；正文增量走 `onDelta` 实时上屏 */
    async function streamChat(body, signal, onDelta) {
      const res = await fetch(`${body.base}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${body.key}`,
        },
        body: JSON.stringify({
          model: body.model,
          messages: body.messages,
          tools: TOOLS,
          stream: true,
        }),
        signal,
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`HTTP ${res.status}：${text.slice(0, 300)}`)
      }
      if (!res.body) throw new Error('这个环境拿不到响应流（不支持流式）')
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let content = ''
      const toolState = {}
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parsed = parseSseBuffer(buf)
        buf = parsed.rest
        for (const d of parsed.deltas) {
          content += d
          onDelta(d)
        }
        accumulateToolCalls(toolState, parsed.toolDeltas)
        if (parsed.done) break
      }
      return { content, toolCalls: finalizeToolCalls(toolState) }
    }

    /** 非流式（降级）：Rust 侧发出，没有 CORS 这回事，但只能整段返回 */
    async function nonStreamChat(body) {
      const res = await net.fetch({
        url: `${body.base}/chat/completions`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${body.key}`,
        },
        body: JSON.stringify({ model: body.model, messages: body.messages, tools: TOOLS }),
        timeoutMs: 60000,
      })
      const text = res.text()
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`HTTP ${res.status}：${text.slice(0, 300)}`)
      }
      const j = JSON.parse(text)
      const msg = j?.choices?.[0]?.message ?? {}
      const content = typeof msg.content === 'string' ? msg.content : ''
      const toolCalls = Array.isArray(msg.tool_calls)
        ? msg.tool_calls
            .filter((t) => t?.function?.name)
            .map((t) => ({
              id: String(t.id || ''),
              name: String(t.function.name),
              arguments: String(t.function.arguments || ''),
            }))
        : []
      return { content, toolCalls }
    }

    async function sendMessage(raw) {
      if (streaming) return
      const text = String(raw ?? '').trim()
      if (!text) return
      if (keyState !== 'set') {
        streamError = '还没有保存 API Key —— 在下面的设置区填好再说话'
        refresh()
        return
      }
      const base = effectiveBase()
      const model = effectiveModel()
      if (!base || !model) {
        streamError = '服务商或模型名没配好'
        refresh()
        return
      }

      messages.push({ role: 'user', content: text })
      /** UI 侧消息（带 steps）；发给模型的序列另存 `api` */
      const asst = { role: 'assistant', content: '', steps: [] }
      messages.push(asst)
      streaming = true
      streamError = ''
      try {
        view.setState('ai.input', '')
      } catch {
        /* 输入框可能已卸载 */
      }
      refresh()

      let key = null
      try {
        key = await host.secrets.get(accountOf(cfg.provider))
      } catch (e) {
        streamError = `读 Key 失败：${String(e?.message ?? e)}`
      }

      if (key) {
        const ctrl = new AbortController()
        abortCtrl = ctrl
        /** 发给模型的序列：历史（去掉 tool 中间态）+ 本次 user */
        const api = windowMessages(messages.slice(0, -1))
        let streamed = ''
        const onDelta = (d) => {
          streamed += d
          asst.content += d
          scheduleRefresh()
        }
        try {
          for (let step = 0; step < MAX_TOOL_STEPS; step++) {
            let r
            try {
              r = await streamChat({ base, model, key, messages: api }, ctrl.signal, onDelta)
            } catch (e) {
              if (e?.name === 'AbortError') throw e
              if (streamed) throw e // 已经出字：按「流中断」处理，不降级（否则会重复）
              r = await nonStreamChat({ base, model, key, messages: api })
              if (r.content) {
                streamed += r.content
                asst.content += r.content
                refresh()
              }
            }
            if (!r.toolCalls.length) break

            // 回传 assistant 的 tool_calls（OpenAI 协议要求下一轮能看到它要什么）
            api.push({
              role: 'assistant',
              content: r.content || null,
              tool_calls: r.toolCalls.map((t) => ({
                id: t.id,
                type: 'function',
                function: { name: t.name, arguments: t.arguments },
              })),
            })
            for (const tc of r.toolCalls) {
              const log = { name: tc.name, args: tc.arguments, ok: true, text: '', ms: 0 }
              const t0 = Date.now()
              let out = ''
              try {
                out = await runTool(tc.name, parseArgs(tc.arguments))
                log.text = summarize(out)
              } catch (e) {
                log.ok = false
                out = `错误：${String(e?.message ?? e)}`
                log.text = String(e?.message ?? e)
              }
              log.ms = Date.now() - t0
              asst.steps.push(log)
              api.push({ role: 'tool', tool_call_id: tc.id, content: out })
              scheduleRefresh()
            }
            if (step === MAX_TOOL_STEPS - 1) {
              streamError = `工具调用超过 ${MAX_TOOL_STEPS} 步，先停在这里`
            }
          }
        } catch (e) {
          if (e?.name === 'AbortError') streamError = '已停止'
          else streamError = `发送失败：${String(e?.message ?? e)}`
          if (!asst.content && !asst.steps.length) messages.pop()
        } finally {
          abortCtrl = null
        }
      } else {
        messages.pop()
      }

      streaming = false
      if (!asst.content && !streamError) streamError = '模型没有返回内容'
      refresh()
      void saveHistory()
    }

    /* ───────── 面板 ───────── */

    /**
     * 对话区节点。
     *
     * 用声明式 UINode 而不是 `mount`：rev197 只要消息列表 + 输入框，
     * `markdown` 节点已经能渲染模型回复。流式靠 80ms 节流重渲染。
     */
    function chatSection(ready) {
      if (!ready) {
        return [
          {
            type: 'text',
            value: '配好服务商与 API Key 之后，这里就是对话框。',
            variant: 'caption',
            tone: 'muted',
          },
        ]
      }
      /** @type {import('../../src/kernel/contract').UINode[]} */
      const nodes = []
      if (!messages.length) {
        nodes.push({
          type: 'text',
          value: '先聊两句试试。工具（列文件夹 / 搜索 / 移动笔记）在 rev198–199 接上。',
          variant: 'caption',
          tone: 'muted',
        })
      } else {
        for (const m of messages) {
          if (m.role === 'user') {
            nodes.push({
              type: 'field',
              label: '你',
              children: { type: 'text', value: m.content },
            })
          } else {
            nodes.push({
              type: 'markdown',
              value: m.content || (streaming ? '…' : '（空回复）'),
            })
            // 步骤流：这一轮调了哪些工具、用了多久、结果摘要
            if (Array.isArray(m.steps) && m.steps.length) {
              nodes.push({
                type: 'list',
                items: m.steps.map((s) => ({
                  type: 'text',
                  value: `${s.ok ? '✓' : '✗'} ${s.name} · ${s.ms} ms · ${s.text}`,
                  variant: 'caption',
                  tone: s.ok ? 'muted' : 'danger',
                })),
              })
            }
          }
        }
      }
      if (streamError) {
        nodes.push({ type: 'text', value: streamError, variant: 'caption', tone: 'danger' })
      }
      nodes.push({
        type: 'textarea',
        bind: 'ai.input',
        // 内核的多行框：裸 Enter 是换行，**Ctrl/Cmd+Enter** 才提交（UIRenderer textarea 分支）
        placeholder: '说点什么…（Ctrl+Enter 发送，或点「发送」）',
        rows: 3,
        onSubmit: 'ai.send',
      })
      nodes.push({
        type: 'row',
        align: 'center',
        gap: 'sm',
        children: streaming
          ? [{ type: 'button', label: '停止', onClick: 'ai.stop' }]
          : [
              { type: 'button', label: '发送', onClick: 'ai.send', send: 'ai.input' },
              { type: 'button', label: '新对话', variant: 'ghost', onClick: 'ai.clear' },
            ],
      })
      return nodes
    }

    function renderPanel() {
      const p = providerOf(cfg.provider)
      const base = effectiveBase()
      const model = effectiveModel()
      const keyText =
        keyState === 'set' ? '已保存' : keyState === 'missing' ? '未保存' : '读不出来（keyring 不可用？）'
      const ready = Boolean(base && model && keyState === 'set')

      /** @type {import('../../src/kernel/contract').UINode[]} */
      const children = [
        {
          type: 'row',
          align: 'center',
          wrap: true,
          gap: 'sm',
          children: [
            { type: 'text', value: 'AI 管家', variant: 'title' },
            {
              type: 'badge',
              text: ready ? '已配置' : '未完成配置',
              tone: ready ? 'success' : 'warning',
            },
            {
              type: 'text',
              value: ready ? `${p.name} · ${model}` : '配完才能对话',
              variant: 'caption',
              tone: 'muted',
            },
          ],
        },
        {
          type: 'text',
          value:
            'API Key 存在系统凭据管理器里（Windows 凭据管理器 / Android Keystore），不写进笔记库、不随同步走。',
          variant: 'caption',
          tone: 'muted',
        },
        ...(loadError
          ? [{ type: 'text', value: loadError, variant: 'caption', tone: 'danger' }]
          : []),
        { type: 'divider' },

        /* 对话区 */
        ...chatSection(ready),

        { type: 'divider' },

        /* 服务商 */
        {
          type: 'field',
          label: '服务商',
          hint: '自定义 = 任何 OpenAI 兼容端点（LiteLLM / one-api / vLLM 都行）',
          children: {
            type: 'select',
            bind: 'ai.provider',
            options: [p, ...PROVIDERS.filter((x) => x.id !== p.id)].map((x) => ({
              value: x.id,
              label: x.name,
            })),
            onSubmit: 'ai.set-provider',
          },
        },

        /* 自有端点（只有自定义时显示） */
        ...(cfg.provider === 'custom'
          ? [
              {
                type: 'field',
                label: '端点地址',
                hint: '例如 https://api.example.com/v1 —— 不带 /chat/completions',
                children: {
                  type: 'stack',
                  gap: 'sm',
                  children: [
                    {
                      type: 'input',
                      bind: 'ai.baseurl',
                      placeholder: 'https://api.example.com/v1',
                      onSubmit: 'ai.save-baseurl',
                    },
                    {
                      type: 'button',
                      label: '保存端点',
                      variant: 'ghost',
                      onClick: 'ai.save-baseurl',
                      send: 'ai.baseurl',
                    },
                  ],
                },
              },
            ]
          : []),

        /* 模型名 */
        {
          type: 'field',
          label: '模型名',
          hint: `留空则用默认：${p.model || '（自定义服务商没有默认）'}`,
          children: {
            type: 'stack',
            gap: 'sm',
            children: [
              {
                type: 'input',
                bind: 'ai.model',
                placeholder: p.model || '例如 deepseek-chat',
                onSubmit: 'ai.save-model',
              },
              {
                type: 'button',
                label: '保存模型',
                variant: 'ghost',
                onClick: 'ai.save-model',
                send: 'ai.model',
              },
            ],
          },
        },

        /* API Key */
        {
          type: 'field',
          label: 'API Key',
          hint: `当前：${keyText} · 保存后写入系统凭据库`,
          children: {
            type: 'stack',
            gap: 'sm',
            children: [
              { type: 'input', bind: 'ai.key', placeholder: 'sk-…', secret: true, onSubmit: 'ai.save-key' },
              {
                type: 'row',
                align: 'center',
                gap: 'sm',
                children: [
                  {
                    type: 'button',
                    label: '保存 Key',
                    onClick: 'ai.save-key',
                    send: 'ai.key',
                  },
                  { type: 'button', label: '删除 Key', variant: 'ghost', onClick: 'ai.clear-key' },
                ],
              },
            ],
          },
        },

        { type: 'divider' },

        /* 测试连接 */
        {
          type: 'row',
          align: 'center',
          wrap: true,
          gap: 'sm',
          children: [
            { type: 'button', label: busy ? '连接中…' : '测试连接', onClick: 'ai.test' },
            { type: 'text', value: base || '（还没有端点）', variant: 'caption', tone: 'muted' },
          ],
        },
        ...(result
          ? [
              {
                type: 'text',
                value: result.text,
                variant: 'caption',
                tone: result.ok ? 'success' : 'danger',
              },
            ]
          : []),
        ...(result?.detail
          ? [{ type: 'code', value: result.detail, lang: 'text' }]
          : []),

        { type: 'divider' },

        /* 下一步占位 */
        {
          type: 'text',
          value: ready
            ? '对话已可用。工具（列文件夹 / 搜索 / 读笔记 / 移动）在 rev198–199 接上。'
            : '配好服务商与 API Key 之后就能对话。',
          variant: 'caption',
          tone: 'muted',
        },
      ]

      return { type: 'stack', gap: 'md', children }
    }

    /* ───────── 注册 ───────── */

    subscriptions.push(
      view.registerPanel({
        id: PANEL_ID,
        title: 'AI',
        location: 'main',
        render: () => renderPanel(),
      }),
    )

    subscriptions.push(
      command.register({
        id: 'ai.open',
        title: 'AI：打开对话',
        run: async () => {
          // 内核给每个已注册面板生成 `core.panel.<id>`；面板可能还在挂载中，重试几次
          for (let i = 0; i < 5; i++) {
            try {
              await command.execute(`core.panel.${PANEL_ID}`)
              return
            } catch (e) {
              if (i === 4) throw e
              await new Promise((r) => setTimeout(r, 120))
            }
          }
        },
      }),
    )

    subscriptions.push(
      command.register({
        id: 'ai.set-provider',
        title: 'AI：切换服务商',
        run: async (payload) => {
          const id = String(payload?.value || '').trim()
          if (!PROVIDERS.some((x) => x.id === id)) return
          cfg.provider = id
          // 换服务商时清空模型名，回到该服务商的默认（自定义除外）
          cfg.model = ''
          if (id !== 'custom') cfg.baseUrl = ''
          await saveConfig()
          await readKeyState()
          result = null
          refresh()
        },
      }),
    )

    subscriptions.push(
      command.register({
        id: 'ai.save-model',
        title: 'AI：保存模型名',
        run: async (payload) => {
          cfg.model = String(payload?.value || '').trim()
          await saveConfig()
          result = null
          refresh()
        },
      }),
    )

    subscriptions.push(
      command.register({
        id: 'ai.save-baseurl',
        title: 'AI：保存自有端点',
        run: async (payload) => {
          const v = trimBase(payload?.value)
          if (!/^https?:\/\//i.test(v)) {
            result = { ok: false, text: '端点必须以 http:// 或 https:// 开头', detail: v }
            refresh()
            return
          }
          cfg.baseUrl = v
          await saveConfig()
          result = null
          refresh()
        },
      }),
    )

    subscriptions.push(
      command.register({
        id: 'ai.save-key',
        title: 'AI：保存 API Key',
        run: async (payload) => {
          const v = String(payload?.value || '').trim()
          if (!v) {
            result = { ok: false, text: '输入框是空的 —— 先粘贴 Key 再点保存', detail: '' }
            refresh()
            return
          }
          try {
            await host.secrets.set(accountOf(cfg.provider), v)
            keyState = 'set'
            result = { ok: true, text: `Key 已写入系统凭据库（${providerOf(cfg.provider).name}）`, detail: '' }
          } catch (e) {
            result = { ok: false, text: '写凭据库失败', detail: String(e?.message ?? e) }
          }
          refresh()
        },
      }),
    )

    subscriptions.push(
      command.register({
        id: 'ai.clear-key',
        title: 'AI：删除 API Key',
        run: async () => {
          try {
            await host.secrets.delete(accountOf(cfg.provider))
            keyState = 'missing'
            result = { ok: true, text: '已从系统凭据库删除', detail: '' }
          } catch (e) {
            result = { ok: false, text: '删除失败', detail: String(e?.message ?? e) }
          }
          refresh()
        },
      }),
    )

    subscriptions.push(
      command.register({
        id: 'ai.test',
        title: 'AI：测试连接',
        run: () => testConnection(),
      }),
    )

    subscriptions.push(
      command.register({
        id: 'ai.send',
        title: 'AI：发送消息',
        run: async (payload) => {
          await sendMessage(payload?.value)
        },
      }),
    )

    subscriptions.push(
      command.register({
        id: 'ai.stop',
        title: 'AI：停止生成',
        run: () => {
          abortCtrl?.abort()
        },
      }),
    )

    subscriptions.push(
      command.register({
        id: 'ai.clear',
        title: 'AI：新对话',
        run: async () => {
          if (streaming) abortCtrl?.abort()
          messages = []
          streamError = ''
          await saveHistory()
          refresh()
        },
      }),
    )

    // 定时器与进行中的请求不归宿主管，卸载时自己收尾（否则重载会留下孤儿流）
    subscriptions.push({
      dispose: () => {
        if (refreshTimer) clearTimeout(refreshTimer)
        refreshTimer = 0
        abortCtrl?.abort()
        abortCtrl = null
        streaming = false
      },
    })

    void load()
  },
}
