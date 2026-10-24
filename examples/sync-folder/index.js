/**
 * 同步 · 本地文件夹（sync-folder）—— rev173.107
 *
 * ## 它做什么、不做什么
 *
 * **不搬文件**。库本身放在用户自己的同步目录里（Syncthing / OneDrive / 坚果云客户端 /
 * 局域网 SMB），搬运交给那个工具。本插件只做那三件同步工具**不做**的事：
 *   ① 发现"别人改了我的笔记"（内核的 `note:changed` 已过滤自写回响，直接可用）
 *   ② 判定"双端都改了"（本机在某次外部改动之前也保存过 ⇒ 冲突）
 *   ③ 冲突留副本到 `.zn/conflicts/<平台>/`，绝不静默丢弃任何一边
 *
 * 依据：`docs/同步插件-调研与方案-2026-10-24.md` §5.0「本地文件夹」行、
 * 方案 A 的判定模型（§1.4 事件表 + §6.1 冲突副本位置）。
 *
 * ## 判定模型（这是整个插件的心脏）
 *
 * 三种状态，全部落在 `store`：
 *   · `baseline[path] = { fp, at }`  —— **双方一致**的版本（最后一次确认同步的内容指纹）
 *   · `pending[path]  = { fp, at }`  —— 本机改过、**还没确认被同步工具搬走**的版本
 *   · `conflicts[]`                   —— 冲突记录（面板展示用）
 *
 * 为什么不能在本机保存时直接更新 baseline：那样"本机改完、同步还没传出去、对端又改了"
 * 就会变成「只有外部变了」⇒ 本地改动被静默覆盖。所以保存只写 pending，
 * **等 `SETTLE_MS` 静默期**（默认 20 秒，够 Syncthing 传一轮）才升为 baseline。
 *
 * 判定（`classifyChange`，纯函数，单测覆盖）：
 *   | baseline | pending | 磁盘指纹 | 结论 |
 *   |---|---|---|---|
 *   | 无 | 无 | 任意 | `new` ⇒ 收下并记基线 |
 *   | 有 | 无 | == baseline | `noop` |
 *   | 有 | 无 | != baseline | `remote` ⇒ 别处更新，收下 |
 *   | 有 | 有（内容） | == pending | `noop`（自己那版被同步工具搬回来了） |
 *   | 有 | 有（内容） | != pending 且 != baseline | `conflict` ⇒ 留副本 |
 *   | 有 | 有（删除） | 任意 | `remote` ⇒ 本地删了但别处还有，**恢复别处的** |
 *
 * ## 冲突副本
 *
 * 本机修改的正文在 `note:saved` 时**另存一份**到 `<库>/.zn/sync/last/<hash32(path)>.md`
 * （库外的影子副本，不进文件树）—— 因为磁盘被覆盖之后，本地版就只活在这里。
 * 冲突时把它复制成 `<库>/.zn/conflicts/<平台>/<YYYY-MM-DD HHmm>-<文件名>`。
 *
 * ⚠️ `.zn/` **必须**在同步工具的排除列表里，否则私有快照也会被同步（面板会提醒）。
 */

const PANEL_ID = 'sync-folder.status'
const KEY_BASELINE = 'baseline.v1'
const KEY_PENDING = 'pending.v1'
const KEY_CONFLICTS = 'conflicts.v1'
/** 插件设置（rev173.112：目前只有 enabled —— 停用后不再自动扫描，事件照常记账） */
const KEY_SETTINGS = 'settings.v1'

/** 本机版本影子副本（冲突时的那份"我的"） */
const SNAPSHOT_DIR = '.zn/sync/last'
/** 冲突副本根（方案 §6.1：按平台分文件夹） */
const CONFLICT_ROOT = '.zn/conflicts'

/** 静默期：本机保存后多久没有外部改动，就认为同步工具已经把它搬走 */
const SETTLE_MS = 20_000
/** 结算节拍（只看时间戳，不碰磁盘） */
const TICK_MS = 5_000
/** 冲突列表上限（面板只展示最近的） */
const MAX_CONFLICTS = 100

/* ───────────────────────── 纯函数（tests/sync-folder.test.ts 单测） ───────────────────────── */

/**
 * 内容指纹：长度 + FNV-1a 32 位。
 *
 * 为什么不用 `crypto.subtle`：它是 async，且旧 Android WebView 不一定有
 * （rev173.77 验插件签名时为这个原因改用纯 Rust）。这里要的是「两个版本是不是同一份」，
 * 不需要抗碰撞的强 hash —— 长度 + 32 位散列足够把「不同笔记误判成同一份」压到可忽略。
 */
