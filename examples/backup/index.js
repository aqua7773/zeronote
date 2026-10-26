/**
 * 备份（backup）—— 需求 §14.1「自动备份」/ §18 阶段 3 的遗留项（rev173.175）。
 *
 * 为什么需要它：库里已经有历史版本（按笔记存快照）、同步（把库搬到别处）、
 * 回收站（删了能找回），但**没有「整个库的时序副本」** —— 误删一个文件夹、
 * 插件写坏一批笔记、库放在坏盘上，前面三样都救不了。
 *
 * 备份长什么样（目录 = 一份备份，跟库走、拷库就带着）：
 *
 *   <库>/.zn/backups/
 *     index.json                     ← 清单（本插件唯一写入的索引）
 *     2026-10-26T14-30-00/
 *       <库根的所有文件与一级目录>     ← 公开笔记 + 附件，**明文**
 *       _secret/secrets.zn           ← 密码库密文（有才拷）
 *       _secret/vault.json           ← KDF salt + 被主密码包裹的 DEK
 *       _meta.json                   ← 这份备份的时间 / 来源 / 规模
 *
 * 三条设计决定（别随手改）：
 *   1. **明文 + 密文原样搬，不自己加密**：密码库本来就是 XChaCha20-Poly1305 密文，
 *      它的钥匙是主密码；再包一层只会要求备份时也知道主密码（锁着的时候就备不了）。
 *      所以「加密复用主密码」在实现上 = **原样拷密文**，解铃还须系铃人。
 *   2. **清单放 index.json 而不是靠列目录**：内核 `fs.listDirs()` 会跳过 `.` 开头的目录
 *      （`collect_dirs` 第 4 行），`.zn/backups/*` 因此**列不出来**；`fs.listFiles('.zn/backups')`
 *      可以读该目录下的**文件**（`list_files` 不跳过 `.zn`）。清单是唯一可靠来源。
 *   3. **备份内部不复制 `.zn`**：`fs.copy` 本身就跳过私有目录（契约 §1.1），
 *      所以同步状态、插件、历史快照都不会被塞进备份 —— 要备份的只有「笔记 + 密码库密文」。
 *
 * 安全边界：删旧备份走 `fs.purgeBackup`（rev173.175 新增内核命令），它只认
 * `.zn/backups/` 下的**一级名字**，越界在 Rust 侧硬拒。本插件不碰库外任何路径。
 */

/** 主区面板（与 outline-map / doc-reader 同一形态：进标签条、可拖出独立窗口） */
const PANEL_ID = 'backup.board'
/** 备份根目录（库内相对路径）—— 跟着库走，换电脑拷库就带着 */
const DIR = '.zn/backups'
/** 清单文件：备份列表的唯一可靠来源（`listDirs()` 列不出 `.zn` 下的目录） */
const INDEX_PATH = `${DIR}/index.json`
/** 需求 §14.1：固定保留最近 30 份 */
const KEEP = 30
/** 清单格式版本（以后要迁移时认它） */
const INDEX_VERSION = 1

/**
 * 密码库要随包的文件 —— 两个都是**密文/元数据**，不会把明文密码带出去。
 * `vault.json` 是 KDF salt 与被主密码包裹的 DEK，**少了它另一台拿到密文也解不开**。
 */
const SECRET_FILES = [
  { from: '.zn/secrets/secrets.zn', to: '_secret/secrets.zn' },
  { from: '.zn/security/vault.json', to: '_secret/vault.json' },
]

/**
 * 自动备份档位（需求 §14.1 的九个固定档）。**默认每天**（需求写死）。
 *
 * 「每月」按 30 天算而不是日历月 —— 备份间隔不需要对齐日历，反而日历月会让
 * 「下次什么时候」变得难解释；30 天与需求「每月」的意图一致。
 */
