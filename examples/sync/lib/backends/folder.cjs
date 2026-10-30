/**
 * 同步后端 · 本地文件夹（folder）—— rev173.286（从 `examples/sync-folder` 并入）
 *
 * ## 它做什么、不做什么
 *
 * **不搬文件**。库本身放在用户自己的同步目录里（Syncthing / OneDrive / 坚果云客户端 /
 * 局域网 SMB），搬运交给那个工具。这个后端只做那三件同步工具**不做**的事：
 *   ① 发现「别人改了我的笔记」（内核的 `note:changed` 已过滤自写回响，直接可用）
 *   ② 判定「双端都改了」（本机在某次外部改动之前也保存过 ⇒ 冲突）
 *   ③ 冲突留副本到 `.zn/conflicts/<平台>/`，绝不静默丢弃任何一边
 *
 * ## 与 WebDAV 后端的差别
 *
 * | | webdav / s3 / git | folder |
 * |---|---|---|
 * | 谁搬文件 | 插件自己发请求 | 外部同步工具 |
 * | 触发 | 每 5 秒轮询远端 | 内核事件 + 启动 / 回前台补扫 |
 * | 「同步成功」怎么算 | 远端 manifest 里有这份新指纹 | 本机保存后过了静默期没被外部动过 |
 * | 本机版在哪 | 拉取前磁盘上那份 | 影子副本 `.zn/sync/last/<hash>.md` |
 *
 * ## 判定模型（这是整个后端的心脏）
 *
 * 三种状态：
 *   · `state.baseline[path] = { fp, at }` —— **双方一致**的版本（最后一次确认同步的内容指纹）
 *   · `pending[path]        = { fp, at }` —— 本机改过、**还没确认被同步工具搬走**的版本
 *   · `state.conflicts[]`                  —— 冲突记录（面板展示、可处理）
 *
 * 为什么不能在本机保存时直接更新 baseline：那样「本机改完、同步还没传出去、对端又改了」
 * 就会变成「只有外部变了」⇒ 本地改动被静默覆盖。所以保存只写 pending，
 * **等 `SETTLE_MS` 静默期**（默认 20 秒，够 Syncthing 传一轮）才升为 baseline。
 *
 * 判定函数是 `lib/core.cjs` 的 `classifyChange`（纯函数，单测覆盖）。
 *
 * ## 冲突副本
 *
 * 本机修改的正文在 `note:saved` 时**另存一份**到 `<库>/.zn/sync/last/<hash32(path)>.md`
 * （库外的影子副本，不进文件树）—— 因为磁盘被外部覆盖之后，本地版就只活在这里。
 * 冲突时把它复制成 `<库>/.zn/conflicts/<平台>/<YYYY-MM-DD HHmm>-<文件名>`。
 *
 * ⚠️ `.zn/` **必须**在同步工具的排除列表里，否则私有快照也会被同步（面板会提醒）。
 */
const {
  CONFLICT_ROOT,
  KEY_PENDING: _UNUSED_KEY_PENDING,
  MAX_CONFLICTS,
  SECRET_DIRS,
  SETTLE_MS,
  SNAPSHOT_DIR,
  TICK_MS,
  classifyChange,
  fingerprint,
  fmtMs,
  isSyncable,
  looksLikeSyncConflict,
  snapshotPath,
  tryAutoMerge,
} = require('../core.cjs')

/** 待同步记录（本后端专属，与 webdav 的 `baseline.v1` 分开存） */
const KEY_PENDING = 'folder.pending.v1'

/**
 * 建一个本地文件夹后端。
 *
 * @param {object} args
 * @param {any} args.api            插件 api（`fs` / `event` / `store` / `host` / `view` / `service` / `subscriptions`）
 * @param {'windows'|'android'} args.platform
 * @param {object} args.state       引擎的可变状态（getter/setter 直通）：`{ baseline, conflicts, settings }`
 * @param {object} args.hooks       `{ keepConflict, markBase, refresh, persistBaseline, persistSettings }`
 */
