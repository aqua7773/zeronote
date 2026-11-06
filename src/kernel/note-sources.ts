/**
 * 「额外笔记源」注册表（rev173.376 · 私密笔记改造 §4.1）。
 *
 * 私密笔记此前是一个**独立面板**：解锁后列在面板里，文件树 / 时间流 / 搜索全看不见。
 * 用户要的是「一个开关」—— 打开时它以「🔒 私密笔记」分组出现在文件树里，
 * 操作与普通笔记一致，关掉就整组消失。
 *
 * 内核不认加密、不认私密：它只认一个通用原语 ——
 * **插件可以注册一个「额外笔记源」，宿主把它的条目并进文件树（后续还有搜索 / 时间流）**。
 *
 * ## 为什么源只给 `list()` 而不给 path 映射
 *
 * 条目里的 `path` 就是**真实可读路径**（私密笔记是 `.zn/private/notes/<id>.zn`）。
 * `read_note` 的 `resolve()` 只拒绝对路径 / `..`，不拒 `.zn/` ⇒ 打开链路不用再造一层
 * 「虚拟路径 → 真实文件」的映射（少一层就容易漂）。内容解密由插件的 `doc.registerCodec` 负责，
 * 与内核的编辑器链路解耦 —— 这也正是「打开」现状已经能工作的部分。
 *
 * ## 安全边界（别退化）
 *
 * - 源的 `list()` 抛错只影响它自己：跳过并记 warn，不能让文件树整个渲染不出来。
 * - 锁定 = 源返回空数组。**没有任何缓存**能绕过这条 —— 内核每次问源要的是当下状态。
 * - 源的注册与宿主订阅分开：宿主（App）订阅 `subscribe` 重新取快照，源自己用
 *   `onSourceChange` 通知注册表「我变了」。
 */
import type {
  Disposable,
  NoteMeta,
  NoteSource,
  NoteSourceEntry,
  NoteSourceGroup,
  NoteSourceSearch,
} from './contract'

export type NoteSources = {
  /** 插件侧入口（`ctx.notes.registerSource` 落到这里）；同一个插件可以注册多个源 */
  register(pluginId: string, src: NoteSource): Disposable
  /**
   * 当前全部源的条目（按注册顺序；每个源内部顺序原样保留）。
   * `group` / `groupLabel` / `groupIcon` 由注册表**补全** —— 源只需返回普通 `NoteMeta`。
   */
  snapshot(): NoteSourceEntry[]
  /** 源注册 / 注销 / 内容变化时通知。宿主据此重新 `snapshot()` 并重渲染。 */
  subscribe(cb: () => void): Disposable
  /**
   * 支持搜索的源（rev173.394 · 私密笔记第二批）：只返回实现了 `search()` 的源。
   * App 把它转给 `SearchPanel`，面板据此把私密命中和公开结果分开显示。
   */
  searchables(): NoteSourceSearch[]
  /**
   * 源条目正文（rev173.394 · 第二批）：`path` 属于某个源的条目且该源实现了 `readText`
   * ⇒ 走源（解密后的明文）；否则返回 `null`，由宿主退回 `fs.readText`。
   */
  readText(path: string): Promise<string | null>
  /**
   * 重命名源条目（rev173.398 · 文件树右键改名）。`path` 属于某个源且它实现了 `rename`
   * ⇒ 调它并返回 `true`；否则 `false`（宿主要么不提供入口，要么提示不支持）。
   */
  rename(path: string, title: string): Promise<boolean>
  /**
   * 删除源条目（rev173.402 · 文件树菜单「删除」/ Delete 键）。`path` 属于某个源且它实现了
   * `remove` ⇒ 调它并返回 `true`；否则 `false`（宿主不提供该入口）。
   * 源抛错原样上抛 —— 宿主据此提示「删除失败」，不能假装成功。
   */
  remove(path: string): Promise<boolean>
  /** 已注册的源（诊断 / 单测） */
  sources(): Array<{ pluginId: string; id: string; group: NoteSourceGroup }>
  /**
   * 现在该显示的源分组（rev173.401 · 用户「空文件夹状态不显示，无法移入」）。
   *
   * 与 `snapshot()` 的区别：**即使一篇条目都没有也返回**（只要源还在、且 `groupVisible()`
   * 不为 false）。文件树用它预建空分组行 —— 空组是「拖入」的唯一落点，没有它就无法移入第一篇。
   * 锁定时源应当让 `groupVisible()` 返回 false（或让分组消失），否则等于泄露「有私密区」。
   */
  groups(): NoteSourceGroup[]
}

type Entry = {
  pluginId: string
  src: NoteSource
  /** 源自己的变化订阅（注册时建立，注销时退订） */
  watch: Disposable | null
  disposed: boolean
}