const INTERVALS = [
  { value: '1h', label: '每小时', ms: 3600e3 },
  { value: '3h', label: '每 3 小时', ms: 3 * 3600e3 },
  { value: '6h', label: '每 6 小时', ms: 6 * 3600e3 },
  { value: '12h', label: '每 12 小时', ms: 12 * 3600e3 },
  { value: '1d', label: '每天', ms: 86400e3 },
  { value: '2d', label: '每 2 天', ms: 2 * 86400e3 },
  { value: '3d', label: '每 3 天', ms: 3 * 86400e3 },
  { value: '1w', label: '每周', ms: 7 * 86400e3 },
  { value: '1mo', label: '每月', ms: 30 * 86400e3 },
]
/** 需求 §14.1：默认每天 */
const DEFAULT_INTERVAL = '1d'
/**
 * 检查周期：每 60 秒看一眼「到期没有」。
 *
 * 为什么不直接按档位设一个长定时器：**页面关掉定时器就没了**（没有后台服务，
 * 契约也没有定时原语）。60 秒轮询 + 启动时补做，才能在「关机一夜后重开」时
 * 立刻补一份，而不是又等一整天。
 */
const TICK_MS = 60_000
/** 自动备份配置的 store 键（`{ interval, lastAt }`） */
const CONFIG_KEY = 'backup:config'

/* ───────────────────────── 纯函数（tests/backup.test.ts 单测） ───────────────────────── */

const pad = (n) => String(n).padStart(2, '0')

/**
 * 备份目录名 = 本地时间的 `YYYY-MM-DDTHH-mm-ss`。
 *
 * 为什么不用毫秒：目录名要能**字典序排序**（`pickStale` 靠它挑最老的），
 * 秒精度已经够 —— 同一秒连点两次会被 `mkdir` 重复（幂等），不会产生两份同名备份。
 */
export function backupName(date) {
  const d = date instanceof Date ? date : new Date(date ?? Date.now())
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  )
}

/** 目录名 → 面板上的人话：`2026-10-26T14-30-00` ⇒ `10-26 14:30:00`（失败原样返回） */
export function formatName(name) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})$/.exec(String(name ?? '').trim())
  if (!m) return String(name ?? '')
  return `${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`
}

/**
 * 挑出该删的旧备份（保留最近 `keep` 份，**返回要删的**，不返回保留的）。
 *
 * 排序依据是目录名（= 时间序）；同一时间戳理论上不会重复。非法条目（没有 name）跳过。
 * 反向验证过：把 `keep` 判断改成 `>=` 会多删一份，测试立刻红。
 */
export function pickStale(items, keep = KEEP) {
  const rows = (Array.isArray(items) ? items : [])
    .map((it) => ({ name: String(it?.name ?? ''), at: Number(it?.at) || 0 }))
    .filter((it) => it.name !== '')
    .sort((a, b) => b.name.localeCompare(a.name))
  const k = Number.isFinite(keep) && keep > 0 ? Math.floor(keep) : KEEP
  return rows.slice(k)
}