function createFolderBackend({ api, platform, state, hooks }) {
  const conflictDir = `${CONFLICT_ROOT}/${platform}`

  /** 本机改过、还没确认被同步工具搬走的版本（落盘 `KEY_PENDING`） */
  let pending = {}
  /** `.zn/` 被外部同步工具碰过的痕迹（rev173.114）：命中的文件路径 */
  let znHits = []
  /** 密码库私有目录里的冲突副本（rev173.164）：说明两端都改过密码库 */
  let secretHits = []
  /** 最近一次 `.zn/` 检查时间（0 = 还没查过） */
  let znCheckedAt = 0
  let lastScanAt = 0
  /** 上一次全库扫描花了多久（rev173.117：本地没有网络往返，但库大时一样会卡） */
  let lastScanMs = 0
  /** 扫描中（防重入） */
  let scanning = false
  /** 本进程自动合并成功的次数（面板显示） */
  let mergedCount = 0
  let ready = false
  /** 脏标记：pending 有变化才写 store（5 秒节拍里大多数轮次什么都不干） */
  let dirty = false
  let attached = false

  /**
   * **内存里的本机版**（rev173.133）。
   *
   * `note:saved` 的判定段是同步的，但影子副本落盘要 `await`。这段窗口里若真来冲突，
   * 磁盘上还没有影子副本 ⇒ `keepConflict` 会标「本机版未留存」（假 `lost`）。
   * 正文先留在内存，`readShadow` 优先读它；落盘成功再清掉。
   */
  const shadowMem = new Map()
  /** 事件与定时器的 dispose 句柄（`detach` 时全部释放） */
  const cleanups = []

  /* ── 落盘 ── */

  async function persistPending() {
    dirty = false
    try {
      await api.store.set(KEY_PENDING, pending)
    } catch (e) {
      api.host.log('warn', `待同步记录写入失败：${String(e)}`)
    }
  }

  const markDirty = () => {
    dirty = true
  }

  /* ── 影子副本 ── */

  /** 影子副本落盘（失败只记日志：`readShadow` 还有内存兜底，不会丢内容） */
  async function writeShadow(path, text) {
    try {
      await api.fs.mkdir(SNAPSHOT_DIR)
      await api.fs.writeText(snapshotPath(path), text)
      shadowMem.delete(path)
    } catch (e) {
      api.host.log('warn', `影子副本写入失败 ${path}：${String(e)}`)
    }
  }

  /** 读本机版（影子副本）—— 冲突时 `mine` 的来源：内存优先，其次磁盘 */
  async function readShadow(path) {
    const cached = shadowMem.get(path)
    if (typeof cached === 'string') return cached
    try {
      return await api.fs.readText(snapshotPath(path))
    } catch {
      return null
    }
  }

  /**
   * 冲突时试着合：base = history 同步点，mine = 影子副本，theirs = 磁盘外部版。
   * 任何一环缺失都返回 `null`（退回「留副本」流程，不丢字）。
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
   *
   * 不需要「自写抑制表」：内核能区分「用户保存」与「插件写盘」（`fs.writeText` 的
   * `origin`），插件写盘不发 `note:saved`；随后 Rust watcher 那条 `note:changed` 不带
   * origin，会照常走判定 —— 此时基线已对齐 ⇒ 走 `noop` 分支静默返回。
   *
   * @returns {Promise<boolean>} 是否成功（失败 ⇒ 调用方退回留副本）
   */
  async function applyMerged(path, text) {
    const fp = fingerprint(text)
    try {
      await api.fs.writeText(path, text)
    } catch (e) {
      api.host.log('warn', `合并结果落盘失败（${path}）：${String(e)}`)
      return false
    }
    state.baseline[path] = { fp, at: Date.now() }
    delete pending[path]
    shadowMem.delete(path)
    void api.fs.purgePrivate(snapshotPath(path)).catch(() => {})
    markDirty()
    void hooks.persistBaseline()
    void hooks.markBase(path, text)
    mergedCount += 1
    api.host.notify(`已自动合并：${path}`, 'info')
    hooks.refresh()
    return true
  }

  /* ── 事件处理 ── */

  /**
   * 本机保存（用户编辑）：记 pending + 存影子副本，**不动 baseline**。
   *
   * 判定段**不放 `await`**。内核随事件带 `text`，于是「算指纹 → 记 pending」全在同步段完成；
   * watcher 回响（`note:changed`）的处理体不可能插到中间去把基线对齐掉
   * （`note:saved` 总是先于回响派发）。
   *
   * 为什么非要同步：以前这里是 `await readText` 开头。回响若在这段 `await` 中间跑完判定，
   * pending 还没建 ⇒ 磁盘新、基线旧 ⇒ 判 `remote`（当成「别处更新」）、基线对齐新内容；
   * 随后本函数醒来看到 `baseline.fp === 当前 fp` 直接早退 ⇒ 这次改动既没有 pending
   * 也没有影子副本，**永远同步不出去**（rev173.116 实测记下，rev173.133 修）。
   */
  function onSaved(payload) {
    const path = String(payload?.path ?? '')
    if (!isSyncable(path)) return

    const remember = (text) => {
      const fp = fingerprint(text)
      if (state.baseline[path]?.fp === fp) return // 保存了但内容没变
      pending[path] = { fp, at: Date.now() }
      shadowMem.set(path, text)
      markDirty()
      hooks.refresh()
      void writeShadow(path, text)
    }

    const given = typeof payload?.text === 'string' ? payload.text : null
    if (given !== null) {
      remember(given)
      return
    }

    void (async () => {
      let text
      try {
        text = await api.fs.readText(path)
      } catch {
        return
      }
      remember(text)
    })()
  }

  /**
   * 本机新建：直接进基线（新文件没有「双方」可言）。
   *
   * 新内核下「种基线 + 打同步点」在**同步段**里完成，watcher 的 `note:changed`
   * 回响插不进来；旧内核（事件不带 `text`）退回读盘版本，不因版本差异静默失效。
   */
  function onCreated(payload) {
    const path = String(payload?.path ?? '')
    if (!isSyncable(path)) return

    const adopt = (text) => {
      if (state.baseline[path]) return
      state.baseline[path] = { fp: fingerprint(text), at: Date.now() }
      markDirty()
      // 新建即「两端一致」（外部还没有这篇），同步点可以马上种下
      void hooks.markBase(path, text)
      void hooks.persistBaseline()
      hooks.refresh()
    }

    const given = typeof payload?.text === 'string' ? payload.text : null
    if (given !== null) {
      adopt(given)
      return
    }

    void (async () => {
      try {
        adopt(await api.fs.readText(path))
      } catch {
        /* 读不到就等下一次扫描 */
      }
    })()
  }

  /** 本机删除：只记「待同步的删除」，等外部确认 */
  function onDeleted(payload) {
    const path = String(payload?.path ?? '')
    if (!isSyncable(path)) return
    pending[path] = { deleted: true, at: Date.now() }
    markDirty()
    hooks.refresh()
  }

  /** 本机改名：基线跟过去（旧路径的基线删掉） */
  function onRenamed(payload) {
    const from = String(payload?.from ?? '')
    const to = String(payload?.to ?? '')
    if (!from || !to) return
    if (state.baseline[from]) {
      state.baseline[to] = { fp: state.baseline[from].fp, at: Date.now() }
      delete state.baseline[from]
    }
    delete pending[from]
    delete pending[to]
    shadowMem.delete(from) // 改名前那份影子副本再也对不上路径（哈希跟着 path 走）
    markDirty()
    void hooks.persistBaseline()
    hooks.refresh()
  }

  /** 外部改动（别的程序 / 同步工具改盘）—— 判定核心 */
  function onChanged(payload) {
    void (async () => {
      const path = String(payload?.path ?? '')
      const kind = String(payload?.kind ?? 'modify')
      /**
       * **插件自己写盘不算外部改动**（rev173.120）：内核给插件口发 `note:changed` 时带
       * `origin: 'plugin'`（合并结果落盘就是这条）。这类写入的基线 / pending 已由发起方
       * 对齐过，再走一遍判定只会制造假冲突。
       *
       * Rust watcher 那条 `note:changed` 不带 origin —— 它是「磁盘真变了」，
       * 仍然照常判定（此时基线已对齐 ⇒ 走 `noop` 分支静默返回）。
       */
      if (payload?.origin === 'plugin') return
      if (!isSyncable(path)) return

      if (kind === 'delete') {
        const p = pending[path]
        if (p && !p.deleted) {
          // 本地改过、外面删了 ⇒ 本地版留副本
          const localText = await readShadow(path)
          await hooks.keepConflict(path, '外部删除', { localText })
          delete pending[path]
        }
        delete state.baseline[path]
        markDirty()
        void hooks.persistBaseline()
        hooks.refresh()
        return
      }

      let text
      try {
        text = await api.fs.readText(path)
      } catch {
        return // 刚被删掉，等下一个事件
      }
      const remoteFp = fingerprint(text)
      const base = state.baseline[path]
      const p = pending[path]
      const verdict = classifyChange({ base, pending: p, remoteFp })
      const now = Date.now()

      if (verdict === 'noop') {
        /**
         * 磁盘内容 == pending ⇒ 两种可能，**都什么也不做**：
         *   a) 就是我们自己刚那次保存被 watcher 看见了（自写抑制偶尔漏）；
         *   b) 同步工具把我们那版搬了回来。
         * 两者在内容上无法区分，正确处理都是「保持 pending」—— 让静默期再把它升为基线。
         * **绝不能在这里清 pending**：清了之后同一篇再出现真冲突就判不出来了
         * （rev173.107 实测踩过：清得太早 ⇒ 双端修改被当成普通外部更新）。
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
        await hooks.keepConflict(path, '双端修改', { localText: await readShadow(path) })
      }
      // new / remote / conflict / local-pending：磁盘上是外部版，基线对齐它
      if (verdict !== 'local-pending') {
        state.baseline[path] = { fp: remoteFp, at: now }
        delete pending[path]
        // 本机版若还有价值，已经在上面的 keepConflict 里留了副本；内存那份不再需要
        shadowMem.delete(path)
        markDirty()
        void hooks.persistBaseline()
        // 对齐之后两端一致 ⇒ 这是下次冲突要用的「共同祖先」
        void hooks.markBase(path, text)
      }
      hooks.refresh()
    })()
  }

  /**
   * 把磁盘当前状态整体设成基线：用户手动确认「现在两边是一致的」。
   *
   * 本地文件夹后端没有远端可对齐，所以「设为基线」＝「我现在相信这些文件已经同步过了」。
   */
  async function markSynced() {
    try {
      const notes = await api.fs.listNotes()
      const next = {}
      const now = Date.now()
      for (const n of notes) {
        if (!isSyncable(n.path)) continue
        try {
          next[n.path] = { fp: fingerprint(await api.fs.readText(n.path)), at: now }
        } catch {
          /* 读不到就跳过 */
        }
      }
      state.baseline = next
      pending = {}
      lastScanAt = now
      await hooks.persistBaseline()
      await persistPending()
      hooks.refresh()
      api.host.notify(`已把 ${Object.keys(next).length} 篇设为同步基线`)
      return { count: Object.keys(next).length }
    } catch (e) {
      api.host.notify(`设置基线失败：${String(e)}`, 'error')
      return { error: String(e) }
    }
  }

  /**
   * 扫 `.zn/` 的两个已知目录，看有没有**外部同步工具**留下的冲突副本（rev173.114）。
   *
   * 为什么只查这两处：影子副本（`SNAPSHOT_DIR`）与冲突副本（`conflictDir`）是会频繁写入的
   * 私有目录，同步工具没排除 `.zn/` 时最容易在这里「打架」。`listFiles` 不递归、目录不存在
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

  /**
   * **密码库私有目录的冲突副本**（rev173.164）。
   *
   * folder 后端自己不搬文件 —— 是不是「同步得出去」完全看外部工具的排除列表。
   * 能做的只有两件事：① 给出放行规则 ② 一旦发现密码库出现冲突副本就**明确报警**
   * （那意味着两端都改过密码库，用户必须自己挑一份 —— 密码库没法三方合并）。
   *
   * ⚠️ 这两个目录里出现冲突副本，**不是**「同步工具没排除 `.zn/`」那个错 ——
   * 恰恰相反，它是用户**按提示放行**之后才可能的正常现象，只是说明碰上双端改。
   */
  async function znSecretConflictHits() {
    const hits = []
    for (const d of SECRET_DIRS) {
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
    secretHits = await znSecretConflictHits()
    znCheckedAt = Date.now()
    hooks.refresh()
    return znHits
  }

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
        const base = state.baseline[n.path]
        const p = pending[n.path]

        if (!base && !p) {
          state.baseline[n.path] = { fp, at: Date.now() }
          // 首次见到 ⇒ 种一个同步点，下次真冲突才有 base 可用
          void hooks.markBase(n.path, text)
          result.updated += 1
          continue
        }
        if (base && base.fp === fp) {
          /**
           * 基线没变 ⇒ 顺便保证**同步点存在**（rev173.116）：老用户升级前没有 base，
           * 第一次真冲突会退化成「留两份」。`markBase` 内部先比对内容，没变不会写盘。
           */
          void hooks.markBase(n.path, text)
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
          await hooks.keepConflict(n.path, reason, { localText: await readShadow(n.path) })
          result.conflicts += 1
        }
        state.baseline[n.path] = { fp, at: Date.now() }
        delete pending[n.path]
        shadowMem.delete(n.path)
        void hooks.markBase(n.path, text)
        result.updated += 1
      }

      // 基线里还有、磁盘上已经没有 ⇒ 外部删除
      for (const path of Object.keys(state.baseline)) {
        if (seen.has(path)) continue
        const p = pending[path]
        if (p && !p.deleted) {
          await hooks.keepConflict(path, '外部删除', { localText: await readShadow(path) })
          result.conflicts += 1
        }
        delete state.baseline[path]
        delete pending[path]
        shadowMem.delete(path)
        result.removed += 1
      }

      lastScanAt = Date.now()
      lastScanMs = Date.now() - t0
      markDirty()
      void hooks.persistBaseline()
      return result
    } finally {
      scanning = false
      hooks.refresh()
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
        delete state.baseline[path]
      } else {
        state.baseline[path] = { fp: p.fp, at: p.at }
        void api.fs.purgePrivate(snapshotPath(path)).catch(() => {})
      }
      delete pending[path]
      shadowMem.delete(path)
      changed = true
    }
    if (changed) {
      markDirty()
      void hooks.persistBaseline()
      hooks.refresh()
    }
  }

  /**
   * 处理一条冲突（folder 版）。
   *
   * · `local`  —— 把副本内容写回笔记（磁盘现在是外部版，写回＝覆盖），基线对齐写回的内容。
   *              写盘走 `api.fs.writeText`（插件 origin），不会触发 `note:saved`。
   * · `remote` —— 磁盘上已经是外部版，什么都不用写，只删副本 + 清记录。
   *
   * @param {{path?: string, file?: string|null, choice?: 'local'|'remote'}} payload
   */
  async function resolveConflict(payload) {
    const path = String(payload?.path ?? '')
    const file = payload?.file ? String(payload.file) : null
    const choice = payload?.choice === 'local' ? 'local' : 'remote'
    const idx = state.conflicts.findIndex((c) => c.path === path && c.platform === platform)
    const rec = idx >= 0 ? state.conflicts[idx] : null

    if (!rec && !file) {
      api.host.notify('这条冲突记录找不到了', 'warn')
      return { error: 'no-record' }
    }

    const notePath = rec?.path || path
    let kept = false
    if (choice === 'local') {
      if (!file) {
        api.host.notify('本机版没有留存，只能用远端版', 'warn')
        return { error: 'no-copy' }
      }
      let text
      try {
        text = await api.fs.readText(`${conflictDir}/${file}`)
      } catch (e) {
        api.host.notify(`读不到冲突副本：${String(e)}`, 'error')
        return { error: String(e) }
      }
      try {
        await api.fs.writeText(notePath, text)
      } catch (e) {
        api.host.notify(`写回失败：${String(e)}`, 'error')
        return { error: String(e) }
      }
      state.baseline[notePath] = { fp: fingerprint(text), at: Date.now() }
      delete pending[notePath]
      shadowMem.delete(notePath)
      kept = true
      void hooks.persistBaseline()
      await persistPending()
      void hooks.markBase(notePath, text)
    }

    if (file) {
      try {
        await api.fs.delete(`${conflictDir}/${file}`)
      } catch (e) {
        api.host.log('debug', `删冲突副本失败 ${file}：${String(e)}`)
      }
    }
    if (idx >= 0) state.conflicts.splice(idx, 1)
    void api.store.set('conflicts.v1', state.conflicts).catch(() => {})
    hooks.refresh()
    api.host.notify(kept ? `已用本机版覆盖：${notePath}` : `已保留远端版：${notePath}`)
    return { ok: true, kept }
  }

  /* ── 开关 / 调度 ── */

  async function toggleAuto() {
    state.settings.auto = state.settings.auto === false
    void hooks.persistSettings()
    api.host.notify(
      state.settings.auto
        ? '自动检查已开启（每 5 秒结算一次；启动 / 回前台各补扫一次）'
        : '自动检查已关闭（「立即检查」仍可用；停用期间的改动照常记账，重新启用时一起处理）',
    )
    hooks.refresh()
    if (state.settings.auto) void scan('启用后检查')
  }

  /**
   * 挂上事件与定时器。
   *
   * 只有当前后端是 folder 时才调用：webdav 模式下若也挂 `note:saved` 监听，
   * 每次用户保存都会写一份影子副本（白占磁盘，且与 webdav 的基线语义打架）。
   */
  function attach() {
    if (attached) return
    attached = true

    const on = (topic, cb) => {
      const sub = api.event.on(topic, cb)
      if (sub) {
        cleanups.push(() => sub.dispose())
        // 同时挂进插件的订阅总表：`detach` 之外，内核卸载插件时也会自动释放
        api.subscriptions.push(sub)
      }
    }
    on('note:saved', onSaved)
    on('note:created', onCreated)
    on('note:deleted', onDeleted)
    on('note:renamed', onRenamed)
    on('note:changed', onChanged)

    const timer = window.setInterval(() => {
      // 停用只停「结算」；事件照常记账，所以这里仍然要落盘
      if (state.settings.auto !== false) settle()
      if (dirty) void persistPending()
    }, TICK_MS)
    cleanups.push(() => window.clearInterval(timer))
    api.subscriptions.push({ dispose: () => window.clearInterval(timer) })

    // 启动后先扫一遍：App 关着的时候同步工具可能已经改过文件（事件收不到）
    const boot = setTimeout(() => {
      if (state.settings.auto !== false) void scan('启动检查')
    }, 1500)
    cleanups.push(() => clearTimeout(boot))
    api.subscriptions.push({ dispose: () => clearTimeout(boot) })

    // 切回前台再补一次（手机后台定时器会被挂起）
    if (typeof document !== 'undefined') {
      const onVisible = () => {
        if (state.settings.auto === false) return
        if (document.visibilityState === 'visible') void scan('回到前台')
      }
      document.addEventListener('visibilitychange', onVisible)
      cleanups.push(() => document.removeEventListener('visibilitychange', onVisible))
      api.subscriptions.push({
        dispose: () => document.removeEventListener('visibilitychange', onVisible),
      })
    }

    void refreshZnTrace()
    api.host.log(
      'info',
      `同步插件就绪（${platform} · 本地文件夹，自动=${state.settings.auto !== false}）：基线 ${Object.keys(state.baseline).length} 篇`,
    )
  }

  function detach() {
    if (!attached) return
    attached = false
    while (cleanups.length > 0) {
      const fn = cleanups.pop()
      try {
        fn()
      } catch {
        /* 释放失败不影响切换 */
      }
    }
    shadowMem.clear()
  }

  /** 读 store（引擎在切到 folder 后端 / 启动时调一次） */
  async function load() {
    try {
      pending = (await api.store.get(KEY_PENDING, {})) ?? {}
    } catch (e) {
      api.host.log('warn', `待同步记录读取失败：${String(e)}`)
      pending = {}
    }
    ready = true
  }

  /** 面板用的统计数字 */
  function stats() {
    return {
      baseline: Object.keys(state.baseline).length,
      pending: Object.keys(pending).length,
      conflicts: state.conflicts.length,
      merged: mergedCount,
      znHits,
      secretHits,
      znCheckedAt,
      lastScanAt,
      lastScanMs,
      enabled: state.settings.auto !== false,
      scanning,
      ready,
    }
  }

  /** 面板区块（folder 后端的特有几块：说明 / `.zn` 提醒 / 统计 / 按钮 / 上次检查） */
  function renderSection() {
    const s = stats()
    const children = [
      {
        type: 'text',
        value: '库放在同步目录里，搬运交给 Syncthing / OneDrive / 坚果云；这里只盯冲突。',
        variant: 'caption',
        tone: 'muted',
      },
      {
        type: 'text',
        value: s.znHits.length
          ? `⚠ .zn/ 疑似被同步工具处理过：找到 ${s.znHits.length} 个冲突副本（${s.znHits[0]}）—— 请在同步工具里把 .zn/ 排除掉`
          : s.znCheckedAt
            ? `.zn/ 没发现同步冲突痕迹（${new Date(s.znCheckedAt).toLocaleTimeString()} 查过）—— 仍请确认同步工具的排除列表里有 .zn/`
            : '请确认同步工具的排除列表里有 .zn/：历史版本、影子副本、冲突副本都放在里面，不该被搬来搬去。',
        variant: 'caption',
        tone: s.znHits.length ? 'danger' : 'muted',
      },
      ...(s.secretHits.length
        ? [
            {
              type: 'text',
              value: `⚠ 密码库有 ${s.secretHits.length} 份同步冲突副本（${s.secretHits[0]}）—— 两端都改过密码库，请手动挑一份用（密文没法自动合并）`,
              variant: 'caption',
              tone: 'danger',
            },
          ]
        : []),
      { type: 'spacer', size: 'sm' },
      {
        type: 'row',
        gap: 'sm',
        wrap: true,
        children: [
          {
            type: 'badge',
            text: s.enabled ? '自动检查：开' : '自动检查：关',
            tone: s.enabled ? 'success' : 'warn',
          },
          { type: 'badge', text: `基线 ${s.baseline} 篇`, tone: 'default' },
          {
            type: 'badge',
            text: `待同步 ${s.pending} 篇`,
            tone: s.pending > 0 ? 'warn' : 'default',
          },
          {
            type: 'badge',
            text: `冲突 ${s.conflicts}`,
            tone: s.conflicts > 0 ? 'danger' : 'success',
          },
          // rev173.116：双端改同一篇时自动合上的次数（本进程）
          ...(s.merged > 0 ? [{ type: 'badge', text: `合并 ${s.merged}`, tone: 'success' }] : []),
          ...(s.scanning ? [{ type: 'badge', text: '正在检查…', tone: 'warn' }] : []),
        ],
      },
      { type: 'spacer', size: 'sm' },
      {
        type: 'row',
        gap: 'sm',
        wrap: true,
        children: [
          { type: 'button', label: '立即检查', onClick: 'sync.run', disabled: s.scanning },
          { type: 'button', label: '把当前设为基线', onClick: 'sync.mark-baseline', variant: 'ghost' },
          {
            type: 'button',
            label: s.enabled ? '停用自动检查' : '启用自动检查',
            onClick: 'sync.toggle-auto',
            variant: 'ghost',
          },
        ],
      },
      {
        type: 'text',
        value: s.lastScanAt
          ? `上次检查：${new Date(s.lastScanAt).toLocaleString()}（用时 ${fmtMs(s.lastScanMs)}）`
          : '上次检查：还没检查过',
        variant: 'caption',
        tone: 'muted',
      },
    ]
    return children
  }

  return {
    attach,
    detach,
    load,
    scan,
    settle,
    markSynced,
    refreshZnTrace,
    toggleAuto,
    resolveConflict,
    stats,
    renderSection,
    /** 测试用：当前 pending 表（只读快照） */
    __pending: () => pending,
  }
}

module.exports = { createFolderBackend, KEY_PENDING }