export function createNoteSources(
  onWarn: (msg: string) => void = (msg) => console.warn('[zn]', msg),
): NoteSources {
  const entries: Entry[] = []
  const listeners = new Set<() => void>()

  const notify = () => {
    for (const cb of [...listeners]) {
      try {
        cb()
      } catch (e) {
        // 宿主回调抛错不能掀掉整条通知链（与 event 总线同一规矩）
        onWarn(`notes 源变化回调抛错（已忽略）：${String(e)}`)
      }
    }
  }

  /**
   * 找到「认领这个路径」的源（rev173.398）：`readText` / `rename` 共用 ——
   * 源之间不互相知道对方的条目，只有它自己的 `list()` 里有这个 path 才算它的。
   * 源抛错或返回非数组时跳过它（与 `snapshot` 同一口径）。
   */
  const ownerOf = (path: string): Entry | null => {
    for (const entry of entries) {
      if (entry.disposed) continue
      let items: NoteMeta[]
      try {
        items = entry.src.list() ?? []
      } catch {
        continue
      }
      if (!Array.isArray(items)) continue
      if (items.some((n) => n && n.path === path)) return entry
    }
    return null
  }

  const drop = (entry: Entry) => {    if (entry.disposed) return
    entry.disposed = true
    const i = entries.indexOf(entry)
    if (i >= 0) entries.splice(i, 1)
    try {
      entry.watch?.dispose()
    } catch (e) {
      onWarn(`notes 源变化订阅退订失败：${String(e)}`)
    }
    entry.watch = null
    notify()
  }

  return {
    register(pluginId, src) {
      /**
       * 同一个 id 重复注册 ⇒ 后来的取代先前的（与 codec / 面板的语义一致）。
       * 先摘旧的那份：不然同一源会在树里出现两遍。
       */
      const dup = entries.find((e) => e.src === src || e.src.id === src.id)
      if (dup && dup.pluginId === pluginId) {
        dup.disposed = true
        const i = entries.indexOf(dup)
        if (i >= 0) entries.splice(i, 1)
        try {
          dup.watch?.dispose()
        } catch {
          /* 旧订阅已失效 */
        }
      }
      const entry: Entry = { pluginId, src, watch: null, disposed: false }
      entries.push(entry)
      try {
        entry.watch = src.onSourceChange(() => {
          if (!entry.disposed) notify()
        })
      } catch (e) {
        onWarn(`notes 源「${src.id}」订阅变化失败：${String(e)}`)
      }
      notify()
      return { dispose: () => drop(entry) }
    },

    snapshot() {
      const out: NoteSourceEntry[] = []
      for (const entry of entries) {
        if (entry.disposed) continue
        let items: NoteMeta[]
        try {
          items = entry.src.list() ?? []
        } catch (e) {
          // 一个源坏了不能拖垮整棵树：跳过它，保留其它源
          onWarn(`notes 源「${entry.src.id}」的 list() 抛错（已跳过）：${String(e)}`)
          continue
        }
        if (!Array.isArray(items)) {
          onWarn(`notes 源「${entry.src.id}」的 list() 没返回数组（已跳过）`)
          continue
        }
        for (const n of items) {
          if (!n || typeof n.path !== 'string' || !n.path) continue
          out.push({
            ...n,
            group: n.group ?? entry.src.group.key,
            groupLabel: n.groupLabel ?? entry.src.group.label,
            groupIcon: n.groupIcon ?? entry.src.group.icon,
          })
        }
      }
      return out
    },

    subscribe(cb) {
      listeners.add(cb)
      return {
        dispose: () => {
          listeners.delete(cb)
        },
      }
    },

    searchables() {
      const out: NoteSourceSearch[] = []
      for (const entry of entries) {
        if (entry.disposed) continue
        const search = entry.src.search
        // 只收真的实现了 search 的源：没有它就不该出现在搜索面板里
        if (typeof search !== 'function') continue
        out.push({
          id: entry.src.id,
          group: entry.src.group,
          search: (q, opts) => search.call(entry.src, q, opts),
        })
      }
      return out
    },

    async readText(path) {
      const owner = ownerOf(path)
      const fn = owner?.src.readText
      if (!owner || typeof fn !== 'function') return null
      return await fn.call(owner.src, path)
    },

    async rename(path, title) {
      const owner = ownerOf(path)
      const fn = owner?.src.rename
      if (!owner || typeof fn !== 'function') return false
      await fn.call(owner.src, path, title)
      return true
    },

    async remove(path) {
      const owner = ownerOf(path)
      const fn = owner?.src.remove
      if (!owner || typeof fn !== 'function') return false
      await fn.call(owner.src, path)
      return true
    },

    sources() {
      return entries
        .filter((e) => !e.disposed)
        .map((e) => ({ pluginId: e.pluginId, id: e.src.id, group: e.src.group }))
    },

    groups() {
      const seen = new Set<string>()
      const out: NoteSourceGroup[] = []
      for (const entry of entries) {
        if (entry.disposed) continue
        const src = entry.src
        // 源自己说「现在不该显示」（锁定 / 关闭）⇒ 整组不进去
        let visible = true
        if (typeof src.groupVisible === 'function') {
          try {
            visible = src.groupVisible() !== false
          } catch (e) {
            // 源自己的判断抛错：按"不显示"处理 —— 宁可少一组，也不把不该露的露出来
            onWarn(`notes 源「${src.id}」的 groupVisible() 抛错（按不显示处理）：${String(e)}`)
            visible = false
          }
        }
        if (!visible) continue
        const key = src.group.key
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ ...src.group })
      }
      return out
    },
  }
}