export function fingerprint(text) {
  const s = typeof text === 'string' ? text : String(text ?? '')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    // FNV-1a 的乘法：h * 16777619，用移位避免浮点溢出
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0
  }
  return `${s.length.toString(36)}:${h.toString(36)}`
}

/** 短散列（路径 → 影子副本文件名用），同一份实现，只为不引第二套算法 */
export function shortHash(s) {
  return fingerprint(String(s ?? '')).split(':')[1] ?? '0'
}

/**
 * 判定一次外部改动。
 *
 * @param {{fp: string} | null | undefined} base    基线版本
 * @param {{fp?: string, deleted?: boolean} | null | undefined} pending 本机待同步版本
 * @param {string} remoteFp                          磁盘上的当前指纹
 * @returns {'new'|'noop'|'remote'|'conflict'|'local-pending'}
 */
export function classifyChange({ base, pending, remoteFp }) {
  const hasPending = !!(pending && (pending.deleted || pending.fp))
  if (!base && !hasPending) return 'new'
  if (!hasPending) return base.fp === remoteFp ? 'noop' : 'remote'
  // 本机删过：别处还有这文件 ⇒ 恢复别处的（方案 A：本地删、外部改 ⇒ 恢复外部版）
  if (pending.deleted) return 'remote'
  if (pending.fp === remoteFp) return 'noop'
  if (base && base.fp === remoteFp) return 'local-pending'
  return 'conflict'
}

/** 两位补零 */
function pad2(n) {
  return String(n).padStart(2, '0')
}

/**
 * 冲突副本的文件名：`<YYYY-MM-DD HHmm>-<原标题>.md`。
 *
 * 不用 `:`（Windows 文件名非法），用空格 + 四位时分。同名已存在 ⇒ 追加 `-2`、`-3`。
 *
 * @param {{path: string, at: number}} args
 * @param {(name: string) => boolean} taken 该名是否已被占用（由调用方查磁盘/记录）
 */
