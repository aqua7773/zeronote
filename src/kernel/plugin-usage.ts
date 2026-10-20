/**
 * 插件**能力使用审计**（rev173.78）。
 *
 * 为什么要它：`capability` 目前只是自述（2026-10-13 拆门后内核不拦截），
 * 将来若收紧成白名单 / 沙箱，需要的是**每个插件实际调用了什么**，
 * 而不是作者在 manifest 里声称用什么。没有这份数据，白名单只能拍脑袋。
 *
 * 三条边界：
 *  ① 只记 **API 名**（如 `fs.read` / `store.get`）—— 不记参数、不记路径、不记内容，
 *    所以审计文件即使泄露也不含笔记内容；
 *  ② 落盘由**宿主**做（`<应用数据目录>/.zn/plugin-usage.json`），插件不参与；
 *  ③ 节流写盘（默认 5 秒），插件高频调用不应变成高频磁盘写。
 *
 * 这个模块是纯逻辑（不碰 Tauri）：写盘通过构造时注入的 `sink`，
 * 便于单测与将来换存储。
 */

/** 单个 API 的累计使用情况 */
export type PluginApiUsage = {
  /** 调用次数 */
  count: number
  /** 首次调用的时间戳（ms） */
  first: number
  /** 最近一次调用的时间戳（ms） */
  last: number
}

export type PluginUsageEntry = {
  /** 本次加载时间（ms）；卸载后再加载会刷新 */
  loadedAt: number
  /** `api 名 → 使用情况`（只增不减，除非 reset） */
  apis: Record<string, PluginApiUsage>
}

export type PluginUsageBook = {
  version: 1
  updatedAt: number
  plugins: Record<string, PluginUsageEntry>
}

/** 落盘回调（宿主注入）；返回 Promise 时宿主自行 catch —— 审计失败不得影响插件 */
export type UsageSink = (book: PluginUsageBook) => void | Promise<void>

export type UsageRecorderOptions = {
  /** 时钟（测试注入） */
  now?: () => number
  /** 节流间隔；<= 0 表示每次 record 立即落盘（测试用） */
  flushEveryMs?: number
  /** 落盘回调；不传则只留在内存（网关 / 单测） */
  sink?: UsageSink
}

/**
 * 使用记录器。
 *
 * 生命周期由宿主管：插件加载时 `markLoaded()`，卸载时 `markUnloaded()`（数据**保留**，
 * 只清"当前是否在跑"的语义 —— 审计要的是历史，不是快照）。宿主退出前 `dispose()` 会 flush 一次。
 */
export class UsageRecorder {
  private readonly now: () => number
  private readonly flushEveryMs: number
  private readonly sink?: UsageSink
  private book: PluginUsageBook
  private timer: ReturnType<typeof setTimeout> | null = null
  private dirty = false

  constructor(opts: UsageRecorderOptions = {}) {
    this.now = opts.now ?? (() => Date.now())
    this.flushEveryMs = opts.flushEveryMs ?? 5000
    this.sink = opts.sink
    this.book = { version: 1, updatedAt: this.now(), plugins: {} }
  }

  /** 恢复一份已有审计（启动时从文件读回来；坏数据忽略） */
  restore(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return
    const v = raw as Partial<PluginUsageBook>
    if (v.version !== 1 || !v.plugins || typeof v.plugins !== 'object') return
    const plugins: Record<string, PluginUsageEntry> = {}
    for (const [id, entry] of Object.entries(v.plugins)) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as Partial<PluginUsageEntry>
      const apis: Record<string, PluginApiUsage> = {}
      if (e.apis && typeof e.apis === 'object') {
        for (const [api, u] of Object.entries(e.apis)) {
          if (!u || typeof u !== 'object') continue
          const r = u as Partial<PluginApiUsage>
          if (typeof r.count !== 'number' || typeof r.first !== 'number' || typeof r.last !== 'number') continue
          apis[api] = { count: r.count, first: r.first, last: r.last }
        }
      }
      plugins[id] = { loadedAt: typeof e.loadedAt === 'number' ? e.loadedAt : 0, apis }
    }
    this.book = { version: 1, updatedAt: this.now(), plugins }
  }

  /** 插件加载完成（重置本次加载时间；历史 API 记录保留） */
  markLoaded(pluginId: string): void {
    const entry = this.book.plugins[pluginId] ?? { loadedAt: 0, apis: {} }
    entry.loadedAt = this.now()
    this.book.plugins[pluginId] = entry
    this.touch()
  }

  /** 插件卸载（只记一个 0 值表示"当前不在跑"；API 历史保留） */
  markUnloaded(pluginId: string): void {
    const entry = this.book.plugins[pluginId]
    if (!entry) return
    entry.loadedAt = 0
    this.touch()
  }

  /** 记一次调用（只记 API 名） */
  record(pluginId: string, api: string): void {
    if (!pluginId || !api) return
    const entry = (this.book.plugins[pluginId] ??= { loadedAt: this.now(), apis: {} })
    const at = this.now()
    const prev = entry.apis[api]
    entry.apis[api] =
      prev === undefined
        ? { count: 1, first: at, last: at }
        : { count: prev.count + 1, first: prev.first, last: at }
    this.touch()
  }

  /** 快照（深拷贝：调用方改它不影响记录器） */
  snapshot(): PluginUsageBook {
    return JSON.parse(JSON.stringify(this.book)) as PluginUsageBook
  }

  /** 清空（测试 / 用户手动重置） */
  reset(pluginId?: string): void {
    if (pluginId) delete this.book.plugins[pluginId]
    else this.book.plugins = {}
    this.touch()
  }

  /** 立刻落盘（没脏数据时什么都不做） */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.dirty || !this.sink) return
    this.dirty = false
    this.book.updatedAt = this.now()
    try {
      const r = this.sink(this.snapshot())
      if (r && typeof (r as Promise<void>).catch === 'function') {
        void (r as Promise<void>).catch(() => {
          /* 落盘失败：下次有变化再试，不让插件看到异常 */
        })
      }
    } catch {
      /* 同上：审计永远不能把插件带崩 */
    }
  }

  /** 宿主退出前调用：清定时器 + flush */
  dispose(): void {
    this.flush()
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private touch(): void {
    this.dirty = true
    if (this.flushEveryMs <= 0) {
      this.flush()
      return
    }
    if (this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, this.flushEveryMs)
  }
}