/** 人话大小（面板用得上；备份体积靠 `listNotes` 的 mtime 不算，这条给未来的字节统计留着） */
export function formatSize(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/**
 * 解析清单。**任何异常都返回空表**，不抛 —— 一份坏掉的 index.json 不该让面板整页崩掉
 * （磁盘被外部工具改过、写到一半断电都可能坏）。旧格式（裸数组）也认。
 */
export function parseIndex(text) {
  try {
    const raw = JSON.parse(String(text ?? ''))
    const items = Array.isArray(raw) ? raw : raw?.items
    if (!Array.isArray(items)) return []
    return items
      .map((it) => ({
        name: String(it?.name ?? ''),
        at: Number(it?.at) || 0,
        trigger: String(it?.trigger ?? 'manual'),
        notes: Number(it?.notes) || 0,
        dirs: Number(it?.dirs) || 0,
        files: Number(it?.files) || 0,
        secret: Boolean(it?.secret),
        ms: Number(it?.ms) || 0,
      }))
      .filter((it) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(it.name))
  } catch {
    return []
  }
}

/** 清单 → 面板行 */
export function toRows(items) {  return (Array.isArray(items) ? items : []).map((it) => ({
    name: String(it?.name ?? ''),
    label: formatName(it?.name),
    notes: Number(it?.notes) || 0,
    dirs: Number(it?.dirs) || 0,
    secret: Boolean(it?.secret),
    trigger: String(it?.trigger ?? 'manual'),
    ms: Number(it?.ms) || 0,
  }))
}

/* ── 自动备份档位（rev173.176） ── */

/** 档位 → 毫秒；未知值回落默认档（防 store 里存了旧档位 / 手工改坏） */
export function intervalMs(value) {
  const hit = INTERVALS.find((i) => i.value === value)
  return hit ? hit.ms : INTERVALS.find((i) => i.value === DEFAULT_INTERVAL).ms
}

/** 档位 → 人话；未知值给默认档的说法 */
export function intervalLabel(value) {
  const hit = INTERVALS.find((i) => i.value === value)
  return hit ? hit.label : INTERVALS.find((i) => i.value === DEFAULT_INTERVAL).label
}

/**
 * 该不该备份了。
 *
 * 三条判据（都有单测）：
 *   · **从没备份过**（`lastAt = 0`）⇒ 立刻备 —— 新库 / 刚装插件时不该等一整天；
 *   · `now - lastAt >= 档位` ⇒ 到期；
 *   · 其余 ⇒ 不到期。反向验证过：把 `>=` 改成 `>` 会让「正好到期」那条例红。
 */
export function isDue(lastAt, value, now = Date.now()) {
  const last = Number(lastAt) || 0
  if (!last) return true
  return Number(now) - last >= intervalMs(value)
}

/** 下次到期的时间戳（从没备过 ⇒ 0，表示「立刻」） */
export function dueAt(lastAt, value) {
  const last = Number(lastAt) || 0
  return last ? last + intervalMs(value) : 0
}

const pad2 = (n) => String(n).padStart(2, '0')
/** 时间戳 → `MM-DD HH:mm`（面板 caption 用；跨年时带上年份） */
export function stamp(ms, now = Date.now()) {
  const t = Number(ms)
  if (!Number.isFinite(t) || t <= 0) return '—'
  const d = new Date(t)
  const sameYear = new Date(now).getFullYear() === d.getFullYear()
  const md = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  return sameYear ? `${md} ${hm}` : `${d.getFullYear()}-${md} ${hm}`
}

/**
 * 面板上那行「自动备份」的说法。三种状态各有各的信息量：
 * 从没备过 / 已到期待补 / 正常（上次 + 下次）。
 */
export function dueText(lastAt, value, now = Date.now()) {
  const last = Number(lastAt) || 0
  if (!last) return `自动备份：${intervalLabel(value)} · 还没备份过，下一轮检查会立刻补一份`
  if (isDue(last, value, now)) {
    return `自动备份：${intervalLabel(value)} · 上次 ${stamp(last, now)} · 已到期，马上补一份`
  }
  return `自动备份：${intervalLabel(value)} · 上次 ${stamp(last, now)} · 下次 ${stamp(dueAt(last, value), now)}`
}

/**
 * select 的选项顺序：**当前档位排第一**。
 *
 * 为什么要这个 hack：`select` 的值来自宿主 `ctx.state[bind]`，插件**没有**直接写它的接口；
 * 首次渲染时 state 为空 ⇒ 浏览器选中第一项。把当前档位放第一项，画面就与真实配置一致
 * （否则明明设的是「每周」，控件却显示「每小时」）。用户选过之后 state 有值，按 value 匹配即可。
 */
export function selectOptions(value) {
  const cur = INTERVALS.find((i) => i.value === value) ?? INTERVALS.find((i) => i.value === DEFAULT_INTERVAL)
  return [cur, ...INTERVALS.filter((i) => i.value !== cur.value)].map((i) => ({
    value: i.value,
    label: i.label,
  }))
}

/**
 * 面板视图（纯数据，UINode）。
 *
 * 空态要区分「还没备过」与「清单坏了」—— 两者都给「立即备份」，但文案不同
 * （硬约束 4：静默失效比报错危险）。
 */
export function panelNode(view) {
  const {
    rows = [],
    status = '',
    running = false,
    broken = false,
    interval = DEFAULT_INTERVAL,
    lastAt = 0,
  } = view ?? {}
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
          { type: 'text', value: '备份', variant: 'title' },
          { type: 'badge', text: `${rows.length} / ${KEEP}` },
          {
            type: 'button',
            label: running ? '备份中…' : '立即备份',
            onClick: 'backup.run',
          },
          { type: 'button', label: '刷新', onClick: 'backup.refresh', variant: 'ghost' },
        ],
      },
      ...(status
        ? [{ type: 'text', value: status, variant: 'caption', tone: running ? 'muted' : 'default' }]
        : []),
      {
        type: 'row',
        align: 'center',
        wrap: true,
        gap: 'sm',
        children: [
          { type: 'text', value: '自动备份', variant: 'caption' },
          {
            type: 'select',
            bind: 'backup.interval',
            options: selectOptions(interval),
            onSubmit: 'backup.set-interval',
          },
        ],
      },
      { type: 'text', value: dueText(lastAt, interval), variant: 'caption', tone: 'muted' },
      { type: 'divider' },
      {
        type: 'list',
        empty: broken
          ? '备份清单读不出来（`.zn/backups/index.json` 损坏）。备份目录本身可能还在，先看看磁盘。'
          : '还没有备份。点「立即备份」存一份 —— 含公开笔记与密码库密文，保留最近 30 份。',
        items: rows.map((r) => ({
          key: r.name,
          node: {
            type: 'row',
            align: 'center',
            wrap: true,
            gap: 'sm',
            children: [
              { type: 'text', value: r.label },
              { type: 'badge', text: `${r.notes} 篇` },
              ...(r.dirs > 0 ? [{ type: 'badge', text: `${r.dirs} 个文件夹` }] : []),
              ...(r.secret ? [{ type: 'badge', text: '含密码库', tone: 'success' }] : []),
              { type: 'badge', text: r.trigger === 'manual' ? '手动' : '自动' },
              {
                type: 'button',
                label: '删除',
                onClick: 'backup.remove',
                payload: { name: r.name },
                variant: 'ghost',
              },
            ],
          },
        })),
      },
      {
        type: 'text',
        value: `位置：<库>/${DIR}/ · 保留最近 ${KEEP} 份 · 密码库以密文随包（复用主密码，不需要解锁）`,
        variant: 'caption',
        tone: 'muted',
      },
    ],
  }
}