export function conflictFileName({ path, at }, taken = () => false) {
  const d = new Date(at)
  const stamp = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}${pad2(d.getMinutes())}`
  const file =
    String(path ?? '')
      .split('/')
      .pop() || 'note.md'
  const base = file.replace(/\.md$/i, '') || 'note'
  let name = `${stamp}-${base}.md`
  let i = 2
  while (taken(name)) {
    name = `${stamp}-${base}-${i}.md`
    i += 1
  }
  return name
}

/**
 * 冲突时尝试**三方合并**（rev173.116）。
 *
 * 与 `sync-webdav.tryAutoMerge` 同一条判据（两个插件各自一份 —— 插件之间不能互相 import）。
 * 输入三方：`base` = 上次两端一致时的内容（history 同步点）· `mine` = 本机版（影子副本）·
 * `theirs` = 磁盘上的外部版。**只有完全合上（0 处真冲突）才返回文本** —— 有真冲突时自动选边
 * 会让用户以为已经合好了；那种情况交给「留副本」。
 *
 * @param {{ base?: string|null, mine?: string|null, theirs?: string|null, mergeLines?: Function }} args
 * @returns {{ text: string } | null}
 */
export function tryAutoMerge({ base, mine, theirs, mergeLines }) {
  if (typeof base !== 'string' || typeof mine !== 'string' || typeof theirs !== 'string') return null
  if (typeof mergeLines !== 'function') return null
  // 只有一边变过 ⇒ 不是"双端都改"，交给 classifyChange 的普通分支
  if (base === mine || base === theirs) return null
  let r
  try {
    r = mergeLines(base, mine, theirs)
  } catch {
    return null // 合并实现抛错 ⇒ 退回「留副本」，不丢字
  }
  if (!r || !Number.isFinite(r.conflicts) || r.conflicts > 0) return null
  if (typeof r.text !== 'string') return null
  // 合出来还是外部版 ⇒ 本机改动在外部已存在，没必要多写一次盘（写盘还会触发 note:saved）
  if (r.text === theirs) return null
  return { text: r.text }
}

/** 影子副本路径（`<库>/.zn/sync/last/<hash32>.md`） */
export function snapshotPath(path) {
  return `${SNAPSHOT_DIR}/${shortHash(path)}.md`
}

/**
 * 这条路径算不算要同步的笔记。
 *
 * **必须排掉 `.zn/`**：影子副本、冲突副本、历史快照都是 `.md`，内核在 rev173.107 已不再
 * 为它们发 `note:saved`（`fs-events.ts`），但插件这一侧也自己判一道 —— 两个理由：
 *   · 本插件会写 `.zn/` 下的文件（影子副本 / 冲突副本），一旦事件漏过来就**自我递归**
 *     （实测踩过：每写一份副本又触发一次保存，几秒内 1900 多次 writeText）；
 *   · 插件不该依赖"内核将来还记得过滤"。
 */
export function isSyncable(path) {
  const s = String(path ?? '')
  if (!/\.md$/i.test(s)) return false
  if (s.startsWith('.zn/') || s === '.zn') return false
  return !s.split('/').includes('.zn')
}

/**
 * 文件名像不像「外部同步工具自己造的冲突副本」？—— `.zn/` **没被排除**的痕迹（rev173.114）。
 *
 * 插件管不到 Syncthing / OneDrive / 坚果云的排除配置，但可以在私有目录里找它们留下的指纹：
 * · Syncthing：`<名>.sync-conflict-20261024-123456-ABCDEF.md`
 * · OneDrive / Windows：`<名>-主机名.md`、`<名> (conflicted copy).md`
 * · 坚果云 / 中文客户端：`<名> (冲突副本).md`
 *
 * 注意：**不能**把 `2026-10-24 2053-双链验收.md` 这种自己的冲突副本当命中（没有「副本 / 冲突」关键词）。
 */
export function looksLikeSyncConflict(name) {
  const s = String(name ?? '')
  if (!s) return false
  return (
    /\.sync-conflict-/i.test(s) ||
    /conflicted copy/i.test(s) ||
    /\(冲突/.test(s) ||
    /冲突副本/.test(s)
  )
}

/* ───────────────────────── 插件本体 ───────────────────────── */

export default {
  apply(api) {
    const platform = api.host.platform === 'android' ? 'android' : 'windows'

    /** 内存里的三份状态（落盘在 persist） */
    let baseline = {}
    let pending = {}
    let conflicts = []
    /**
     * 插件设置（rev173.112）。`enabled: false` = 停止**自动**扫描：
     * 定时检查 / 启动检查 / 回到前台检查都不跑，事件监听仍然照常记账
     * （停用期间的本地改动不能丢，否则重新启用会把它当成外部改动）。
     * 手动「立即检查」「把当前设为基线」不受影响。
     */
    let settings = { enabled: true }
    /** `.zn/` 被外部同步工具碰过的痕迹（rev173.114）：命中的文件路径 */
    let znHits = []
    /** 最近一次 `.zn/` 检查时间（0 = 还没查过） */
    let znCheckedAt = 0
    let ready = false
    /** 脏标记：有变化才写 store（5 秒节拍里大多数轮次什么都不干） */
    let dirty = false
    /** 面板上"最近一次检查"的时间戳 */
    let lastScanAt = 0
    /**
     * 上一次全库扫描花了多久（rev173.117 同步耗时统计）。
     *
     * 本地文件夹后端没有网络往返，但库大的时候「读全部笔记算指纹」一样会卡 ——
     * 面板上给出这个数，用户能判断慢是同步还是别处。
     */
    let lastScanMs = 0
    /** 扫描中（防重入） */
    let scanning = false
    /**
     * 自己写盘的抑制表（rev173.116）：path → 期望的指纹。
     * 三方合并的结果要写回磁盘，而写盘会触发内核 `note:saved`；不挡住的话这次写会被当成
     * "本机又改了一次" ⇒ 留下永远清不掉的 pending（之后任何外部改动都会被误判成冲突）。
     */
    const selfWrites = new Map()
    /** 本进程自动合并成功的次数（面板显示） */
    let mergedCount = 0

    /* ── 落盘 ── */

    const persist = async () => {
      dirty = false
      try {
        await api.store.set(KEY_BASELINE, baseline)
        await api.store.set(KEY_PENDING, pending)
        await api.store.set(KEY_CONFLICTS, conflicts)
      } catch (e) {
        api.host.log('warn', `同步状态写入失败：${String(e)}`)
      }
    }

    const markDirty = () => {
      dirty = true
    }

    /* ── 冲突副本 ── */

    const conflictDir = `${CONFLICT_ROOT}/${platform}`

    /**
     * 扫 `.zn/` 的两个已知目录，看有没有**外部同步工具**留下的冲突副本（rev173.114）。
     *
     * 为什么只查这两处：影子副本（`SNAPSHOT_DIR`）与冲突副本（`conflictDir`）是会频繁写入的
     * 私有目录，同步工具没排除 `.zn/` 时最容易在这里"打架"。`listFiles` 不递归、目录不存在
     * 返回空表，所以调用方不用先判存在。
     */
    async function znSyncTrace() {
      const dirs = [SNAPSHOT_DIR, conflictDir]
      const hits = []
      for (const d of dirs) {
        let files = []
        try {
          files = await api.fs.listFiles(d)
        } catch {
          continue
        }
        for (const f of files) {
          const base = f.slice(f.lastIndexOf('/') + 1)
          if (looksLikeSyncConflict(base)) hits.push(f)
        }
      }
      return hits
    }

    async function refreshZnTrace() {
      znHits = await znSyncTrace()
      znCheckedAt = Date.now()
      api.view.refresh()
      return znHits
    }

    /** 已存在的冲突名（同分钟内同名笔记可能撞） */
    const takenNames = new Set(conflicts.filter((c) => c.platform === platform).map((c) => c.file))

    /**
     * 把**本机那一版**留成冲突副本。
     *
     * 本地版来自影子副本（`SNAPSHOT_DIR`）—— 磁盘已经被外部版覆盖，这里读的是我们
     * 在 `note:saved` 时另存的那份。影子副本也丢了时不编造内容：记录一条 `lost: true`，
     * 面板明确说"本地版未留存"，比假装成功好。
     */
    async function keepConflict(path, at, reason) {
      const snap = snapshotPath(path)
      let localText = null
      try {
        localText = await api.fs.readText(snap)
      } catch {
        localText = null
      }

      let fileName = null
      if (localText != null) {
        fileName = conflictFileName({ path, at }, (n) => takenNames.has(n))
        takenNames.add(fileName)
        try {
          await api.fs.mkdir(conflictDir)
          await api.fs.writeText(`${conflictDir}/${fileName}`, localText)
        } catch (e) {
          api.host.log('warn', `冲突副本写入失败 ${fileName}：${String(e)}`)
          fileName = null
        }
        // 影子副本用完即弃（本机版已经躺进冲突目录）
        void api.fs.purgePrivate(snap).catch(() => {})
      }

      conflicts.unshift({
        path,
        file: fileName,
        platform,
        at,
        reason,
        lost: localText == null,
      })
      if (conflicts.length > MAX_CONFLICTS) conflicts.length = MAX_CONFLICTS
      markDirty()

      api.host.notify(
        localText == null
          ? `同步冲突：${path}（本机版未留存）`
          : `同步冲突：${path} → 已留存 ${fileName}`,
        'warn',
      )
      api.view.refresh()
    }

    /* ── 事件处理 ── */

    /**
     * 让 history 打一个**同步点**（rev173.116 三方合并的 base）。
     *
     * 时机：基线对齐外部版 / 本机新建时 —— 那一刻磁盘内容就是「两端一致」的版本。
     * 软依赖：history 被禁用 / 没装 ⇒ 静默跳过（合并退化成「留副本」，不丢数据）。
     */
    async function markBase(path, text) {
      try {
        const hist = await api.service.consume('history')
        if (hist?.snapshot) await hist.snapshot(path, text, { tag: 'sync:folder' })
      } catch (e) {
        api.host.log('debug', `同步点跳过 ${path}：${String(e)}`)
      }
    }

    /** 读本机版（影子副本）—— 冲突时 `mine` 的来源 */
    async function readShadow(path) {
      try {
        return await api.fs.readText(snapshotPath(path))
      } catch {
        return null
      }
    }

    /**
     * 冲突时试着合：base = history 同步点，mine = 影子副本，theirs = 磁盘外部版。
     * 任何一环缺失都返回 `null`（退回原「留副本」流程）。
     */
    async function autoMerge(path, theirs) {
      try {
        const [hist, merger] = await Promise.all([
          api.service.consume('history'),
          api.service.consume('kernel.merge'),
        ])
        if (!hist?.findBase || !merger?.mergeLines) return null
        const [mine, base] = await Promise.all([
          readShadow(path),
          hist.findBase(path, { tag: 'sync:folder' }),
        ])
        if (typeof mine !== 'string' || typeof base !== 'string') return null
        return tryAutoMerge({ base, mine, theirs, mergeLines: merger.mergeLines })
      } catch (e) {
        api.host.log('warn', `自动合并失败（${path}）：${String(e)}`)
        return null
      }
    }

    /**
     * 把合并结果写回磁盘并把基线对齐它（调用方已确认 0 处真冲突）。
     * @returns {Promise<boolean>} 是否成功（失败 ⇒ 调用方退回留副本）
     */
    async function applyMerged(path, text) {
      const fp = fingerprint(text)
      selfWrites.set(path, fp)
      try {
        await api.fs.writeText(path, text)
      } catch (e) {
        selfWrites.delete(path)
        api.host.log('warn', `合并结果落盘失败（${path}）：${String(e)}`)
        return false
      }
      baseline[path] = { fp, at: Date.now() }
      delete pending[path]
      void api.fs.purgePrivate(snapshotPath(path)).catch(() => {})
      markDirty()
      await markBase(path, text)
      mergedCount += 1
      api.host.notify(`已自动合并：${path}`, 'info')
      api.view.refresh()
      return true
    }

    /** 本机保存：记 pending + 存影子副本，**不动 baseline** */
    api.event.on('note:saved', (payload) => {
      void (async () => {
        const path = String(payload?.path ?? '')
        if (!isSyncable(path)) return
        let text
        try {
          text = await api.fs.readText(path)
        } catch {
          return
        }
        const fp = fingerprint(text)
        // 合并结果自己的落盘不算"本机保存"（rev173.116，见 selfWrites）
        const expect = selfWrites.get(path)
        if (expect && expect === fp) {
          selfWrites.delete(path)
          return
        }
        if (baseline[path]?.fp === fp) return // 保存了但内容没变
        pending[path] = { fp, at: Date.now() }
        try {
          await api.fs.mkdir(SNAPSHOT_DIR)
          await api.fs.writeText(snapshotPath(path), text)
        } catch (e) {
          // 影子副本写不出来 ⇒ 冲突时救不回本地版，先记日志（面板会标 lost）
          api.host.log('warn', `影子副本写入失败 ${path}：${String(e)}`)
        }
        markDirty()
        api.view.refresh()
      })()
    })

    /** 本机新建：直接进基线（新文件没有"双方"可言） */
    api.event.on('note:created', (payload) => {
      const path = String(payload?.path ?? '')
      if (!isSyncable(path)) return
      void (async () => {
        try {
          const text = await api.fs.readText(path)
          if (!baseline[path]) {
            baseline[path] = { fp: fingerprint(text), at: Date.now() }
            markDirty()
            // 新建即"两端一致"（外部还没有这篇），同步点可以马上种下
            void markBase(path, text)
            api.view.refresh()
          }
        } catch {
          /* 读不到就等下一次扫描 */
        }
      })()
    })

    /** 本机删除：只记"待同步的删除"，等外部确认 */
    api.event.on('note:deleted', (payload) => {
      const path = String(payload?.path ?? '')
      if (!isSyncable(path)) return
      pending[path] = { deleted: true, at: Date.now() }
      markDirty()
      api.view.refresh()
    })

    /** 本机改名：基线跟过去（旧路径的基线删掉） */
    api.event.on('note:renamed', (payload) => {
      const from = String(payload?.from ?? '')
      const to = String(payload?.to ?? '')
      if (!from || !to) return
      if (baseline[from]) {
        baseline[to] = { fp: baseline[from].fp, at: Date.now() }
        delete baseline[from]
      }
      delete pending[from]
      delete pending[to]
      markDirty()
      api.view.refresh()
    })

    /** 外部改动（别的程序 / 同步工具改盘）—— 判定核心 */
    api.event.on('note:changed', (payload) => {
      void (async () => {
        const path = String(payload?.path ?? '')
        const kind = String(payload?.kind ?? 'modify')
        if (!isSyncable(path)) return

        if (kind === 'delete') {
          const p = pending[path]
          if (p && !p.deleted) {
            // 本地改过、外面删了 ⇒ 本地版留副本
            await keepConflict(path, Date.now(), '外部删除')
            delete pending[path]
          }
          delete baseline[path]
          markDirty()
          api.view.refresh()
          return
        }

        let text
        try {
          text = await api.fs.readText(path)
        } catch {
          return // 刚被删掉，等下一个事件
        }
        const remoteFp = fingerprint(text)
        const base = baseline[path]
        const p = pending[path]
        const verdict = classifyChange({ base, pending: p, remoteFp })
        const now = Date.now()

        if (verdict === 'noop') {
          /**
           * 磁盘内容 == pending ⇒ 两种可能，**都什么也不做**：
           *   a) 就是我们自己刚那次保存被 watcher 看见了（自写抑制偶尔漏）；
           *   b) 同步工具把我们那版搬了回来。
           * 两者在内容上无法区分，正确处理都是「保持 pending」—— 让静默期（SETTLE_MS）
           * 再把它升为基线。**绝不能在这里清 pending**：清了之后同一篇再出现真冲突
           * 就判不出来了（rev173.107 实测踩过：清得太早 ⇒ 双端修改被当成普通外部更新）。
           */
          return
        }
        if (verdict === 'conflict') {
          /**
           * 先试**三方合并**（rev173.116）：base = history 同步点，mine = 影子副本，
           * theirs = 磁盘外部版。合上（0 处真冲突）⇒ 磁盘写合并结果、基线对齐它，本机版不丢。
           * 合不上 / 没 base ⇒ 原流程：本机版留副本、基线对齐外部版。
           */
          const merged = await autoMerge(path, text)
          if (merged && (await applyMerged(path, merged.text))) return
          await keepConflict(path, now, '双端修改')
        }
        // new / remote / conflict / local-pending：磁盘上是外部版，基线对齐它
        if (verdict !== 'local-pending') {
          baseline[path] = { fp: remoteFp, at: now }
          delete pending[path]
          markDirty()
          // 对齐之后两端一致 ⇒ 这是下次冲突要用的「共同祖先」
          void markBase(path, text)
        }
        api.view.refresh()
      })()
    })

    /* ── 全库扫描（补事件收不到的那些：App 关着的时候同步工具改了文件） ── */

    async function scan(reason = '手动检查') {
      if (scanning) return { skipped: true }
      scanning = true
      const t0 = Date.now()
      const result = { updated: 0, removed: 0, conflicts: 0, merged: 0 }
      try {
        const notes = await api.fs.listNotes()
        const seen = new Set()
        for (const n of notes) {
          if (!isSyncable(n.path)) continue
          seen.add(n.path)
          let text
          try {
            text = await api.fs.readText(n.path)
          } catch {
            continue
          }
          const fp = fingerprint(text)
          const base = baseline[n.path]
          const p = pending[n.path]

          if (!base && !p) {
            baseline[n.path] = { fp, at: Date.now() }
            // 首次见到 ⇒ 种一个同步点，下次真冲突才有 base 可用
            void markBase(n.path, text)
            result.updated += 1
            continue
          }
          if (base && base.fp === fp) {
            /**
             * 基线没变 ⇒ 顺便保证**同步点存在**（rev173.116）：老用户升级前没有 base，
             * 第一次真冲突会退化成「留两份」。`markBase` 内部先比对内容，没变不会写盘。
             */
            void markBase(n.path, text)
            continue
          }
          // 磁盘与基线不符：可能是外部更新，也可能是双端都改
          const verdict = classifyChange({ base, pending: p, remoteFp: fp })
          if (verdict === 'conflict') {
            // rev173.116：先试三方合并；合上就不进冲突统计
            const merged = await autoMerge(n.path, text)
            if (merged && (await applyMerged(n.path, merged.text))) {
              result.merged += 1
              result.updated += 1
              continue
            }
            await keepConflict(n.path, Date.now(), reason)
            result.conflicts += 1
          }
          baseline[n.path] = { fp, at: Date.now() }
          delete pending[n.path]
          void markBase(n.path, text)
          result.updated += 1
        }

        // 基线里还有、磁盘上已经没有 ⇒ 外部删除
        for (const path of Object.keys(baseline)) {
          if (seen.has(path)) continue
          const p = pending[path]
          if (p && !p.deleted) {
            await keepConflict(path, Date.now(), '外部删除')
            result.conflicts += 1
          }
          delete baseline[path]
          delete pending[path]
          result.removed += 1
        }

        lastScanAt = Date.now()
        lastScanMs = Date.now() - t0
        markDirty()
        return result
      } finally {
        scanning = false
        api.view.refresh()
      }
    }

    /**
     * 结算 pending：本机保存后过了静默期还没被外部动过 ⇒ 认为同步工具已传走。
     * 影子副本此时可以清掉（冲突判定已经不需要它了）。
     */
    function settle() {
      const now = Date.now()
      let changed = false
      for (const [path, p] of Object.entries(pending)) {
        if (now - p.at < SETTLE_MS) continue
        if (p.deleted) {
          delete baseline[path]
        } else {
          baseline[path] = { fp: p.fp, at: p.at }
          void api.fs.purgePrivate(snapshotPath(path)).catch(() => {})
        }
        delete pending[path]
        changed = true
      }
      if (changed) {
        markDirty()
        api.view.refresh()
      }
    }

    /* ── 面板 ── */

    /**
     * 耗时给人看（rev173.117）—— 与 `sync-webdav` 的 `fmtMs` 同一套写法。
     * 插件之间不能 import，各留一份；两边改了要一起改（单测各有一条覆盖）。
     */
    function fmtMs(ms) {
      const n = Number(ms)
      if (!Number.isFinite(n) || n < 0) return '—'
      if (n < 1000) return `${Math.round(n)} 毫秒`
      if (n < 10000) return `${(n / 1000).toFixed(1)} 秒`
      return `${Math.round(n / 1000)} 秒`
    }

    function render() {
      const baseCount = Object.keys(baseline).length
      const pendingCount = Object.keys(pending).length
      const conflictCount = conflicts.length
      const recent = conflicts.slice(0, 8)

      const children = [
        {
          type: 'text',
          value: '库放在同步目录里，搬运交给 Syncthing / OneDrive / 坚果云；这里只盯冲突。',
          variant: 'caption',
          tone: 'muted',
        },
        {
          type: 'text',
          // rev173.114：`.zn/` 排除检查（插件读不到同步工具的配置，只能看它留下的痕迹）
          value: znHits.length
            ? `⚠ .zn/ 疑似被同步工具处理过：找到 ${znHits.length} 个冲突副本（${znHits[0]}）—— 请在同步工具里把 .zn/ 排除掉`
            : znCheckedAt
              ? `.zn/ 没发现同步冲突痕迹（${new Date(znCheckedAt).toLocaleTimeString()} 查过）—— 仍请确认同步工具的排除列表里有 .zn/`
              : '请确认同步工具的排除列表里有 .zn/：历史版本、影子副本、冲突副本都放在里面，不该被搬来搬去。',
          variant: 'caption',
          tone: znHits.length ? 'danger' : 'muted',
        },
        { type: 'spacer', size: 'sm' },
        {
          type: 'row',
          gap: 'sm',
          wrap: true,
          children: [
            {
              type: 'badge',
              text: settings.enabled ? '自动检查：开' : '自动检查：关',
              tone: settings.enabled ? 'success' : 'warn',
            },
            { type: 'badge', text: `基线 ${baseCount} 篇`, tone: 'default' },
            {
              type: 'badge',
              text: `待同步 ${pendingCount} 篇`,
              tone: pendingCount > 0 ? 'warn' : 'default',
            },
            {
              type: 'badge',
              text: `冲突 ${conflictCount}`,
              tone: conflictCount > 0 ? 'danger' : 'success',
            },
            // rev173.116：双端改同一篇时自动合上的次数（本进程）
            ...(mergedCount > 0
              ? [{ type: 'badge', text: `合并 ${mergedCount}`, tone: 'success' }]
              : []),
          ],
        },
        { type: 'spacer', size: 'sm' },
        {
          type: 'row',
          gap: 'sm',
          wrap: true,
          children: [
            { type: 'button', label: '立即检查', onClick: 'sync-folder.scan' },
            { type: 'button', label: '把当前设为基线', onClick: 'sync-folder.mark-synced', variant: 'ghost' },
            {
              type: 'button',
              label: settings.enabled ? '停用自动检查' : '启用自动检查',
              onClick: 'sync-folder.toggle',
              variant: 'ghost',
            },
            {
              type: 'button',
              label: '检查 .zn/',
              onClick: 'sync-folder.check-zn',
              variant: 'ghost',
            },
          ],
        },
        {
          type: 'text',
          value: lastScanAt
            ? `上次检查：${new Date(lastScanAt).toLocaleTimeString()}（用时 ${fmtMs(lastScanMs)}）`
            : '上次检查：还没检查过',
          variant: 'caption',
          tone: 'muted',
        },
        { type: 'divider' },
      ]

      if (recent.length === 0) {
        children.push({
          type: 'text',
          value: '没有冲突。改同一篇时两边都会留一份，不会丢字。',
          tone: 'muted',
        })
        return { type: 'stack', gap: 'md', children }
      }

      children.push({ type: 'text', value: '最近的冲突', variant: 'title' })
      children.push({
        type: 'list',
        items: recent.map((c) => {
          const when = new Date(c.at).toLocaleString()
          const where = c.file ? `.zn/conflicts/${c.platform}/${c.file}` : '本地版未留存'
          // `list` 的 item 必须是 UINode（直接给字符串会被渲染成带引号的 JSON）
          return {
            type: 'stack',
            gap: 'sm',
            children: [
              { type: 'text', value: `${when} · ${c.path}` },
              { type: 'text', value: `${c.reason} · ${where}`, variant: 'caption', tone: 'muted' },
              // rev173.113：有副本就给一个按钮，省得自己去文件管理器里找
              ...(c.file
                ? [
                    {
                      type: 'button',
                      label: '打开冲突副本',
                      onClick: 'sync-folder.open-conflict',
                      payload: { file: c.file, platform: c.platform },
                      variant: 'ghost',
                    },
                  ]
                : []),
            ],
          }
        }),
        empty: '没有冲突',
      })
      if (conflicts.length > recent.length) {
        children.push({
          type: 'text',
          value: `还有 ${conflicts.length - recent.length} 条更早的记录（只留最近 ${MAX_CONFLICTS} 条）`,
          variant: 'caption',
          tone: 'muted',
        })
      }
      return { type: 'stack', gap: 'md', children }
    }

    /* ── 命令 ── */

    const register = (id, title, run) => {
      api.command.register({ id, title, run })
    }

    async function openPanel() {
      for (let i = 0; i < 5; i += 1) {
        try {
          await api.command.execute(`core.panel.${PANEL_ID}`)
          return
        } catch {
          if (i === 4) return
          await new Promise((r) => setTimeout(r, 120))
        }
      }
    }

    /** 把磁盘当前状态整体设成基线：用户手动确认"现在两边是一致的" */
    async function markSynced() {
      try {
        const notes = await api.fs.listNotes()
        const next = {}
        for (const n of notes) {
          if (!isSyncable(n.path)) continue
          try {
            next[n.path] = { fp: fingerprint(await api.fs.readText(n.path)), at: Date.now() }
          } catch {
            /* 读不到就跳过 */
          }
        }
        baseline = next
        pending = {}
        lastScanAt = Date.now()
        await persist()
        api.view.refresh()
        api.host.notify(`已把 ${Object.keys(next).length} 篇设为同步基线`)
      } catch (e) {
        api.host.notify(`设置基线失败：${String(e)}`, 'error')
      }
    }

    /* ── 启动 ── */

    api.view.registerPanel({
      id: PANEL_ID,
      title: '同步',
      location: 'main',
      render,
    })

    register('sync-folder.open', '同步：打开同步状态', () => openPanel())
    register('sync-folder.scan', '同步：立即检查一次', async () => {
      const r = await scan()
      api.host.notify(
        r.skipped
          ? '正在检查中…'
          : `检查完成：更新 ${r.updated} · 移除 ${r.removed} · 冲突 ${r.conflicts}`,
      )
    })
    register('sync-folder.mark-synced', '同步：把当前状态设为基线', () => markSynced())

    /** 开关自动检查（rev173.112）：停用只关自动扫描，事件记账与手动命令照常 */
    async function toggleAuto() {
      settings.enabled = !settings.enabled
      try {
        await api.store.set(KEY_SETTINGS, settings)
      } catch (e) {
        api.host.log('warn', `同步设置写入失败：${String(e)}`)
      }
      api.host.notify(
        settings.enabled
          ? '自动检查已开启（每 5 秒结算一次；启动 / 回前台各补扫一次）'
          : '自动检查已关闭（「立即检查」仍可用；停用期间的改动照常记账，重新启用时一起处理）',
      )
      api.view.refresh()
      if (settings.enabled) void scan('启用后检查')
    }
    register('sync-folder.toggle', '同步：开关自动检查（本地文件夹）', () => toggleAuto())
    register('sync-folder.check-zn', '同步：检查 .zn 是否被同步（本地文件夹）', async () => {
      const hits = await refreshZnTrace()
      api.host.notify(
        hits.length
          ? `⚠ .zn/ 里有 ${hits.length} 个同步冲突副本（例如 ${hits[0]}）—— 同步工具没有排除它`
          : '.zn/ 没发现同步冲突痕迹（仍请确认同步工具的排除列表里有 .zn/）',
        hits.length ? 'warn' : 'info',
      )
    })
    register('sync-folder.open-conflict', '同步：打开冲突副本（本地文件夹）', async (payload) => {
      const file = String(payload?.file ?? '')
      const plat = String(payload?.platform || platform)
      if (!file) {
        api.host.notify('没有可打开的冲突副本', 'warn')
        return
      }
      try {
        await api.command.execute('core.openNote', { path: `${CONFLICT_ROOT}/${plat}/${file}` })
      } catch (e) {
        api.host.notify(`打不开冲突副本：${String(e)}`, 'error')
      }
    })

    void (async () => {
      try {
        baseline = (await api.store.get(KEY_BASELINE, {})) ?? {}
        pending = (await api.store.get(KEY_PENDING, {})) ?? {}
        conflicts = (await api.store.get(KEY_CONFLICTS, [])) ?? []
        // rev173.112：用户可能在上次会话里停用了自动检查
        settings = { enabled: true, ...((await api.store.get(KEY_SETTINGS, {})) ?? {}) }
      } catch (e) {
        api.host.log('warn', `同步状态读取失败：${String(e)}`)
      }
      ready = true
      api.view.refresh()

      // rev173.114：启动就看一眼 `.zn/` 有没有被外部同步工具碰过（与自动检查开关无关）
      void refreshZnTrace()

      const timer = window.setInterval(() => {
        // 停用只停「结算」；事件照常记账，所以这里仍然要落盘
        if (settings.enabled) settle()
        if (dirty) void persist()
      }, TICK_MS)
      api.subscriptions.push({ dispose: () => window.clearInterval(timer) })

      // 启动后先扫一遍：App 关着的时候同步工具可能已经改过文件（事件收不到）
      setTimeout(() => {
        if (settings.enabled) void scan('启动检查')
      }, 1500)
      // 切回前台再补一次（手机后台定时器会被挂起）
      const onVisible = () => {
        if (!settings.enabled) return
        if (document.visibilityState === 'visible') void scan('回到前台')
      }
      document.addEventListener('visibilitychange', onVisible)
      api.subscriptions.push({
        dispose: () => document.removeEventListener('visibilitychange', onVisible),
      })

      api.host.log(
        'info',
        `同步插件就绪（${platform}，自动=${settings.enabled}）：基线 ${Object.keys(baseline).length} 篇（ready=${ready}）`,
      )
    })()
  },
}
