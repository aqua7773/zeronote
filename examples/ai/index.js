/**
 * AI 管家（0.2.0 · rev173.196 → 173.199）
 *
 * 四刀：
 *   · rev196 骨架 + 设置页（服务商 / 模型 / Key 进系统凭据库 / 测试连接）
 *   · rev197 模型调用 + 流式对话（SSE 逐字 / 停止 / 历史存 store）
 *   · rev198 只读工具（list_dirs / list_notes / read_note / search_notes / list_tags）+ 工具循环 + 步骤流
 *   · rev199 写工具（本刀）：**可逆的直接做**（note.create / folder.create / tag.add / tag.remove），
 *     **不可逆的只生成提案**（note.write 出 diff 预览、note.move、note.trash），
 *     用户在面板点「采用 / 确认移动 / 确认删除」才落盘（需求 Q4 / Q11）
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
/** 任务面板（rev201）：任务列表 / 开关 / 立即跑 / 最近 10 次记录 */
const TASKS_PANEL_ID = 'ai.tasks'

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

  /* ── 写工具（rev199）──
   * 需求 Q4：**只对不可逆操作要确认**（删除 / 覆盖已有正文）；新建、建文件夹、打标签直接做。
   * 需要确认的三个工具**不会立刻落盘**，只生成 proposal，等用户在面板点「采用」。
   * 返回 `status: "pending"` 时**不要对用户说「已经改好了」** —— 那是撒谎。 */
  {
    type: 'function',
    function: {
      name: 'note_create',
      description: '新建一篇笔记。路径已存在会报错（不会覆盖，改写已有笔记请用 note_write）',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '库内相对路径，例如 工作/周报.md' },
          content: { type: 'string', description: '正文（可含 Markdown）' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'note_write',
      description:
        '改写一篇**已有**笔记的全文。不会立刻写盘：生成 diff 预览，用户在面板点「采用」后才生效。' +
        '返回 status=pending 表示等确认，不是已完成。一次只改一篇。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '库内相对路径' },
          content: { type: 'string', description: '**完整**新正文（整篇替换，不是补丁）' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'note_move',
      description:
        '移动 / 重命名一篇笔记。不会立刻执行，要用户在面板确认。to 可以是新路径，也可以是已存在的文件夹（自动拼上原文件名）。目标已存在会报错，不覆盖。',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: '源路径' },
          to: { type: 'string', description: '目标路径或目标文件夹' },
        },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'note_trash',
      description: '把一篇笔记移入回收站（可恢复）。不会立刻执行，要用户在面板确认。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '库内相对路径' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tag_add',
      description: '给一篇笔记加标签（写进 frontmatter，不动正文）。已有标签自动跳过。直接生效。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '库内相对路径' },
          tags: { type: 'array', items: { type: 'string' }, description: '要加的标签（不带 #）' },
        },
        required: ['path', 'tags'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tag_remove',
      description:
        '移除一篇笔记的标签（只删 frontmatter；正文里的 #标签 引用不会动，结果里会告知还剩几处）。直接生效。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '库内相对路径' },
          tags: { type: 'array', items: { type: 'string' }, description: '要删的标签（不带 #）' },
        },
        required: ['path', 'tags'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'folder_create',
      description: '新建文件夹（多级一起建，已存在不报错）。直接生效。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '库内相对路径，例如 工作/周报' } },
        required: ['path'],
      },
    },
  },

  /* ── 任务管理（rev201 · 需求 §3.2）──
   * 任务 = 用户用一句话定义的自动化规则；`trigger=save` 的会在**任何笔记被保存后**跑。 */
  {
    type: 'function',
    function: {
      name: 'task_create',
      description:
        '创建一个自动任务。**用户明确要求建任务时必须调用本工具**，不要只在回复里描述。' +
        '先用自然语言把规则写进 instruction。' +
        'trigger=save（保存笔记后跑）/ schedule（定时跑，要给 at）/ manual（只手动跑）。' +
        '动作固定、不需要看内容的活（打标签、移到某目录）请用 mode=fixed + steps，不调用模型、更便宜稳定；' +
        '需要按内容判断的（分类到哪个文件夹）用默认的 auto。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '任务名，例如「保存后自动分类」' },
          instruction: { type: 'string', description: '任务指令（自然语言，AI 每次按它执行）' },
          trigger: {
            type: 'string',
            enum: ['save', 'schedule', 'manual'],
            description: 'save = 保存后跑；schedule = 定时跑（配 at）；manual = 只手动跑',
          },
          dir: { type: 'string', description: 'save 触发时只在保存到这个文件夹（含子目录）才跑；留空 = 全库' },
          at: { type: 'string', description: 'schedule 的时间，HH:MM，例如 23:00' },
          days: {
            type: 'array',
            items: { type: 'integer' },
            description: 'schedule 的星期几（1=周一 … 7=周日）；留空 = 每天',
          },
          mode: {
            type: 'string',
            enum: ['auto', 'fixed'],
            description: 'auto = 每次让模型看内容自己决定（默认）；fixed = 按 steps 固定执行、不调模型',
          },
          steps: {
            type: 'array',
            description:
              'fixed 模式的工具调用序列（最多 4 步）。参数里可用占位符 {{path}}（触发它的那篇笔记路径）。',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: '工具名，例如 tag_add / note_move / folder_create' },
                args: { type: 'object', description: '工具参数（可用 {{path}} 占位符）' },
              },
              required: ['name'],
            },
          },
        },
        required: ['instruction'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_update',
      description: '修改任务：改名 / 改指令 / 开关 / 换触发方式',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '任务 id' },
          name: { type: 'string' },
          instruction: { type: 'string' },
          trigger: { type: 'string', enum: ['save', 'manual'] },
          dir: { type: 'string' },
          enabled: { type: 'boolean', description: 'false = 停用（保存后不再触发）' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_delete',
      description: '删除一个任务（只是删规则，不会撤销它以前的执行结果）',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_list',
      description: '列出全部任务（含开关状态、触发方式、最近一次失败）',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'task_run',
      description: '立即跑一次某个任务（入队，不阻塞对话；结果在任务面板的运行记录里）',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plugin_exec',
      description:
        '执行一条**用户已授权**的插件命令（例如打卡 habit.check / habit.backfill）。' +
        '设置页「允许 AI 调用的命令」里没勾选的命令会被拒绝；内核命令与 AI 自己的命令永远不开放。' +
        '参数按顺序放进 args 数组。不确定某个命令要什么参数时，先问用户或用只读工具查清楚。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '命令 id，例如 habit.check' },
          args: {
            type: 'array',
            items: {},
            description: '按顺序传给命令的参数（可省略）',
          },
        },
        required: ['command'],
      },
    },
  },
]

/* ───────────────── 插件命令白名单（rev173.208 · 第二版 plugin.exec） ───────────────── */

/**
 * 一条命令能不能被 AI 执行。
 *
 * 安全语义（2026-10-27 用户拍板：设置页勾选 + 自动任务里也允许，但仅限勾选过的）：
 * · **内核命令**（`core.*`）不开放 —— 那等于把内核交给模型；
 * · **AI 自己的命令**（`ai.*`）不开放 —— 防递归（plugin_exec 调 ai.* 再调 plugin_exec…）；
 * · 其余必须是用户显式勾选过的插件命令。
 */
export function isPluginCommandAllowed(id, allowed) {
  if (typeof id !== 'string') return false
  const cmd = id.trim()
  if (!cmd) return false
  if (cmd.startsWith('core.') || cmd.startsWith('ai.')) return false
  return (Array.isArray(allowed) ? allowed : []).includes(cmd)
}

/** 白名单落盘 / 读回时的清洗：去空、去内核与 AI 自身、去重（手改 store 或旧数据都可能带脏值） */
export function normalizeAllowedCommands(value) {
  const out = []
  for (const item of Array.isArray(value) ? value : []) {
    if (typeof item !== 'string') continue
    const s = item.trim()
    if (!s || s.startsWith('core.') || s.startsWith('ai.')) continue
    if (!out.includes(s)) out.push(s)
  }
  return out
}

/** 从 `command.list()` 的结果里挑出可授权的命令（内核与 AI 自己的不列） */
export function pickAllowableCommands(all) {
  const out = []
  for (const c of Array.isArray(all) ? all : []) {
    const id = String(c?.id ?? '').trim()
    if (!id || id.startsWith('core.') || id.startsWith('ai.')) continue
    out.push({ id, title: String(c?.title ?? id) })
  }
  return out
}

/**
 * 把命令按插件（id 的第一段）分组（rev173.210）。
 *
 * 本机 137 条一条条铺开会把面板撑成一面墙；分组后默认折叠，只展开用户想看的那一组。
 * 排序**不用 `localeCompare` 的默认行为**：CI 的 en-US 与本地 zh-CN 排序不同（rev173.154 踩过），
 * 这里按码点稳定排序，两边结果一致。
 */
export function groupCommands(list) {
  const groups = new Map()
  for (const c of Array.isArray(list) ? list : []) {
    const id = String(c?.id ?? '').trim()
    if (!id) continue
    const group = id.includes('.') ? id.slice(0, id.indexOf('.')) : id
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group).push({ id, title: String(c?.title ?? id) })
  }
  return [...groups.entries()]
    .map(([group, items]) => ({ group, items }))
    .sort((a, b) => (a.group < b.group ? -1 : a.group > b.group ? 1 : 0))
}

/** 分组标题：命令 title 的「前缀：」部分（「打卡：打卡」→「打卡」），取不到就用 id */
export function groupLabel(items, fallback) {
  const first = (Array.isArray(items) ? items : []).find((c) => typeof c?.title === 'string' && c.title.includes('：'))
  if (!first) return String(fallback ?? '')
  const head = first.title.split('：')[0].trim()
  return head || String(fallback ?? '')
}