/* ───────────────────────── 插件本体 ───────────────────────── */

export default {
  apply(api) {
    let rows = []
    let status = ''
    let running = false
    let broken = false
    /** 自动备份配置（rev173.176）：档位 + 上次成功备份的时间戳 */
    let config = { interval: DEFAULT_INTERVAL, lastAt: 0 }
    /** 60 秒轮询的句柄（卸载时清掉） */
    let ticker = 0
    /** 串行闸门：连点「立即备份」不该起两个并发拷贝（同一秒同名会互相覆盖） */
    let busy = false

    const refresh = () => api.view.refresh(PANEL_ID)

    api.subscriptions.push(
      api.view.registerPanel({
        id: PANEL_ID,
        title: '备份',
        location: 'main',
        render: () => panelNode({ rows, status, running, broken, interval: config.interval, lastAt: config.lastAt }),
      }),
    )

    /** 读清单（容错：文件不在 = 空表；解析失败 = 空表 + broken 标记） */
    async function loadIndex() {
      try {
        if (!(await api.fs.exists(INDEX_PATH))) {
          broken = false
          return []
        }
        const text = await api.fs.readText(INDEX_PATH)
        const items = parseIndex(text)
        // 解析出 0 条但文件非空 ⇒ 认为清单坏了（不静默当成"还没备份"）
        broken = items.length === 0 && String(text ?? '').trim() !== '' && String(text).trim() !== '{}'
        return items
      } catch {
        broken = true
        return []
      }
    }

    async function saveIndex(items) {
      await api.fs.writeText(
        INDEX_PATH,
        JSON.stringify({ version: INDEX_VERSION, items }, null, 2),
      )
    }

    /* ── 自动备份配置（rev173.176） ── */

    /** 读配置；读不到 / 坏值一律回落默认（默认每天、从未备份 ⇒ 启动就补一份） */
    async function loadConfig() {
      try {
        const raw = await api.store.get(CONFIG_KEY, null)
        const interval = String(raw?.interval ?? DEFAULT_INTERVAL)
        config = {
          interval: INTERVALS.some((i) => i.value === interval) ? interval : DEFAULT_INTERVAL,
          lastAt: Number(raw?.lastAt) || 0,
        }
      } catch {
        config = { interval: DEFAULT_INTERVAL, lastAt: 0 }
      }
    }

    async function saveConfig(patch) {
      config = { ...config, ...patch }
      try {
        await api.store.set(CONFIG_KEY, config)
      } catch (e) {
        // store 写失败不该让备份本身失败：内存里仍是新值，面板照实显示
        status = `保存自动备份配置失败：${String(e)}`
      }
    }

    /** 每轮检查：到期就备一份。`busy` 挡住手动备份期间的并发 */
    async function tick() {
      if (busy) return
      if (!isDue(config.lastAt, config.interval)) return
      // 空库不备 —— 否则新装的应用每次启动都塞一份空备份进列表
      try {
        const notes = await api.fs.listNotes()
        const dirs = await api.fs.listDirs()
        if (notes.length === 0 && dirs.length === 0) {
          status = '库是空的，跳过自动备份'
          refresh()
          return
        }
      } catch {
        /* 列不出来就照常尝试备份，让真正的错误在备份里暴露 */
      }
      await runBackup('auto')
    }

    /** 清单 + 真实目录对齐：手动删掉过目录的条目剔除掉，免得点「删除」才报错 */
    async function liveItems(items) {
      const out = []
      for (const it of items) {
        if (await api.fs.exists(`${DIR}/${it.name}`)) out.push(it)
      }
      return out
    }

    /**
     * 跑一次备份。`trigger` 只影响清单里记的字段（手动 / 自动）。
     *
     * 顺序：建目录 → 拷库根文件 → 拷库根一级目录 → 拷密码库密文 → 写 meta
     *       → 更新清单 → 轮换旧备份。**任何一步抛错都保留已完成的那份**（半份备份好过没有），
     * 只在状态栏报错；清单最后才写，所以失败的那次不会进列表。
     */
    async function runBackup(trigger = 'manual') {
      if (busy) return
      busy = true
      running = true
      status = '正在备份…'
      refresh()
      const started = Date.now()
      try {
        const name = backupName(new Date())
        const root = `${DIR}/${name}`
        await api.fs.mkdir(root)

        // ① 库根文件（跳过 `.` 开头的；它们要么是系统文件，要么已经单独处理）
        const rootFiles = (await api.fs.listFiles()).filter(
          (f) => !f.startsWith('.') && !f.includes('/'),
        )
        for (const f of rootFiles) await api.fs.copy(f, `${root}/${f}`)

        // ② 库根一级目录（`listDirs` 是递归的，只取第一层；`.zn` 与隐藏目录天然被跳过）
        const rootDirs = (await api.fs.listDirs()).filter(
          (d) => !d.startsWith('.') && !d.includes('/'),
        )
        for (const d of rootDirs) await api.fs.copy(d, `${root}/${d}`)

        // ③ 密码库密文（有才拷 —— 没装 secrets / security 的库不该因此失败）
        let secret = false
        for (const s of SECRET_FILES) {
          if (await api.fs.exists(s.from)) {
            await api.fs.writeBytes(`${root}/${s.to}`, await api.fs.readBytes(s.from))
            secret = true
          }
        }

        const notes = (await api.fs.listNotes()).length
        const meta = {
          at: started,
          trigger,
          notes,
          dirs: rootDirs.length,
          files: rootFiles.length,
          secret,
          ms: Date.now() - started,
        }
        await api.fs.writeText(`${root}/_meta.json`, JSON.stringify(meta, null, 2))

        // ④ 清单 + 轮换（先算要删的，删完再写清单，避免"清单里有、盘上没了"）
        const kept = (await liveItems(await loadIndex())).filter((it) => it.name !== name)
        const next = [{ name, ...meta }, ...kept].sort((a, b) => b.name.localeCompare(a.name))
        const stale = pickStale(next, KEEP)
        for (const s of stale) {
          try {
            await api.fs.purgeBackup(s.name)
          } catch (e) {
            // 单份删不掉不拖累整次备份：记进状态，清单照写
            status = `旧备份「${formatName(s.name)}」删不掉：${String(e)}`
          }
        }
        const staleNames = new Set(stale.map((s) => s.name))
        const finalItems = next.filter((it) => !staleNames.has(it.name))
        await saveIndex(finalItems)
        // 手动也算「刚备过」：否则点完「立即备份」，60 秒后自动备份又立刻来一份
        await saveConfig({ lastAt: Date.now() })
        broken = false
        rows = toRows(finalItems)
        if (!String(status).startsWith('旧备份')) {
          status = `已备份 ${notes} 篇 · ${rootDirs.length} 个文件夹${secret ? ' · 含密码库密文' : ''} · ${meta.ms} ms`
        }
        api.host.notify('备份完成', 'info')
      } catch (e) {
        status = `备份失败：${String(e)}`
        api.host.notify(status, 'error')
      } finally {
        running = false
        busy = false
        refresh()
      }
    }

    async function reloadRows() {
      rows = toRows(await liveItems(await loadIndex()))
      refresh()
    }

    api.subscriptions.push(
      api.command.register({
        id: 'backup.run',
        title: '备份：立即备份',
        run: () => runBackup('manual'),
      }),
    )

    api.subscriptions.push(
      api.command.register({
        id: 'backup.refresh',
        title: '备份：刷新列表',
        run: async () => {
          status = ''
          await reloadRows()
        },
      }),
    )

    api.subscriptions.push(
      api.command.register({
        id: 'backup.remove',
        title: '备份：删除这一份',
        run: async (payload) => {
          const name = String(payload?.name ?? '').trim()
          if (!name) return
          try {
            await api.fs.purgeBackup(name)
            const items = (await loadIndex()).filter((it) => it.name !== name)
            await saveIndex(items)
            rows = toRows(items)
            status = `已删除 ${formatName(name)}`
          } catch (e) {
            status = `删除失败：${String(e)}`
            api.host.notify(status, 'error')
          }
          refresh()
        },
      }),
    )

    /**
     * 打开面板。`core.panel.<id>` 由内核为每个面板注册，但要等插件加载后的下一次 React 提交
     * 才存在 ⇒ 冷启动先重试几次（doc-reader / tag-panel 同样做法）。
     */    api.subscriptions.push(
      api.command.register({
        id: 'backup.set-interval',
        title: '备份：设置自动备份档位',
        run: async (payload) => {
          const next = String(payload?.value ?? '').trim()
          if (!INTERVALS.some((i) => i.value === next)) return
          await saveConfig({ interval: next })
          status = `自动备份改为：${intervalLabel(next)}`
          refresh()
          // 改成更短的档位后可能立刻到期 —— 马上看一眼，不必等下一轮 60 秒
          void tick()
        },
      }),
    )

    api.subscriptions.push(
      api.command.register({
        id: 'backup.open',
        title: '备份：打开备份面板',
        run: async () => {
          for (let i = 0; i < 5; i++) {
            try {
              await api.command.execute(`core.panel.${PANEL_ID}`)
              return
            } catch (e) {
              if (i === 4) throw e
              await new Promise((r) => setTimeout(r, 120))
            }
          }
        },
      }),
    )

    /**
     * 启动序列（rev173.176）：先读配置与清单，再**立刻补一次**到期检查 ——
     * 页面关掉期间定时器不存在，错过的那次靠这里补上，而不是又等一个整档位。
     * 之后每 60 秒看一眼。
     */
    void (async () => {
      await loadConfig()
      await reloadRows()
      void tick()
      ticker = setInterval(() => {
        void tick()
      }, TICK_MS)
      api.subscriptions.push({
        dispose: () => {
          if (ticker) clearInterval(ticker)
          ticker = 0
        },
      })
    })()
  },
}