/** 模型给的 args 归一化成位置参数（缺省 / null = 不传；非数组包成单参，不静默丢掉） */
export function argvOf(value) {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * 从一段 SSE 缓冲里解析出所有增量。
 *
 * 纯函数：不碰网络、不碰状态（`tests/ai.test.ts` 覆盖半包 / 多事件 / [DONE] / 坏行）。
 * 返回 `{ deltas, toolDeltas, usage, done, rest }`：
 * · `deltas` —— 正文增量（`choices[0].delta.content`）
 * · `toolDeltas` —— 工具调用增量（`choices[0].delta.tool_calls[]`，**参数是分片来的**，调用方要按 index 累积）
 * · `usage` —— token 用量（rev203；服务商一般只在最后一块给，没有就是 `null`）
 * · `rest` —— **最后一行可能不完整**的尾巴，调用方必须拼回下一段缓冲，否则长回复会在 chunk 边界丢字
 */
export function parseSseBuffer(buf) {
  const deltas = []
  const toolDeltas = []
  let usage = null
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
      const u = normalizeUsage(j?.usage)
      if (u) usage = u
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
  return { deltas, toolDeltas, usage, done, rest }
}

/* ───────────────── token 用量（rev173.203） ───────────────── */

/**
 * 把服务商回的 `usage` 规范成 `{ prompt, completion }`（都是整数）；拿不到返回 `null`。
 *
 * 为什么要 normalize：OpenAI 用 `prompt_tokens / completion_tokens`，
 * 少数兼容实现用 `input_tokens / output_tokens`；两套都认，别让统计静默变成 0。
 *
 * ⚠️ 还要认**自己输出的形状**（`prompt` / `completion`）—— 这个函数是幂等的：
 * `parseSseBuffer` 已经 normalize 过一次，`addUsage` 会再 normalize 一次。
 * 第一版没认这两个字段 ⇒ 流式那条路的统计**永远是 0 次**（实测踩到）。
 */
export function normalizeUsage(u) {
  if (!u || typeof u !== 'object') return null
  const prompt = Number(u.prompt_tokens ?? u.input_tokens ?? u.prompt ?? 0)
  const completion = Number(u.completion_tokens ?? u.output_tokens ?? u.completion ?? 0)
  if (!Number.isFinite(prompt) && !Number.isFinite(completion)) return null
  const p = Number.isFinite(prompt) ? prompt : 0
  const c = Number.isFinite(completion) ? completion : 0
  if (!p && !c) return null
  return { prompt: p, completion: c }
}

/** 累计器初值 */
export function emptyUsage() {
  return { calls: 0, prompt: 0, completion: 0, taskCalls: 0, taskPrompt: 0, taskCompletion: 0 }
}

/**
 * 累加一次调用（纯函数，返回新对象 —— 不原地改，面板能靠引用变化判断要不要重渲染）。
 * `isTask` ⇒ 同时记进「任务累计」那一列（任务与对话分开看，才知道钱花在哪）。
 */
export function addUsage(acc, u, isTask = false) {
  const base = { ...emptyUsage(), ...(acc && typeof acc === 'object' ? acc : {}) }
  const n = normalizeUsage(u)
  if (!n) return base
  return {
    ...base,
    calls: base.calls + 1,
    prompt: base.prompt + n.prompt,
    completion: base.completion + n.completion,
    taskCalls: base.taskCalls + (isTask ? 1 : 0),
    taskPrompt: base.taskPrompt + (isTask ? n.prompt : 0),
    taskCompletion: base.taskCompletion + (isTask ? n.completion : 0),
  }
}

/** token 数字的人话：`1234` → `1.2k` */
export function formatTokens(n) {
  const v = Number(n) || 0
  if (v < 1000) return String(v)
  if (v < 1000000) {
    const k = v / 1000
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}k`
  }
  return `${(v / 1000000).toFixed(1).replace(/\.0$/, '')}M`
}

/** 一行用量摘要：`12 次 · 输入 3.2k / 输出 1.1k` */
export function usageText(u) {
  const v = { ...emptyUsage(), ...(u && typeof u === 'object' ? u : {}) }
  if (!v.calls) return '还没调用过模型'
  return `${v.calls} 次 · 输入 ${formatTokens(v.prompt)} / 输出 ${formatTokens(v.completion)} tokens`
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

/**
 * 对话的 system 提示（rev173.209）。
 *
 * rev197–208 一直**没有** system 消息：模型只知道工具表，不知道「写工具只出提案」这条语义，
 * 于是实测两次出现「嘴上说建好了、其实没调工具」（207/208 都遇到；208 还编造了已删任务的旧 id）。
 * 这里把行为规则写死；历史里**不存** system（不显示、不落 store），每轮现拼。
 */
export const CHAT_SYSTEM_PROMPT = [
  '你是 ZeroNote 笔记应用里的笔记助手。',
  '',
  '规则：',
  '1. 用中文回复，简短直接；不要复述工具返回的原文，只给结论。',
  '2. 写工具（note_write / note_move / note_trash）只生成提案：返回 status=pending 时**还没有完成**，',
  '   必须告诉用户「等确认」，绝不能声称已经改好。',
  '3. 说「做好了」之前必须真的调用过对应工具，且工具返回成功；没调用就直说没做 —— 不要凭记忆或历史编造结果，尤其不要编任务 id。',
  '   回复的开头也不要先声称「已完成 / 已建好」再补充说明：没确认成功之前不要用完成语气。',
  '4. plugin_exec 只能执行用户授权过的命令；被拒绝时说明去哪授权，不要反复重试同一个命令。',
  '5. 用户已经给出关键参数（路径 / 范围 / 目标）时直接执行，不要反复确认；只有缺关键参数时才问一句。',
].join('\n')

/** 发给模型的完整消息序列：system 在首位 + 最近 N 条历史（纯函数，单测覆盖） */
export function buildChatMessages(history, system = CHAT_SYSTEM_PROMPT) {
  const msgs = windowMessages(history)
  return system ? [{ role: 'system', content: system }, ...msgs] : msgs
}

/* ───────────────── 写工具的纯函数（rev173.199 · 单测覆盖） ───────────────── */

/** 一行 diff 的类型（`same` 不打标记，`add`/`del` 带 +/−） */
/** @typedef {{ type: 'same' | 'add' | 'del', text: string }} DiffLine */

/** 超过这么多行就不做行级 diff（LCS 是 O(n·m)，8000×8000 会把面板卡住） */
export const DIFF_MAX_LINES = 2000
/** 中间段的行数乘积上限：超过就退化为「全删 + 全加」，不做最小编辑 */
export const DIFF_DP_LIMIT = 400
/** 面板里最多显示这么多行 diff */
export const DIFF_SHOW_LINES = 120

/**
 * 库内相对路径归一化（**安全边界在这里**，不是靠 Rust 兜）。
 *
 * 三条硬拒：空、含 `..`、任一段以 `.` 开头（`.zn` 是内核私有区，隐藏文件也不该被 AI 碰）。
 * 分隔符统一成 `/`（Windows 上模型经常回 `工作\周报.md`）。
 * 返回 `''` 表示不合法 —— 调用方必须当成错误，**不能当空路径继续跑**。
 */
export function normRel(raw) {
  const s = String(raw ?? '').trim().replace(/\\/g, '/')
  if (!s) return ''
  const parts = []
  for (const seg of s.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') return ''
    if (seg.startsWith('.')) return ''
    parts.push(seg)
  }
  return parts.join('/')
}

/** 笔记路径 = 归一化 + 补 `.md`（模型经常只给「工作/周报」） */
export function notePathOf(raw) {
  const p = normRel(raw)
  if (!p) return ''
  return /\.md$/i.test(p) ? p : `${p}.md`
}

/** 按行切开（统一换行）；空文本 = 0 行，而不是 ['' ] */
function splitLines(text) {
  const s = String(text ?? '')
  if (!s) return []
  return s.replace(/\r\n?/g, '\n').split('\n')
}

/** 行级 LCS diff（只在中间段调用，输入已剥掉公共前后缀） */
function lcsDiff(a, b) {
  const n = a.length
  const m = b.length
  const w = m + 1
  const dp = new Int32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j]
          ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
    }
  }
  /** @type {DiffLine[]} */
  const out = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      out.push({ type: 'del', text: a[i] })
      i++
    } else {
      out.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] })
  while (j < m) out.push({ type: 'add', text: b[j++] })
  return out
}

/**
 * 生成行级 diff（纯函数）。
 *
 * 返回 `{ lines, added, removed, same, tooLong, oldLines, newLines }`。
 * `tooLong` 为真时 `lines` 是空的 —— 调用方**不要**把它当成「没改动」，
 * 那时 `added/removed` 也是 0，只能按行数对比给用户一个提示。
 *
 * 为什么先剥公共前后缀：真实编辑几乎都是「改中间一段」，
 * 整篇 LCS 既慢又会让摘要里 `same` 行数爆掉。
 */
export function buildDiff(oldText, newText) {
  const a = splitLines(oldText)
  const b = splitLines(newText)
  if (a.length > DIFF_MAX_LINES || b.length > DIFF_MAX_LINES) {
    return { lines: [], added: 0, removed: 0, same: 0, tooLong: true, oldLines: a.length, newLines: b.length }
  }
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++
  }
  /** @type {DiffLine[]} */
  const lines = []
  let added = 0
  let removed = 0
  const push = (type, text) => {
    lines.push({ type, text })
    if (type === 'add') added++
    else if (type === 'del') removed++
  }
  for (let i = 0; i < head; i++) push('same', a[i])
  const am = a.slice(head, a.length - tail)
  const bm = b.slice(head, b.length - tail)
  if (am.length && bm.length && am.length * bm.length <= DIFF_DP_LIMIT * DIFF_DP_LIMIT) {
    for (const d of lcsDiff(am, bm)) push(d.type, d.text)
  } else {
    for (const t of am) push('del', t)
    for (const t of bm) push('add', t)
  }
  for (let i = a.length - tail; i < a.length; i++) push('same', a[i])
  return { lines, added, removed, same: lines.length - added - removed, tooLong: false, oldLines: a.length, newLines: b.length }
}

/** 把 diff 变成可读文本（`+` / `-` / 两空格前缀，超长截断并说明还有多少行） */
export function diffText(diff, max = DIFF_SHOW_LINES) {
  const lines = Array.isArray(diff?.lines) ? diff.lines : []
  if (!lines.length) return ''
  const shown = lines.slice(0, max)
  const body = shown
    .map((l) => (l.type === 'add' ? `+ ${l.text}` : l.type === 'del' ? `- ${l.text}` : `  ${l.text}`))
    .join('\n')
  return lines.length > max ? `${body}\n… 还有 ${lines.length - max} 行没有显示` : body
}

/** 标签名清洗（去引号 / 方括号 / 开头的 #）—— 与内核 `tagsOf` 同一套口径 */
function cleanTag(s) {
  return String(s ?? '')
    .trim()
    .replace(/^["'[\]]+|["'[\]]+$/g, '')
    .replace(/^#/, '')
    .trim()
}

/** 标题正文里的 `#标签`（与 `index-api.ts` 的正文正则同源，用来判断「删了 frontmatter 但正文还有」） */
const BODY_TAG_RE = /(?<=^|\s)#([^\s#[\]{}()（）【】「」，。！？、；：""''.,!?;:]{1,30})/gm

/** 正文（去掉 frontmatter）里的标签 */
function bodyTagsOf(raw) {
  const body = String(raw ?? '').replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*/, '')
  const out = []
  for (const m of body.matchAll(BODY_TAG_RE)) out.push(m[1])
  return out
}

/**
 * 在 frontmatter 里增删标签（纯函数）。
 *
 * 为什么是 frontmatter 而不是在正文里追加 `#tag`：内核的 `tagsOf` 两处都认，
 * 但往正文里塞标签会改用户的文字内容，frontmatter 是"额外信息"，改它不动正文。
 *
 * **保留原写法**：行内数组 / 多行 `- a` / 单行逗号 —— 三种原文回写同一种格式，
 * 不做"统一成行内数组"（那会在 diff 里制造与本次改动无关的噪音）。
 * 没有 frontmatter 时新增一段（只有 add 才建）。
 *
 * 返回 `{ text, changed, added, removed, tags, stillInBody }`：
 * · `stillInBody` —— remove 时正文里仍然出现的 `#tag`（**标签列表里还会看到它**，
 *   内核索引两处都认；工具结果必须把这件事说出来，否则就是静默失效）
 */
export function applyTags(text, tags, mode = 'add') {
  const src = String(text ?? '')
  const want = [...new Set((Array.isArray(tags) ? tags : [tags]).map(cleanTag).filter(Boolean))]
  const res = { text: src, changed: false, added: [], removed: [], tags: [], stillInBody: [] }
  if (!want.length) return res
  const lowerWant = want.map((t) => t.toLowerCase())

  const fm = /^---[ \t]*(\r?\n)([\s\S]*?)\r?\n---[ \t]*((?:\r?\n)?)/.exec(src)
  if (!fm) {
    if (mode === 'remove') {
      // 没有 frontmatter，但正文里可能真有 #tag —— 也要报出来（同样是为了不静默失效）
      const inBody = bodyTagsOf(src)
      res.stillInBody = want.filter((t) => inBody.some((b) => b.toLowerCase() === t.toLowerCase()))
      return res
    }
    const eol = '\n'
    res.text = `---${eol}tags: [${want.join(', ')}]${eol}---${eol}${eol}${src}`
    res.changed = true
    res.added = want
    res.tags = want
    return res
  }

  const eol = fm[1]
  const body = fm[2]
  const after = fm[3]
  const rest = src.slice(fm[0].length)

  /** 现有标签行：三种写法分别匹配（与 `index-api.ts` 的 `tagsOf` 一一对应） */
  const inlineRe = /^((tags|标签)[ \t]*:[ \t]*)\[([^\]]*)\][ \t]*$/m
  const multiRe = /^((tags|标签)[ \t]*:[ \t]*)\r?\n((?:[ \t]*-[ \t]*[^\r\n]+(?:\r?\n|$))+)/m
  const plainRe = /^((tags|标签)[ \t]*:[ \t]*)([^\[\r\n][^\r\n]*)$/m
  const inline = inlineRe.exec(body)
  const multi = inline ? null : multiRe.exec(body)
  const plain = inline || multi ? null : plainRe.exec(body)

  let cur = []
  let style = 'none'
  if (inline) {
    cur = inline[3].split(',').map(cleanTag).filter(Boolean)
    style = 'inline'
  } else if (multi) {
    cur = [...multi[3].matchAll(/^[ \t]*-[ \t]*(.+?)[ \t]*$/gm)].map((m) => cleanTag(m[1])).filter(Boolean)
    style = 'multi'
  } else if (plain) {
    cur = plain[3].split(',').map(cleanTag).filter(Boolean)
    style = 'plain'
  }

  const lowerCur = new Set(cur.map((t) => t.toLowerCase()))
  let next = cur.slice()
  if (mode === 'add') {
    for (const t of want) {
      if (!lowerCur.has(t.toLowerCase())) {
        next.push(t)
        res.added.push(t)
      }
    }
  } else {
    next = cur.filter((t) => {
      const hit = lowerWant.includes(t.toLowerCase())
      if (hit) res.removed.push(t)
      return !hit
    })
  }
  res.tags = next
  if (!res.added.length && !res.removed.length) {
    // 幂等：加已有 / 删本来没有 ⇒ 不写盘
    if (mode === 'remove') {
      const inBody = bodyTagsOf(src)
      res.stillInBody = want.filter((t) => inBody.some((b) => b.toLowerCase() === t.toLowerCase()))
    }
    return res
  }

  const key = (inline || multi || plain)?.[2] ?? 'tags'
  const render = (list) => {
    if (!list.length) return '' // 删掉整行（`tags: []` 留着是噪音）
    if (style === 'multi') return `${key}:${eol}${list.map((t) => `  - ${t}`).join(eol)}${eol}`
    if (style === 'plain') return `${key}: ${list.join(', ')}${eol}`
    return `${key}: [${list.join(', ')}]${eol}`
  }

  let newBody
  if (style === 'none') {
    // 有 frontmatter 但没有标签行 ⇒ 追加到最后一行（空 frontmatter 就只写这一行）
    const trimmed = body.replace(/[ \t\r\n]+$/, '')
    newBody = `${trimmed ? `${trimmed}${eol}` : ''}tags: [${next.join(', ')}]`
  } else {
    const whole = (inline ?? multi ?? plain)[0]
    newBody = body.replace(whole, render(next))
  }
  res.text = `---${eol}${newBody}${eol}---${after}${rest}`
  res.changed = true

  if (mode === 'remove' && res.removed.length) {
    // 注意：判断「正文里还有」要用**改完之后**的文本（frontmatter 已不含这些标签）
    const inBody = bodyTagsOf(res.text)
    res.stillInBody = want.filter((t) => inBody.some((b) => b.toLowerCase() === t.toLowerCase()))
  }
  return res
}

/* ───────────────── 任务（rev173.201 · 单测覆盖） ───────────────── */

/** 每个任务最多留几条运行记录（需求 §3.2） */
export const MAX_RUNS = 10
/** 一次任务执行最多几步工具调用（与对话同一条上限） */
export const MAX_TASK_STEPS = 4

/**
 * 任务触发时**不该碰**的路径（需求 Q24：私密 / 回收站 / 导入 / 收件箱）。
 *
 * 内核那一层已经挡掉了一部分：`note:saved` 只对库内的 `.md` 发（`isNotePath` 跳过 `.zn/`）。
 * 这里再挡一层，因为插件自己的事件订阅可能从别的来源收到路径（跨插件 emit 的字符串不保证）。
 * 目前没有"导入目录 / 收件箱"的固定名字约定（导入插件是用户选文件、直接写到当前目录），
 * 所以按**常见目录名**挡，规则集中在这一个函数里，将来有正式约定只改这里。
 */
const EXCLUDED_DIRS = ['收件箱', 'inbox', '导入', '导入中转']

export function skipForTasks(rawPath) {
  const p = String(rawPath ?? '').trim().replace(/\\/g, '/')
  if (!p || !/\.md$/i.test(p)) return true
  const parts = p.split('/').filter(Boolean)
  if (!parts.length) return true
  // `.zn/`、`.trash/`、隐藏目录：私密文件夹与回收站都在这一类
  if (parts.some((s) => s.startsWith('.'))) return true
  if (parts.length > 1 && EXCLUDED_DIRS.includes(parts[0].toLowerCase())) return true
  return false
}

/**
 * `'HH:MM'` / `'H:M'` → `{ h, m, text: 'HH:MM' }`；不合法返回 `null`。
 *
 * 为什么要返回规范化后的 `text`：面板与下次运行时间都按它算，
 * 用户填 `9:5` 与 `09:05` 应该是同一个时刻（真实输入里两种都常见）。
 */
export function parseClock(raw) {
  const s = String(raw ?? '').trim()
  const m = /^(\d{1,2})\s*[:：]\s*(\d{1,2})$/.exec(s)
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (!Number.isInteger(h) || !Number.isInteger(mi)) return null
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null
  return { h, m: mi, text: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` }
}

/** 周几集合：ISO 1（周一）… 7（周日），去重排序；空 = 每天 */
export function normalizeDays(days) {
  const list = (Array.isArray(days) ? days : [days])
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
  return [...new Set(list)].sort((a, b) => a - b)
}

/** `Date` → ISO 周几（1=周一 … 7=周日；JS 的 `getDay()` 里周日是 0） */
function isoDay(d) {
  const g = d.getDay()
  return g === 0 ? 7 : g
}

/**
 * 这个任务在 `now` **之前最近一次应该跑**的时刻（毫秒）；没配时间 / 从没到过点 ⇒ 0。
 *
 * 「补做」就是靠它：关掉 app 三天再打开，最近一次应跑是昨天 23:00，
 * 而 `lastRunAt` 是三天前 → `isDue` 为真 ⇒ **补跑一次**（不是三次）。
 * 往回最多看 7 天：覆盖「每周几」的最长间隔，也避免老任务算出个远古时间。
 */
export function lastDueAt(task, now = Date.now()) {
  const tr = task?.trigger ?? {}
  if (String(tr.type) !== 'schedule') return 0
  const c = parseClock(tr.at)
  if (!c) return 0
  const days = normalizeDays(tr.days)
  const base = new Date(Number(now) || Date.now())
  for (let back = 0; back <= 7; back++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - back, c.h, c.m, 0, 0)
    if (d.getTime() > base.getTime()) continue
    if (days.length && !days.includes(isoDay(d))) continue
    return d.getTime()
  }
  return 0
}

/** 到点了吗：最近一次应跑时刻晚于上次运行（且任务启用） */
export function isDue(task, now = Date.now()) {
  if (!task || !task.enabled) return false
  if (String(task.trigger?.type) !== 'schedule') return false
  const due = lastDueAt(task, now)
  if (!due) return false
  return due > Number(task.lastRunAt || 0)
}

/** 下次该跑的时刻（面板显示用）；没配时间返回 0 */
export function nextDueAt(task, now = Date.now()) {
  const tr = task?.trigger ?? {}
  if (String(tr.type) !== 'schedule') return 0
  const c = parseClock(tr.at)
  if (!c) return 0
  const days = normalizeDays(tr.days)
  const base = new Date(Number(now) || Date.now())
  for (let fwd = 0; fwd <= 7; fwd++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + fwd, c.h, c.m, 0, 0)
    if (d.getTime() <= base.getTime()) continue
    if (days.length && !days.includes(isoDay(d))) continue
    return d.getTime()
  }
  return 0
}

/**
 * 固定步骤模式里的占位符替换（`{{path}}` → 触发笔记路径）。
 *
 * 为什么要有：固定步骤是**建任务时**写死的，而它要处理的正是"刚保存的那一篇"，
 * 路径只有当次触发才知道。不给占位符就只能写死某一篇 —— 那就不叫规则了。
 * 递归处理数组与对象（工具参数基本是这两层）。
 */
export function expandArgs(args, ctx = {}) {
  const vars = { path: String(ctx.path ?? ''), dir: String(ctx.dir ?? '') }
  const walk = (v) => {
    if (typeof v === 'string') {
      return v.replace(/\{\{\s*(path|dir)\s*\}\}/g, (_, k) => vars[k] ?? '')
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out = {}
      for (const [k, val] of Object.entries(v)) out[k] = walk(val)
      return out
    }
    return v
  }
  return walk(args ?? {})
}

/**
 * 任务触发条件规范化：`save` / `manual` / `schedule`；缺省 manual（只能手动跑）。
 *
 * `schedule` 的时间不合法 ⇒ **退化为 manual**，而不是保留一个永远不触发的任务：
 * 静默不跑比"看起来建了其实永远不动"更好排查（面板上会显示「仅手动」）。
 */
export function normalizeTrigger(t) {
  const type = String(t?.type ?? 'manual')
  if (type === 'schedule') {
    const c = parseClock(t?.at)
    if (!c) return { type: 'manual' }
    const days = normalizeDays(t?.days)
    return days.length ? { type: 'schedule', at: c.text, days } : { type: 'schedule', at: c.text }
  }
  const dir = normRel(t?.dir)
  const okType = type === 'save' ? 'save' : 'manual'
  return okType === 'save' && dir ? { type: okType, dir } : { type: okType }
}

/**
 * 一次事件该触发哪些任务（纯函数）。
 *
 * 三条判据都要过：启用中 · 触发器类型一致 · `save` 触发的目录过滤命中（空 = 全库）。
 * **排除路径在调用方判**（`skipForTasks`），这里只看任务自身条件 ——
 * 这样单测里能分开验证"任务匹配"与"路径该不该碰"两件事。
 */
export function matchTasks(tasks, evt) {
  const e = evt && typeof evt === 'object' ? evt : {}
  const type = String(e.type ?? 'manual')
  const path = String(e.path ?? '')
  return (Array.isArray(tasks) ? tasks : []).filter((t) => {
    if (!t || !t.enabled) return false
    const tr = t.trigger ?? { type: 'manual' }
    if (String(tr.type ?? 'manual') !== type) return false
    if (type === 'save' && tr.dir) {
      const dir = String(tr.dir)
      if (path !== dir && !path.startsWith(`${dir}/`)) return false
    }
    return true
  })
}

/** 运行记录只留最近 N 条（新的在前） */
export function trimRuns(runs, max = MAX_RUNS) {
  return (Array.isArray(runs) ? runs : []).slice(0, Math.max(1, max))
}

const WEEK_NAMES = ['一', '二', '三', '四', '五', '六', '日']

/** 任务显示用的一句触发器描述 */
export function triggerText(t) {
  const tr = t?.trigger ?? { type: 'manual' }
  if (tr.type === 'save') return tr.dir ? `保存到 ${tr.dir} 后` : '任何笔记保存后'
  if (tr.type === 'schedule') {
    const c = parseClock(tr.at)
    if (!c) return '定时（时间无效）'
    const days = normalizeDays(tr.days)
    if (!days.length) return `每天 ${c.text}`
    if (days.length === 7) return `每天 ${c.text}`
    return `每周${days.map((d) => WEEK_NAMES[d - 1]).join('、')} ${c.text}`
  }
  return '仅手动'
}

/**
 * 串行队列（任务执行用）。
 *
 * 为什么必须串行：两个任务同时跑，可能一个在移动笔记、另一个在读同一篇 ——
 * 读到半路文件被搬走，模型给出基于旧路径的结论；更糟的是两边都改 frontmatter，后写的覆盖先写的。
 *
 * 返回的 `push` 永远**不抛**（失败由任务自己记进运行记录）—— 否则一次失败会把整条链断掉。
 */
export function createSerialQueue() {
  let tail = Promise.resolve()
  let depth = 0
  return {
    get depth() {
      return depth
    },
    push(fn) {
      depth++
      const p = tail.then(() => fn())
      tail = p
        .catch(() => {})
        .finally(() => {
          depth--
        })
      return p.catch(() => {})
    },
    /** 等队列排空（测试与卸载时用） */
    idle() {
      return tail.catch(() => {})
    },
  }
}

/** @type {import('../../src/kernel/contract').Plugin} */
export default {
  apply(ctx) {
    const { command, view, host, store, net, fs, index, doc, event, subscriptions } = ctx

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

    /**
     * 待用户确认的写操作（需求 Q4 / Q11）。
     *
     * **只在内存里**：每个提案的 `run` 闭包捕获了生成时的旧内容，
     * 存进 store 再 reload 回来就成了"基于一份可能已经变了的内容去覆盖" —— 那比丢掉提案危险。
     * reload 丢提案 = 用户重说一遍；留着过期提案 = 静默覆盖用户的修改。
     */
    let pending = []
    let proposalSeq = 0
    /** 最近一次确认 / 放弃的结果，显示在面板上（一行） */
    let actionNote = ''
    let actionOk = true

    /** 任务列表（落 store 的 `tasks`）· 运行记录挂在每个任务的 `runs` 里（最多 10 条） */
    let tasks = []
    /** 任务面板里展开了运行记录的 id 集合 */
    const runsOpen = new Set()
    /** 任务执行串行队列（两个任务同时动同一篇笔记会互相覆盖） */
    const taskQueue = createSerialQueue()
    /** 最近一次入队 / 完成的提示，显示在任务面板 */
    let taskNote = ''
    /** 插件卸载标志：队列里还没跑的任务看到它就退出（卸载后继续跑会写半截数据） */
    let disposed = false

    /** token 累计（rev203 · 落 store 的 `usage`；任务与对话分开记） */
    let usageStat = emptyUsage()
    /** 首次向导是否已走完（落 store 的 `wizardDone`）；完成前用三步向导替代设置区 */
    let wizardDone = false
    /** 用户授权给 AI 的插件命令 id（落 store 的 `allowedCommands`；rev173.208） */
    let allowedCommands = []
    /** 命令白名单区块里展开了哪些插件分组（rev173.210；只在内存，重开面板回默认折叠） */
    const openGroups = new Set()
    /** 本次会话里测试连接成功过（向导第三步判据；不落盘，重启重测一次） */
    let wizardTestOk = false
    /** 分类抽样结果（rev203 · 20 篇对照片，人工核对用） */
    let sampleRows = []
    let sampling = false
    let sampleNote = ''

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
      await loadTasks()
      try {
        const saved = await store.get('usage', null)
        if (saved && typeof saved === 'object') usageStat = { ...emptyUsage(), ...saved }
      } catch {
        /* 统计读不出来不影响使用 */
      }
      try {
        wizardDone = Boolean(await store.get('wizardDone', false))
      } catch {
        wizardDone = false
      }
      try {
        allowedCommands = normalizeAllowedCommands(await store.get('allowedCommands', []))
      } catch {
        allowedCommands = []
      }
      startDueTimer()
      refresh()
    }

    /**
     * 记一次 token 用量。
     *
     * 写盘失败只记日志：统计是附属信息，不能因为它让对话/任务失败。
     * `isTask` 分开记 —— 用户想知道"钱花在聊天还是花在自动任务上"。
     */
    async function recordUsage(u, isTask) {
      if (!u) return
      usageStat = addUsage(usageStat, u, isTask)
      try {
        await store.set('usage', usageStat)
      } catch (e) {
        host.log('warn', `存 token 统计失败：${String(e)}`)
      }
      refresh()
      refreshTasks()
    }

    /* ───────── 任务（rev173.201） ───────── */

    /**
     * 分类抽样（rev203 · 实施计划「抽样 20 篇，人工核对准确率」）。
     *
     * 每篇问一次模型：「现有文件夹里选一个 + 给 1-3 个标签」，结果列成表给用户对照。
     * **只读不写**：不移动、不打标签 —— 抽样是为了评估，不是替用户整理。
     */
    async function runSample() {
      if (sampling) return
      sampling = true
      sampleRows = []
      sampleNote = '正在逐篇问模型…（20 篇约 20 次调用）'
      refresh()
      try {
        const key = await host.secrets.get(accountOf(cfg.provider))
        if (!key) throw new Error('还没有保存 API Key')
        const base = effectiveBase()
        const model = effectiveModel()
        if (!base || !model) throw new Error('服务商或模型名没配好')
        const dirs = await fs.listDirs().catch(() => [])
        /**
         * ⚠️ 实测（rev203）：`fs.listNotes()` 会把**附件**也列出来（`.jpg` / `.epub` / `.txt`）——
         * 契约注释写的是"只上报 .md"，实际 Rust 侧没过滤。抽样与任务都要自己挡一道，
         * 不然模型会去"分类"一张图片。
         */
        const notes = (await fs.listNotes()).filter((n) => /\.md$/i.test(String(n?.path ?? ''))).slice(0, 20)
        if (!notes.length) throw new Error('库里还没有笔记')
        for (const n of notes) {
          const text = await fs.readText(n.path).catch(() => '')
          /**
           * 空笔记不送模型（实测 2026-10-27）：空正文时模型不一定回 JSON
           * （有一篇直接回了别的话 ⇒ 解析失败、白花一次调用）。空笔记本来也没有"该分到哪"可言。
           */
          if (!text.trim()) {
            sampleRows.push({ path: n.path, dir: '（空笔记，跳过）', tags: '' })
            refresh()
            continue
          }
          const ask = [
            '你是笔记整理助手。',
            `现有文件夹：${dirs.length ? dirs.join('、') : '（没有子文件夹，可以建议新建）'}`,
            `笔记路径：${n.path}`,
            `内容：\n${text.slice(0, 1500)}`,
            '',
            '给这篇笔记选一个最合适的文件夹（优先从现有文件夹里选），再给 1-3 个标签。',
            '只输出 JSON，不要解释：{"dir":"工作","tags":["a","b"]}',
          ].join('\n')
          let dir = '（解析失败）'
          let tags = []
          try {
            const r = await nonStreamChat({ base, model, key, messages: [{ role: 'user', content: ask }] })
            void recordUsage(r.usage, false)
            const m = /\{[\s\S]*\}/.exec(r.content)
            const j = m ? JSON.parse(m[0]) : null
            if (j && typeof j.dir === 'string') dir = j.dir
            if (j && Array.isArray(j.tags)) tags = j.tags.slice(0, 3).map((t) => String(t))
          } catch (e) {
            dir = `（失败：${String(e?.message ?? e).slice(0, 40)}）`
          }
          sampleRows.push({ path: n.path, dir, tags: tags.join('、') })
          refresh()
        }
        sampleNote = `完成 ${sampleRows.length} 篇 —— 逐行核对「AI 建议」是否合理（它没有真的移动任何文件）`
      } catch (e) {
        sampleNote = `抽样失败：${String(e?.message ?? e)}`
      } finally {
        sampling = false
        refresh()
      }
    }

    async function loadTasks() {
      try {
        const saved = await store.get('tasks', [])
        tasks = (Array.isArray(saved) ? saved : []).filter((t) => t && typeof t === 'object')
      } catch (e) {
        loadError = `读任务失败：${String(e)}`
        tasks = []
      }
    }

    async function saveTasks() {
      try {
        await store.set('tasks', tasks)
      } catch (e) {
        taskNote = `保存任务失败：${String(e?.message ?? e)}`
      }
    }

    const findTask = (id) => tasks.find((t) => t && t.id === String(id))

    /** 任务面板刷新（面板没开时是空操作） */
    const refreshTasks = () => {
      try {
        view.refresh(TASKS_PANEL_ID)
      } catch {
        /* 面板没开 */
      }
    }

    /** 任务卡片的一行状态：触发方式 · 上次 / 下次 · 执行模式 */
    function taskHint(t) {
      const parts = [triggerText(t)]
      const runs = Array.isArray(t.runs) ? t.runs : []
      parts.push(runs.length ? `上次 ${timeText(runs[0].at)}` : '还没跑过')
      if (t.trigger?.type === 'schedule') {
        const next = nextDueAt(t)
        if (next) parts.push(`下次 ${timeText(next)}`)
      }
      const n = Array.isArray(t.steps) ? t.steps.length : 0
      parts.push(t.mode === 'fixed' && n ? `固定 ${n} 步` : '现场判断')
      return parts.join(' · ')
    }

    /** 时间戳 → `10-27 12:30`（面板里只显示到分钟） */
    function timeText(at) {      const d = new Date(Number(at) || Date.now())
      return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }

    /** 运行记录一行 */
    function runLine(r) {
      const t = timeText(r?.at)
      const where = r?.path ? ` · ${r.path}` : ''
      if (!r?.ok) {
        const why = String(r?.error || '失败')
        return `✗ ${t}${where} · ${why.length > 60 ? `${why.slice(0, 60)}…` : why}`
      }
      const steps = Array.isArray(r?.steps) ? r.steps.length : 0
      return `✓ ${t}${where} · ${steps} 步 · ${Number(r?.ms) || 0} ms`
    }

    /** 任务执行的 system 提示：把"这是自动任务、不能改正文/删除"讲清楚 */
    function taskSystemPrompt(task, info) {
      return [
        '你在 ZeroNote 笔记应用里执行用户事先定义好的自动任务。',
        `任务名：${task.name}`,
        `任务指令：${task.instruction}`,
        info?.path ? `触发原因：笔记「${info.path}」刚刚被保存。` : '触发原因：用户手动点了「立即跑」。',
        '',
        '规则：',
        '1. 只做指令要求的事，不要顺手整理其它笔记。',
        '2. 可以：列目录 / 列笔记 / 读笔记 / 搜索 / 打标签 / 移动笔记 / 新建文件夹 / 新建笔记。',
        '2b. 用户授权过的插件命令可以用 plugin_exec 调（例如 habit.check）；没授权的会被拒绝，不要重试。',
        '3. 不可以：改写已有正文、删除笔记 —— 这两个在自动任务里会被拒绝（要用户在对话里确认）。',
        `4. 最多 ${MAX_TASK_STEPS} 步工具调用；够用就停。`,
        '5. 最后用一句话说明你做了什么；不要输出无关解释。',
      ].join('\n')
    }

    /**
     * 跑一个任务（串行队列里执行）。
     *
     * 失败**不抛**：写成运行记录 + 任务上标红（需求「失败记日志 + 不阻塞笔记保存」）。
     * 工具走 `runTool(..., { interactive: false })` —— 自动任务里没有"点采用"的人，
     * 所以改写正文 / 删除会被工具层拒绝，移动与打标签直接执行。
     */
    async function runTask(task, info) {
      if (disposed) return null
      const t0 = Date.now()
      const run = {
        at: t0,
        reason: String(info?.reason ?? 'manual'),
        path: String(info?.path ?? ''),
        ok: true,
        steps: [],
        error: '',
        ms: 0,
      }
      taskNote = `正在跑「${task.name}」…`
      refreshTasks()
      try {
        /**
         * **固定步骤模式**（rev202）：建任务时就把工具调用排好，执行时按序跑，**不调模型**。
         * 好处：便宜（0 token）、稳定（同一个指令每次结果一样）、断网 / 没配 Key 也能跑。
         * 代价：不会按内容临场判断 —— 所以只适合"动作固定"的活（打标签、移到某目录）。
         */
        if (task.mode === 'fixed' && Array.isArray(task.steps) && task.steps.length) {
          run.mode = 'fixed'
          const list = task.steps.slice(0, MAX_TASK_STEPS)
          for (const st of list) {
            const log = { name: String(st?.name ?? ''), ok: true, text: '', ms: 0 }
            const s0 = Date.now()
            try {
              const out = await runTool(log.name, expandArgs(st?.args, info), { interactive: false })
              log.text = summarize(out)
            } catch (e) {
              log.ok = false
              log.text = String(e?.message ?? e)
            }
            log.ms = Date.now() - s0
            run.steps.push(log)
          }
          if (task.steps.length > MAX_TASK_STEPS) {
            run.ok = false
            run.error = `固定步骤有 ${task.steps.length} 步，超过 ${MAX_TASK_STEPS} 步上限，只跑了前 ${MAX_TASK_STEPS} 步`
          }
        } else {
          run.mode = 'auto'
          const key = await host.secrets.get(accountOf(cfg.provider))
          if (!key) throw new Error('还没有保存 API Key —— 在 AI 面板里配好才能跑任务（或改用「固定步骤」模式，那个不需要模型）')
          const base = effectiveBase()
          const model = effectiveModel()
          if (!base || !model) throw new Error('服务商或模型名没配好')
          /** @type {{ role: string, content: string }[]} */
          const api = [{ role: 'system', content: taskSystemPrompt(task, info) }]
          if (info?.path) {
            const text = await fs.readText(info.path).catch(() => '')
            api.push({
              role: 'user',
              content: `触发笔记：${info.path}\n\n${text.slice(0, 6000)}`,
            })
          } else {
            api.push({ role: 'user', content: '现在手动跑一次这个任务。先看看当前库的状态再动手。' })
          }
          for (let step = 0; step < MAX_TASK_STEPS; step++) {
            const r = await nonStreamChat({ base, model, key, messages: api })
            void recordUsage(r.usage, true)
            if (!r.toolCalls.length) break
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
              const log = { name: tc.name, ok: true, text: '', ms: 0 }
              const s0 = Date.now()
              let out = ''
              try {
                out = await runTool(tc.name, parseArgs(tc.arguments), { interactive: false })
                log.text = summarize(out)
              } catch (e) {
                log.ok = false
                out = `错误：${String(e?.message ?? e)}`
                log.text = String(e?.message ?? e)
              }
              log.ms = Date.now() - s0
              run.steps.push(log)
              api.push({ role: 'tool', tool_call_id: tc.id, content: out })
            }
            if (step === MAX_TASK_STEPS - 1) {
              run.error = `超过 ${MAX_TASK_STEPS} 步，已停止`
              run.ok = false
            }
          }
        }
      } catch (e) {
        run.ok = false
        run.error = String(e?.message ?? e)
      }
      run.ms = Date.now() - t0
      /**
       * 工具步骤失败 ⇒ 这次运行算失败（rev201 实测踩到）：
       * 第一版只看有没有抛异常，于是「三步全失败」也记成 ✓ ——
       * 面板一片绿、文件却没动，正是「静默失效比报错危险」。
       */
      const failed = run.steps.filter((s) => !s.ok)
      if (failed.length) {
        run.ok = false
        const why = failed.map((s) => `${s.name}（${s.text}）`).join('；')
        run.error = run.error ? `${run.error}；${why}` : `步骤失败：${why}`
      }
      task.runs = trimRuns([run, ...(Array.isArray(task.runs) ? task.runs : [])])
      task.lastRunAt = run.at
      task.lastError = run.ok ? '' : run.error
      taskNote = run.ok ? `✓ 「${task.name}」跑完（${run.ms} ms）` : `✗ 「${task.name}」失败：${run.error}`
      await saveTasks()
      refreshTasks()
      return run
    }

    /** 入队（串行）。用户点「立即跑」与 `note:saved` 都走这里。 */
    function queueTask(task, info) {
      if (!task) return
      taskQueue.push(() => runTask(task, info))
    }

    /* ───────── 定时触发（rev202 · 需求 §3.2「桌面可靠，Android 打开时补做」） ───────── */

    /** 检查间隔：每分钟一次（到点精度就是「分钟」，与 `HH:MM` 一致） */
    const DUE_TICK_MS = 60000
    let dueTimer = 0

    /**
     * 扫一遍：哪些定时任务该跑了。
     *
     * `isDue` 判的是「最近一次应跑时刻」> `lastRunAt` —— 这一条同时覆盖两种场景：
     * · 正常到点（最近一次应跑 = 刚刚）
     * · 关闭 app 几天后再打开（最近一次应跑 = 昨天 23:00，仍大于上次运行）⇒ **补做一次**
     * 补做不会补多次：跑完 `lastRunAt` 就更新到当前，再 tick 时 `isDue` 已为假。
     */
    function tickDue() {
      if (disposed) return
      const now = Date.now()
      let fired = 0
      for (const t of tasks) {
        if (!isDue(t, now)) continue
        queueTask(t, { reason: 'schedule' })
        fired++
      }
      if (fired) {
        taskNote = `定时触发：${fired} 个任务入队`
        refreshTasks()
      }
    }

    /** 启动后第一次检查稍等 2 秒（等面板与库就绪），之后每分钟一次 */
    function startDueTimer() {
      if (dueTimer) return
      const boot = setTimeout(() => tickDue(), 2000)
      dueTimer = window.setInterval(() => tickDue(), DUE_TICK_MS)
      subscriptions.push({
        dispose: () => {
          clearTimeout(boot)
          if (dueTimer) clearInterval(dueTimer)
          dueTimer = 0
        },
      })
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
          wizardTestOk = true
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
    /* ───────── 工具（只读 rev198 · 写 rev199） ───────── */

    /**
     * 造一个待确认提案。`run` 是**用户点「采用」时才执行**的那段。
     *
     * 返回给模型的字符串里必须有 `status: 'pending'`：模型看到它才知道"还没落地"，
     * 否则它会回一句「已经帮你改好了」—— 用户看着没变，下次再让它改，就叠出两份不同的内容。
     */
    function queueProposal(kind, title, detail, run, extra = {}) {
      const id = `p${++proposalSeq}`
      const prop = { id, kind, title, detail, run, ...extra }
      pending.push(prop)
      return prop
    }

    /** 提案里已有同一路径的待确认改写 ⇒ 拒绝（两版都采用会互相覆盖，用户看到的是"改两次只生效一次"） */
    function hasPendingWrite(path) {
      return pending.some((p) => p.kind === 'write' && p.path === path)
    }

    /**
     * 执行一个工具，返回**给模型看**的字符串。
     *
     * 失败也以 `throw` 出去、由调用方包成 `错误：…` 回灌 —— 模型看到错误能自己换参数重试，
     * 而不是整个对话崩掉（这与「静默失效比报错危险」同向）。
     *
     * 写工具分两档（需求 Q4）：**可逆的直接做**（新建 / 建文件夹 / 打标签），
     * **不可逆的只生成提案**（覆盖正文 / 移动 / 删除）。
     *
     * `opts.interactive === false` 是**自动任务**（rev201）的调用方式：没有人会点「采用」，
     * 所以改写正文 / 删除直接拒绝，移动与打标签改成直接执行。
     */
    async function runTool(name, args, opts = {}) {
      const interactive = opts.interactive !== false
      const a = args && typeof args === 'object' ? args : {}
      if (name === 'list_dirs') {
        const dirs = await fs.listDirs()
        return JSON.stringify({ count: dirs.length, dirs: dirs.slice(0, 200) })
      }
      if (name === 'list_notes') {
        const dir = typeof a.dir === 'string' && a.dir.trim() ? a.dir.trim() : undefined
        /**
         * `fs.listNotes()` 实际返回**笔记 + 只读文档 + 图片**（Rust `collect` 从 rev173.3 起就这样，
         * 契约注释里那句"只上报 .md"是过时的）。工具名叫 list_notes ⇒ 这里只给 .md，
         * 否则模型会拿 `image-xxx.png` 当笔记去读、去分类。
         */
        const all = (await fs.listNotes(dir)).filter((n) => /\.md$/i.test(String(n?.path ?? '')))
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

      /* ── 写工具：可逆的直接做 ── */

      if (name === 'note_create') {
        const p = notePathOf(a.path)
        if (!p) throw new Error('path 不合法：不能为空、不能含 ..、不能以 . 开头')
        if (await fs.exists(p)) {
          throw new Error(
            `${p} 已存在 —— 不覆盖。要改写它请用 note_write（会生成预览让你确认），要换名字请用 note_move`,
          )
        }
        const content = String(a.content ?? '')
        await fs.createNote(p, content)
        return JSON.stringify({ ok: true, created: p, chars: content.length })
      }

      if (name === 'folder_create') {
        const p = normRel(a.path)
        if (!p) throw new Error('path 不合法：不能为空、不能含 ..、不能以 . 开头')
        await fs.mkdir(p)
        return JSON.stringify({ ok: true, created: p })
      }

      if (name === 'tag_add' || name === 'tag_remove') {
        const p = notePathOf(a.path)
        if (!p) throw new Error('path 不合法：不能为空、不能含 ..、不能以 . 开头')
        const mode = name === 'tag_add' ? 'add' : 'remove'
        const r = applyTags(await fs.readText(p), a.tags ?? a.tag, mode)
        if (!r.changed) {
          const out = { ok: true, changed: false, path: p, tags: r.tags, message: '标签没有变化（要加的已经在了 / 要删的本来就没有）' }
          if (r.stillInBody.length) out.warning = `正文里还有 #${r.stillInBody.join(' #')}，标签列表里仍会看到它`
          return JSON.stringify(out)
        }
        await fs.writeText(p, r.text)
        const out = { ok: true, changed: true, path: p, tags: r.tags }
        if (r.removed.length) out.removed = r.removed
        if (r.stillInBody.length) {
          out.warning = `frontmatter 里的 ${r.stillInBody.join(', ')} 已删除，但正文里还有 #${r.stillInBody.join(' #')} 引用 —— 标签列表里仍会看到它（要彻底去掉得改正文）`
        }
        return JSON.stringify(out)
      }

      /* ── 写工具：不可逆的只生成提案 ── */

      if (name === 'note_write') {
        if (!interactive) {
          throw new Error('自动任务里不能改写已有正文（需要人在对话里看 diff 再点「采用」）—— 改用 tag_add / note_move，或让用户在对话里改')
        }
        const p = notePathOf(a.path)
        if (!p) throw new Error('path 不合法：不能为空、不能含 ..、不能以 . 开头')
        const next = String(a.content ?? '')
        if (!next.trim()) {
          throw new Error('content 是空的。要清空一篇笔记请明确说明；这里不会把文件写成空的')
        }
        if (hasPendingWrite(p)) {
          throw new Error(`${p} 已经有一份待确认的改写 —— 等用户在那份上点「采用」或「放弃」再改，两版同时存在会互相覆盖`)
        }
        const old = await fs.readText(p)
        const diff = buildDiff(old, next)
        if (!diff.tooLong && !diff.added && !diff.removed) {
          return JSON.stringify({ ok: true, changed: false, path: p, message: '内容和现在完全一样，没有改动' })
        }
        const detail = diff.tooLong
          ? `文件较长（${diff.oldLines} → ${diff.newLines} 行），不逐行对比；采用后整篇替换`
          : `+${diff.added} 行 / −${diff.removed} 行`
        const prop = queueProposal('write', `改写 ${p}`, detail, async () => {
          const cur = await fs.readText(p)
          if (cur !== old) {
            throw new Error('文件在预览之后被改过（可能你在编辑器里改了），这次写入已取消 —— 让 AI 重新生成一版')
          }
          await fs.writeText(p, next)
          await index.upsert(p, next)
        }, { path: p, diff, oldLen: old.length, newLen: next.length })
        return JSON.stringify({
          status: 'pending',
          proposalId: prop.id,
          path: p,
          summary: detail,
          message: '已生成预览，**还没写盘**。用户在 AI 面板点「采用」后才生效 —— 现在不要对用户说已经改好',
        })
      }

      if (name === 'note_move') {
        const from = notePathOf(a.from)
        if (!from) throw new Error('from 不合法')
        /** `to` 若是一个已存在的文件夹，就拼上原文件名（模型常说「移到 技术/」） */
        const toDir = normRel(a.to)
        let to = notePathOf(a.to)
        if (toDir) {
          const dirs = await fs.listDirs().catch(() => [])
          if (dirs.includes(toDir)) to = `${toDir}/${from.split('/').pop()}`
        }
        if (!to) throw new Error('to 不合法：不能为空、不能含 ..、不能以 . 开头')
        if (from === to) return JSON.stringify({ ok: true, changed: false, message: '源路径和目标路径相同，没有移动' })
        if (!(await fs.exists(from))) throw new Error(`源不存在：${from}`)
        if (await fs.exists(to)) throw new Error(`目标已存在：${to}（不覆盖，换一个名字）`)
        /** 自动任务：没有人点确认，移动**直接执行**（可逆：移回去就是） */
        if (!interactive) {
          const active = doc.active()
          const isActive = active?.path === from
          if (isActive) await doc.save()
          await fs.move(from, to)
          if (isActive) await doc.open(to)
          return JSON.stringify({ ok: true, moved: true, from, to })
        }
        const prop = queueProposal('move', `移动 ${from}`, `→ ${to}`, async () => {
          const active = doc.active()
          const isActive = active?.path === from
          if (isActive) await doc.save()
          await fs.move(from, to)
          // 打开着的正是这篇 ⇒ 让编辑器跟着走，否则标题栏还挂着旧路径、再保存会重建旧文件
          if (isActive) await doc.open(to)
        }, { path: from, to })
        return JSON.stringify({
          status: 'pending',
          proposalId: prop.id,
          from,
          to,
          message: '等用户在面板点「确认移动」后才执行',
        })
      }

      if (name === 'note_trash') {
        if (!interactive) {
          throw new Error('自动任务里不能删除笔记（不可逆，需要人在对话里确认）')
        }
        const p = notePathOf(a.path)
        if (!p) throw new Error('path 不合法：不能为空、不能含 ..、不能以 . 开头')
        if (!(await fs.exists(p))) throw new Error(`不存在：${p}`)
        const prop = queueProposal('trash', `移入回收站 ${p}`, '可在内核回收站恢复（Ctrl+Shift+T 或回收站面板）', async () => {
          const active = doc.active()
          if (active?.path === p) await doc.save()
          const inTrash = await fs.delete(p)
          if (active?.path === p) doc.close(p)
          return inTrash
        }, { path: p })
        return JSON.stringify({
          status: 'pending',
          proposalId: prop.id,
          path: p,
          message: '等用户在面板点「确认删除」后才进回收站',
        })
      }

      /* ── 任务管理（rev201）── */

      if (name === 'task_create') {
        const instruction = String(a.instruction ?? '').trim()
        if (!instruction) throw new Error('缺少 instruction（这个任务要 AI 做什么）')
        const trig = normalizeTrigger({ type: a.trigger, dir: a.dir, at: a.at, days: a.days })
        if (String(a.trigger ?? '') === 'schedule' && trig.type !== 'schedule') {
          throw new Error(`定时时间不合法：${String(a.at ?? '（空）')} —— 要 HH:MM 形式，例如 23:00`)
        }
        /**
         * 执行模式（需求 Q28）：**固定步骤**（建任务时排好工具调用，不调模型）或
         * **现场判断**（每次让模型看内容自己决定，最多 4 步）。
         * 给了 steps 就按固定步骤跑；只给了 mode='fixed' 却没步骤 ⇒ 退回现场判断（否则这个任务永远不动）。
         */
        const steps = (Array.isArray(a.steps) ? a.steps : [])
          .filter((s) => s && typeof s.name === 'string' && s.name.trim())
          .slice(0, MAX_TASK_STEPS)
          .map((s) => ({ name: s.name.trim(), args: s.args && typeof s.args === 'object' ? s.args : {} }))
        const mode = steps.length ? 'fixed' : 'auto'
        /**
         * 去重：指令与触发方式都一样就是同一个任务。
         *
         * 真实踩到（rev201 实测）：模型在工具循环里可能**把同一个 task.create 调好几次**
         * （每次它都以为还没建），一口气建出 4 个一模一样的任务，之后每次保存跑 4 遍。
         */
        const trigKey = JSON.stringify(trig)
        const dup = tasks.find((t) => t.instruction === instruction && JSON.stringify(t.trigger ?? {}) === trigKey)
        if (dup) {
          return JSON.stringify({
            ok: true,
            existed: dup.id,
            name: dup.name,
            message: `已经有一个一样的任务（${dup.name}），没有重复创建`,
          })
        }
        const task = {
          id: `t${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
          name: String(a.name ?? '').trim() || '未命名任务',
          instruction,
          trigger: trig,
          mode,
          steps,
          enabled: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          runs: [],
          /**
           * 定时任务从**创建时刻**开始算：否则「每天 23:00」在中午建好，
           * `lastDueAt` 会指到昨天 23:00 > lastRunAt(0) ⇒ 立刻补跑一次 —— 用户没要这个。
           */
          lastRunAt: trig.type === 'schedule' ? Date.now() : 0,
          lastError: '',
        }
        tasks.push(task)
        await saveTasks()
        refreshTasks()
        const whenSave = '任务已建好并启用 —— 下次保存笔记时自动跑'
        const whenSchedule = `任务已建好 · ${triggerText(task)}`
        return JSON.stringify({
          ok: true,
          id: task.id,
          name: task.name,
          trigger: triggerText(task),
          mode,
          steps: steps.map((s) => s.name),
          message: trig.type === 'save' ? whenSave : trig.type === 'schedule' ? whenSchedule : '任务已建好（仅手动）',
        })
      }

      if (name === 'task_update') {
        const task = findTask(String(a.id ?? ''))
        if (!task) throw new Error(`没有这个任务：${a.id}（用 task_list 看有哪些）`)
        if (typeof a.name === 'string' && a.name.trim()) task.name = a.name.trim()
        if (typeof a.instruction === 'string' && a.instruction.trim()) task.instruction = a.instruction.trim()
        if (a.trigger !== undefined || a.dir !== undefined || a.at !== undefined || a.days !== undefined) {
          task.trigger = normalizeTrigger({
            type: a.trigger ?? task.trigger?.type,
            dir: a.dir ?? task.trigger?.dir,
            at: a.at ?? task.trigger?.at,
            days: a.days ?? task.trigger?.days,
          })
        }
        if (Array.isArray(a.steps)) {
          task.steps = a.steps
            .filter((s) => s && typeof s.name === 'string' && s.name.trim())
            .slice(0, MAX_TASK_STEPS)
            .map((s) => ({ name: s.name.trim(), args: s.args && typeof s.args === 'object' ? s.args : {} }))
        }
        if (a.mode === 'fixed' || a.mode === 'auto') task.mode = a.mode
        // 固定步骤却没有步骤 ⇒ 退回现场判断（否则这个任务永远不动）
        if (task.mode === 'fixed' && !(Array.isArray(task.steps) && task.steps.length)) task.mode = 'auto'
        if (typeof a.enabled === 'boolean') task.enabled = a.enabled
        task.updatedAt = Date.now()
        await saveTasks()
        refreshTasks()
        return JSON.stringify({
          ok: true,
          id: task.id,
          name: task.name,
          enabled: task.enabled,
          trigger: triggerText(task),
        })
      }

      if (name === 'task_delete') {
        const id = String(a.id ?? '')
        const i = tasks.findIndex((t) => t && t.id === id)
        if (i < 0) throw new Error(`没有这个任务：${id}`)
        const [gone] = tasks.splice(i, 1)
        await saveTasks()
        refreshTasks()
        return JSON.stringify({ ok: true, deleted: gone.id, name: gone.name })
      }

      if (name === 'task_list') {
        return JSON.stringify({
          count: tasks.length,
          tasks: tasks.map((t) => ({
            id: t.id,
            name: t.name,
            enabled: Boolean(t.enabled),
            trigger: triggerText(t),
            instruction: t.instruction,
            lastRunAt: t.lastRunAt || 0,
            lastError: t.lastError || '',
            runs: (Array.isArray(t.runs) ? t.runs : []).length,
          })),
        })
      }

      if (name === 'task_run') {
        const task = findTask(String(a.id ?? ''))
        if (!task) throw new Error(`没有这个任务：${a.id}`)
        // 入队而不是当场 await：一次任务可能跑几十秒，对话不该卡在这里
        queueTask(task, { reason: 'manual' })
        return JSON.stringify({
          ok: true,
          queued: task.id,
          message: `「${task.name}」已排入队列，跑完在任务面板看运行记录`,
        })
      }

      if (name === 'plugin_exec') {
        const cmd = String(a.command ?? '').trim()
        if (!cmd) throw new Error('缺少 command 参数')
        if (!isPluginCommandAllowed(cmd, allowedCommands)) {
          throw new Error(
            `命令未授权：${cmd}。请让用户在「AI」设置页的「允许 AI 调用的命令」里允许它（内核命令与 AI 自己的命令不开放）`,
          )
        }
        let result
        try {
          result = await command.execute(cmd, ...argvOf(a.args))
        } catch (e) {
          throw new Error(`命令 ${cmd} 执行失败：${String(e?.message ?? e)}`)
        }
        let text
        try {
          text = typeof result === 'string' ? result : JSON.stringify(result ?? null)
        } catch {
          text = String(result)
        }
        return text.length > 2000 ? `${text.slice(0, 2000)}…（结果已截断）` : text
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
      const raw = String(s ?? '')
      // 写工具的返回值是一大段 JSON，摊在步骤行里全是噪音 —— 换成一句话
      if (raw.includes('"status":"pending"')) return '已生成预览，等确认'
      const t = raw.replace(/\s+/g, ' ')
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
      /** token 用量（rev203）：服务商一般只在最后一块给，没有就是 null */
      let usage = null
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
        if (parsed.usage) usage = parsed.usage
        if (parsed.done) break
      }
      return { content, toolCalls: finalizeToolCalls(toolState), usage }
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
      return { content, toolCalls, usage: normalizeUsage(j?.usage) }
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
        /** 发给模型的序列：system + 历史（去掉 tool 中间态）+ 本次 user */
        const api = buildChatMessages(messages.slice(0, -1))
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
            void recordUsage(r.usage, false)
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
          value:
            '先聊两句试试。它能查你的笔记（列文件夹 / 搜索 / 读全文），也能改写、移动、删除 —— 后三种会先出预览，你点确认才生效。',
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

    /**
     * 「待确认」区（rev199 · 需求 Q4 / Q11）。
     *
     * 三类提案共用一块：改写显示 diff 让用户看清改了哪几行，移动/删除显示一行路径。
     * 按钮文案按**后果**写（「确认删除」而不是「确定」）—— 用户扫一眼就知道点下去会失去什么。
     */
    function pendingSection() {
      if (!pending.length) {
        // 提案都没了，但刚点的「采用 / 放弃」得留一行结果 ——
        // 否则区域整块消失，用户不知道自己是点成功了还是点漏了
        return actionNote
          ? [
              { type: 'text', value: actionNote, variant: 'caption', tone: actionOk ? 'success' : 'danger' },
              { type: 'divider' },
            ]
          : []
      }
      /** @type {import('../../src/kernel/contract').UINode[]} */
      const nodes = []
      for (const it of pending) {
        /** @type {import('../../src/kernel/contract').UINode[]} */
        const kids = [
          { type: 'text', value: it.detail, variant: 'caption', tone: 'muted' },
        ]
        if (it.kind === 'write' && it.diff && !it.diff.tooLong) {
          kids.push({ type: 'code', value: diffText(it.diff), lang: 'text' })
        }
        const buttons = []
        if (it.kind === 'write') {
          buttons.push({ type: 'button', label: '采用', onClick: 'ai.accept', payload: { id: it.id } })
        } else if (it.kind === 'move') {
          buttons.push({ type: 'button', label: '确认移动', onClick: 'ai.accept', payload: { id: it.id } })
        } else {
          buttons.push({ type: 'button', label: '确认删除', variant: 'danger', onClick: 'ai.accept', payload: { id: it.id } })
        }
        buttons.push({ type: 'button', label: '放弃', variant: 'ghost', onClick: 'ai.reject', payload: { id: it.id } })
        kids.push({ type: 'row', align: 'center', gap: 'sm', children: buttons })
        nodes.push({
          type: 'field',
          label: it.title,
          hint: it.kind === 'write' ? '采用 = 按上面的预览整篇替换（写入前会再核一次文件有没有被别人改过）' : '',
          children: { type: 'stack', gap: 'sm', children: kids },
        })
      }
      return [
        {
          type: 'row',
          align: 'center',
          wrap: true,
          gap: 'sm',
          children: [
            { type: 'text', value: '待确认', variant: 'title' },
            { type: 'badge', text: `${pending.length} 项`, tone: 'warning' },
            {
              type: 'text',
              value: '不可逆操作 —— 点确认才执行',
              variant: 'caption',
              tone: 'muted',
            },
          ],
        },
        ...nodes,
        ...(actionNote
          ? [{ type: 'text', value: actionNote, variant: 'caption', tone: actionOk ? 'success' : 'danger' }]
          : []),
        { type: 'divider' },
      ]
    }

    /**
     * 首次向导（rev203 · 需求 Q33「不设默认，首次配置时让你选」）。
     *
     * 三步：选服务商 → 填模型名与 Key → 测试连接。走完点「完成配置」，之后这块收起、
     * 换成完整设置区。**刻意不预置任务**（Q34）—— 新库打开只有向导。
     */
    function wizardSection(ready) {
      if (wizardDone) return []
      const step1 = Boolean(cfg.provider)
      const step2 = keyState === 'set' && Boolean(effectiveModel())
      const step3 = wizardTestOk
      const mark = (done, n, title) => ({
        type: 'row',
        align: 'center',
        wrap: true,
        gap: 'sm',
        children: [
          { type: 'badge', text: done ? '已完成' : `第 ${n} 步`, tone: done ? 'success' : 'warning' },
          { type: 'text', value: title, variant: 'caption', tone: 'muted' },
        ],
      })
      return [
        {
          type: 'field',
          label: '第一次用？三步配好',
          hint: '走完点「完成配置」，这里就收起来，换成完整设置',
          children: {
            type: 'stack',
            gap: 'sm',
            children: [
              mark(step1, 1, '选服务商（DeepSeek / Kimi / 通义 / 自定义 OpenAI 兼容端点）'),
              {
                type: 'select',
                bind: 'ai.provider',
                options: PROVIDERS.map((x) => ({ value: x.id, label: x.name })),
                onSubmit: 'ai.set-provider',
              },
              mark(step2, 2, '填模型名与 API Key（Key 存系统凭据管理器）'),
              /* 自定义服务商：向导里也得有端点输入，否则用户选完 custom 就走不下去 */
              ...(cfg.provider === 'custom'
                ? [
                    {
                      type: 'input',
                      bind: 'ai.baseurl',
                      placeholder: '端点地址，例如 https://api.example.com/v1',
                      onSubmit: 'ai.save-baseurl',
                    },
                  ]
                : []),
              {
                type: 'input',
                bind: 'ai.model',
                placeholder: `模型名，留空用默认：${providerOf(cfg.provider).model || '（自定义无默认）'}`,
                onSubmit: 'ai.save-model',
              },
              {
                type: 'row',
                align: 'center',
                gap: 'sm',
                children: [
                  {
                    type: 'input',
                    bind: 'ai.key',
                    placeholder: 'sk-…',
                    secret: true,
                    onSubmit: 'ai.save-key',
                  },
                  { type: 'button', label: '保存 Key', onClick: 'ai.save-key', send: 'ai.key' },
                ],
              },
              {
                type: 'button',
                label: '保存模型名',
                variant: 'ghost',
                onClick: 'ai.save-model',
                send: 'ai.model',
              },
              mark(step3, 3, '测试连接（能用才算配好）'),
              {
                type: 'row',
                align: 'center',
                wrap: true,
                gap: 'sm',
                children: [
                  { type: 'button', label: busy ? '连接中…' : '测试连接', onClick: 'ai.test' },
                  {
                    type: 'button',
                    label: '完成配置',
                    disabled: !ready,
                    onClick: 'ai.wizard-done',
                  },
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
              ...(result?.detail ? [{ type: 'code', value: result.detail, lang: 'text' }] : []),
            ],
          },
        },
        { type: 'divider' },
      ]
    }

    /**
     * 「允许 AI 调用的命令」区块（rev173.208 初版 · rev173.210 改成按插件分组折叠）。
     *
     * 候选来自 `command.list()`（已加载插件注册的命令），去掉内核与 AI 自身；
     * 每条一个「允许 / 已允许」按钮 —— 点击切换并落 store。
     * 为什么不用 checkbox：checkbox 的 onSubmit 只回 `{ value }`，动态列表拿不到是哪一条
     * （契约 UINode 的 checkbox 按 bind 字段绑定，不适合 N 条动态项）；按钮的 payload 能带 id。
     *
     * 为什么分组：本机 137 条铺开会把面板撑成一面墙；已授权的单列在最上面（好撤销），
     * 其余按插件分组、默认折叠。
     */
    function commandRow(c) {
      const on = allowedCommands.includes(c.id)
      return {
        key: c.id,
        node: {
          type: 'row',
          align: 'center',
          gap: 'sm',
          children: [
            { type: 'text', value: `${c.title} · ${c.id}`, variant: 'caption' },
            {
              type: 'button',
              label: on ? '已允许' : '允许',
              variant: on ? 'ghost' : 'default',
              onClick: 'ai.toggle-command',
              payload: { id: c.id },
            },
          ],
        },
      }
    }

    function allowCommandSection() {
      let all = []
      try {
        all = pickAllowableCommands(command.list())
      } catch {
        all = []
      }
      if (!all.length) {
        return {
          type: 'text',
          value: '还没有可授权的插件命令 —— 装好/启用插件后这里会列出来',
          variant: 'caption',
          tone: 'muted',
        }
      }
      /** @type {import('../../src/kernel/contract').UINode[]} */
      const nodes = []
      const allowed = all.filter((c) => allowedCommands.includes(c.id))
      if (allowed.length) {
        nodes.push({
          type: 'text',
          value: `已授权 ${allowed.length} 条（点「已允许」撤销）`,
          variant: 'caption',
          tone: 'muted',
        })
        nodes.push({ type: 'list', items: allowed.map(commandRow) })
      }
      for (const g of groupCommands(all)) {
        const open = openGroups.has(g.group)
        nodes.push({
          type: 'row',
          align: 'center',
          gap: 'sm',
          children: [
            { type: 'text', value: `${groupLabel(g.items, g.group)} · ${g.group} · ${g.items.length} 条`, variant: 'caption' },
            {
              type: 'button',
              label: open ? '收起' : '展开',
              variant: 'ghost',
              onClick: 'ai.toggle-group',
              payload: { group: g.group },
            },
          ],
        })
        if (open) nodes.push({ type: 'list', items: g.items.map(commandRow) })
      }
      return { type: 'stack', gap: 'sm', children: nodes }
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
        {
          type: 'text',
          value: `用量：${usageText(usageStat)}`,
          variant: 'caption',
          tone: 'muted',
        },
        ...(loadError
          ? [{ type: 'text', value: loadError, variant: 'caption', tone: 'danger' }]
          : []),
        { type: 'divider' },

        /* 首次向导（没走完时替代下面的完整设置区） */
        ...wizardSection(ready),

        /* 待确认（不可逆写操作）—— 放在对话区上方，长对话滚下去也看得见 */
        ...pendingSection(),

        /* 对话区 */
        ...chatSection(ready),

        { type: 'divider' },

        // 向导走完才显示完整设置区（走完前用上面的三步向导，避免两块重复）
        ...(wizardDone ? [
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
        ] : []),

        { type: 'divider' },

        /* 允许 AI 调用的插件命令（rev173.208 · 第二版 plugin.exec） */
        {
          type: 'field',
          label: '允许 AI 调用的命令',
          hint: '只有点过「允许」的插件命令才能被 AI 执行；内核命令与 AI 自己的命令不开放，自动任务同样受此限制',
          children: allowCommandSection(),
        },

        /* 任务入口 + 下一步提示 */
        {
          type: 'row',
          align: 'center',
          wrap: true,
          gap: 'sm',
          children: [
            { type: 'button', label: '任务面板', variant: 'ghost', onClick: 'ai.tasks' },
            {
              type: 'button',
              label: sampling ? '抽样中…' : '分类抽样（20 篇）',
              variant: 'ghost',
              disabled: sampling || !ready,
              onClick: 'ai.sample',
            },
            {
              type: 'text',
              value: tasks.length
                ? `${tasks.length} 个任务（${tasks.filter((t) => t.enabled).length} 启用）· 保存笔记后自动跑`
                : '还没有任务 —— 说一句「每次保存后帮我分类并打标签」就会建一个',
              variant: 'caption',
              tone: 'muted',
            },
          ],
        },
        ...(sampleNote
          ? [{ type: 'text', value: sampleNote, variant: 'caption', tone: 'muted' }]
          : []),
        ...(sampleRows.length
          ? [
              {
                type: 'table',
                columns: [
                  { key: 'path', label: '笔记' },
                  { key: 'dir', label: 'AI 建议文件夹' },
                  { key: 'tags', label: '标签' },
                ],
                rows: sampleRows,
                empty: '还没有结果',
              },
            ]
          : []),
        {
          type: 'text',
          value: ready
            ? '对话已可用：只读工具直接查；改写 / 移动 / 删除会先在上方给预览，点了确认才落盘。'
            : '配好服务商与 API Key 之后就能对话。',
          variant: 'caption',
          tone: 'muted',
        },
      ]

      return { type: 'stack', gap: 'md', children }
    }

    /**
     * 任务面板（rev201 · 需求 Q29「单独一个任务面板」）。
     *
     * 一块面板放全部：任务名 / 触发方式 / 开关 / 指令 / 立即跑 / 删除 / 最近 10 次记录。
     * 记录默认收起（一个任务 10 行 × N 个任务会把面板撑爆），展开状态在内存里。
     */
    function renderTasks() {
      const enabled = tasks.filter((t) => t && t.enabled).length
      /** @type {import('../../src/kernel/contract').UINode[]} */
      const children = [
        {
          type: 'row',
          align: 'center',
          wrap: true,
          gap: 'sm',
          children: [
            { type: 'text', value: 'AI 任务', variant: 'title' },
            { type: 'badge', text: `${tasks.length} 个 · ${enabled} 启用`, tone: enabled ? 'success' : 'muted' },
            { type: 'text', value: taskQueue.depth ? `队列里还有 ${taskQueue.depth} 个` : '串行执行', variant: 'caption', tone: 'muted' },
            {
              type: 'text',
              value: `任务用量：${usageStat.taskCalls ? `${usageStat.taskCalls} 次 · 输入 ${formatTokens(usageStat.taskPrompt)} / 输出 ${formatTokens(usageStat.taskCompletion)} tokens` : '还没有任务调用过模型'}`,
              variant: 'caption',
              tone: 'muted',
            },
          ],
        },
        {
          type: 'text',
          value:
            '任务 = 用一句话定义的规则。`save` 触发的会在**你保存任何公开笔记后**自动跑（最多 4 步工具）；私密 / 回收站 / 收件箱里的笔记不触发。',
          variant: 'caption',
          tone: 'muted',
        },
        ...(taskNote ? [{ type: 'text', value: taskNote, variant: 'caption', tone: 'muted' }] : []),
        { type: 'divider' },
      ]

      if (!tasks.length) {
        children.push({
          type: 'text',
          value: '还没有任务。在 AI 对话里说一句「每次保存后帮我分类并打标签」就会建一个。',
          variant: 'caption',
          tone: 'muted',
        })
      }

      for (const t of tasks) {
        const open = runsOpen.has(t.id)
        const runs = Array.isArray(t.runs) ? t.runs : []
        /** @type {import('../../src/kernel/contract').UINode[]} */
        const kids = [
          { type: 'text', value: t.instruction, variant: 'caption', tone: 'muted' },
          ...(t.lastError
            ? [{ type: 'text', value: `最近失败：${t.lastError}`, variant: 'caption', tone: 'danger' }]
            : []),
          {
            type: 'row',
            align: 'center',
            wrap: true,
            gap: 'sm',
            children: [
              {
                type: 'button',
                label: t.enabled ? '停用' : '启用',
                variant: 'ghost',
                onClick: 'ai.task-toggle',
                payload: { id: t.id },
              },
              { type: 'button', label: '立即跑', onClick: 'ai.task-run', payload: { id: t.id } },
              {
                type: 'button',
                label: open ? '收起记录' : `运行记录 (${runs.length})`,
                variant: 'ghost',
                onClick: 'ai.task-runs',
                payload: { id: t.id },
              },
              { type: 'button', label: '删除', variant: 'danger', onClick: 'ai.task-delete', payload: { id: t.id } },
            ],
          },
          ...(open
            ? runs.length
              ? [
                  {
                    type: 'list',
                    items: runs.map((r) => ({
                      key: String(r.at),
                      node: {
                        type: 'stack',
                        gap: 'sm',
                        children: [
                          {
                            type: 'text',
                            value: runLine(r),
                            variant: 'caption',
                            tone: r.ok ? 'muted' : 'danger',
                          },
                          // 失败的那几步要看得见 —— 否则「任务失败」只是四个字，不知道哪一步、为什么
                          ...(Array.isArray(r.steps) ? r.steps : [])
                            .filter((s) => s && !s.ok)
                            .map((s) => ({
                              type: 'text',
                              value: `　✗ ${s.name}：${s.text}`,
                              variant: 'caption',
                              tone: 'danger',
                            })),
                        ],
                      },
                    })),
                  },
                ]
              : [{ type: 'text', value: '还没有跑过', variant: 'caption', tone: 'muted' }]
            : []),
        ]
        children.push({
          type: 'field',
          label: `${t.name}${t.enabled ? '' : '（已停用）'}`,
          hint: taskHint(t),
          children: { type: 'stack', gap: 'sm', children: kids },
        })
      }

      children.push({ type: 'divider' })
      children.push({
        type: 'text',
        value:
          '自动任务里不能改写正文、不能删除（不可逆操作要人在对话里确认）；移动笔记、打标签、建文件夹可以直接做。',
        variant: 'caption',
        tone: 'muted',
      })
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
      view.registerPanel({
        id: TASKS_PANEL_ID,
        title: 'AI 任务',
        location: 'main',
        render: () => renderTasks(),
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
          // 新对话不清提案：那几份改动还在等着用户点，凭一句"新对话"丢掉太容易误触
          await saveHistory()
          refresh()
        },
      }),
    )

    /**
     * 确认 / 放弃一个提案。
     *
     * 失败时**不删提案**：最常见的原因是「文件在预览后被改过」——
     * 直接抹掉的话用户只看到一行红字，连刚才预览了什么都没了；留着还能点「放弃」或让 AI 重来。
     */
    async function resolveProposal(id, accept) {
      const i = pending.findIndex((p) => p.id === id)
      if (i < 0) return
      const prop = pending[i]
      if (!accept) {
        pending.splice(i, 1)
        actionOk = true
        actionNote = `已放弃：${prop.title}`
        refresh()
        return
      }
      try {
        const extra = await prop.run()
        pending.splice(i, 1)
        actionOk = true
        actionNote = `✓ 已完成：${prop.title}${prop.kind === 'write' ? ` · ${prop.detail}` : ''}`
        if (prop.kind === 'trash' && extra) actionNote += `（回收站：${extra}）`
      } catch (e) {
        actionOk = false
        actionNote = `✗ ${prop.title} 失败：${String(e?.message ?? e)}`
      }
      refresh()
    }

    subscriptions.push(
      command.register({
        id: 'ai.accept',
        title: 'AI：采用待确认的改动',
        run: async (payload) => {
          await resolveProposal(String(payload?.id || ''), true)
        },
      }),
    )

    subscriptions.push(
      command.register({
        id: 'ai.reject',
        title: 'AI：放弃待确认的改动',
        run: async (payload) => {
          await resolveProposal(String(payload?.id || ''), false)
        },
      }),
    )

    /* ───────── 任务面板命令（rev201） ───────── */

    subscriptions.push(
      command.register({
        id: 'ai.toggle-command',
        title: 'AI：切换命令授权',
        run: async (payload) => {
          const id = String(payload?.id ?? '').trim()
          if (!id) return
          allowedCommands = normalizeAllowedCommands(
            allowedCommands.includes(id) ? allowedCommands.filter((x) => x !== id) : [...allowedCommands, id],
          )
          try {
            await store.set('allowedCommands', allowedCommands)
          } catch (e) {
            actionNote = `保存授权失败：${String(e?.message ?? e)}`
            actionOk = false
          }
          refresh()
        },
      }),
    )

    subscriptions.push(
      command.register({
        id: 'ai.toggle-group',
        title: 'AI：展开 / 收起命令分组',
        run: async (payload) => {
          const g = String(payload?.group ?? '').trim()
          if (!g) return
          if (openGroups.has(g)) openGroups.delete(g)
          else openGroups.add(g)
          refresh()
        },
      }),
    )

    subscriptions.push(
      command.register({
        id: 'ai.tasks',
        title: 'AI：打开任务面板',
        run: async () => {
          for (let i = 0; i < 5; i++) {
            try {
              await command.execute(`core.panel.${TASKS_PANEL_ID}`)
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
        id: 'ai.sample',
        title: 'AI：分类抽样（20 篇，人工核对）',
        run: () => runSample(),
      }),
    )

    subscriptions.push(
      command.register({
        id: 'ai.wizard-done',
        title: 'AI：完成首次配置向导',
        run: async () => {
          wizardDone = true
          try {
            await store.set('wizardDone', true)
          } catch (e) {
            host.log('warn', `存向导状态失败：${String(e)}`)
          }
          refresh()
        },
      }),
    )

    subscriptions.push(
      command.register({
        id: 'ai.task-toggle',
        title: 'AI：启用 / 停用任务',
        run: async (payload) => {
          const task = findTask(payload?.id)
          if (!task) return
          task.enabled = !task.enabled
          task.updatedAt = Date.now()
          taskNote = `${task.enabled ? '已启用' : '已停用'}「${task.name}」`
          await saveTasks()
          refreshTasks()
        },
      }),
    )

    subscriptions.push(
      command.register({
        id: 'ai.task-run',
        title: 'AI：立即跑一个任务',
        run: async (payload) => {
          const task = findTask(payload?.id)
          if (!task) return
          queueTask(task, { reason: 'manual' })
          taskNote = `「${task.name}」已排队`
          refreshTasks()
        },
      }),
    )

    subscriptions.push(
      command.register({
        id: 'ai.task-runs',
        title: 'AI：展开 / 收起任务运行记录',
        run: async (payload) => {
          const id = String(payload?.id || '')
          if (!id) return
          if (runsOpen.has(id)) runsOpen.delete(id)
          else runsOpen.add(id)
          refreshTasks()
        },
      }),
    )

    subscriptions.push(
      command.register({
        id: 'ai.task-delete',
        title: 'AI：删除任务',
        run: async (payload) => {
          const id = String(payload?.id || '')
          const i = tasks.findIndex((t) => t && t.id === id)
          if (i < 0) return
          const [gone] = tasks.splice(i, 1)
          runsOpen.delete(id)
          taskNote = `已删除「${gone.name}」`
          await saveTasks()
          refreshTasks()
        },
      }),
    )

    /**
     * 事件触发（需求 §3.2）：**用户保存笔记** ⇒ 匹配任务 ⇒ 入串行队列。
     *
     * 注意四件事：
     * ① 插件自己写盘走 `note:changed`（不触发 saved）⇒ 任务里移动笔记**不会**递归触发自己；
     * ② 私密 / 回收站 / 收件箱的路径先被 `skipForTasks` 挡掉（Q24）；
     * ③ **同一路径 3 秒内只触发一次**：编辑器保存 + 自动保存会连着发两次 `note:saved`
     *    （rev201 实测：相隔 200 ms 两次，第一次把文件移走，第二次就"源不存在"全失败）；
     * ④ 回调必须 try/catch —— 事件总线上抛错会惊动其它订阅者（与内核同一条规矩）。
     */
    const lastTriggerAt = new Map()
    const TRIGGER_DEBOUNCE_MS = 3000

    subscriptions.push(
      event.on('note:saved', (payload) => {
        try {
          const path = String(payload?.path ?? '')
          if (!path || skipForTasks(path)) return
          const now = Date.now()
          const prev = lastTriggerAt.get(path) ?? 0
          if (now - prev < TRIGGER_DEBOUNCE_MS) return
          const hits = matchTasks(tasks, { type: 'save', path })
          if (!hits.length) return
          lastTriggerAt.set(path, now)
          for (const t of hits) {
            queueTask(t, { reason: 'save', path })
            taskNote = `「${t.name}」因 ${path} 保存而触发`
            refreshTasks()
          }
        } catch (e) {
          host.log('warn', `AI 任务触发失败：${String(e)}`)
        }
      }),
    )

    // 定时器与进行中的请求不归宿主管，卸载时自己收尾（否则重载会留下孤儿流）
    subscriptions.push({
      dispose: () => {
        disposed = true
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
