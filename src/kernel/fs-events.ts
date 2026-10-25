/**
 * fs 原语的**索引跟随 + 内核事件**包装（rev173.40）。
 *
 * 为什么要有这一层（两条，都是真实缺口）：
 *
 * 1. **搜索索引不增量**：`SearchPanel` 只在首次打开时 `rebuild()`，注释里写着"之后靠内核
 *    `upsert`/`remove` 增量维护"——但全仓没有任何调用。后果：本次启动后新建/修改的笔记
 *    搜不到，直到用户手动点「重建索引」或换库。
 * 2. **内核事件没派发**：契约 §1.4 声明了 `note:saved` 等 9 种事件，实现里只发了
 *    `service:available` / `service:gone`。插件监听"笔记保存后做点什么"永远收不到。
 *
 * 做法：把写路径（`writeText` / `createNote` / `rename` / `move` / `delete` / `restoreTrash`）
 * 包一层 —— **成功之后**才更新索引、才发事件。失败路径原样抛出，不产生"已保存"的假信号。
 *
 * 外部改动（别的程序改了库里的 `.md`）走 `fs.watch`：订阅点在宿主 `App.tsx`
 * （生命周期与 kernel 一致，换库时能 `dispose`），回调里调 {@link applyExternalChange}。
 * 写路径与外部路径分开，测试也分开。
 */
import type { EventBus } from './event'
import type { FsApi, IndexApi } from './contract'

/**
 * 这条相对路径算不算「笔记」（要进索引、要发 `note:saved` 那套事件）。
 *
 * 除了 `.md` 后缀，还要排掉**私有目录 `.zn/`**（rev173.107 修）—— 它下面是回收站、
 * 历史版本快照、同步插件的影子副本，都不是用户的笔记：
 *   · 写它们不该发 `note:saved` —— 否则"保存后做点什么"的插件会对自己刚写的副本再触发一次
 *     （同步插件实测踩到：每篇笔记的影子副本又生成一份影子副本，无限套娃）；
 *   · 它们也不该进搜索索引（`listNotes` 本来就跳过 `.zn`，索引里却会有，等于搜得到幽灵版本）。
 */
const isNotePath = (p: string): boolean => {
  const s = String(p ?? '')
  if (!/\.md$/i.test(s)) return false
  if (s.startsWith('.zn/') || s === '.zn') return false
  // 库根之外的位置（绝对路径 / `../` 越界）一律不算笔记
  if (s.startsWith('/') || s.includes('..')) return false
  return !s.split('/').includes('.zn')
}

export function withFsEvents(
  raw: FsApi,
  index: IndexApi,
  event: EventBus,
  onLog: (msg: string) => void = () => {},
): FsApi {
  /** 读一篇进索引：失败只记日志（文件刚被删、权限问题都可能） */
  const indexFromDisk = (path: string) => {
    void raw
      .readText(path)
      .then((text) => index.upsert(path, text))
      .catch((e: unknown) => onLog(`索引更新失败 ${path}：${String(e)}`))
  }

  return {
    ...raw,

    async writeText(path, content, opts) {
      await raw.writeText(path, content)
      if (!isNotePath(path)) return
      // 内容已在手上，不必再 readText 一遍（省一次 IPC）
      void index.upsert(path, content)
      /**
       * **插件写盘不发 `note:saved`**（rev173.120 · 用户 2026-10-25 要的「内核口子」）。
       *
       * `note:saved` 的语义是「用户改了这篇」：同步插件据此记 pending（本机改过、还没传出去）。
       * 插件自己写盘（合并结果 / 导入 / 批量整理）如果也发它，就会被当成用户编辑 ——
       * 留下清不掉的 pending，之后任何外部改动都被误判成冲突。rev173.116 的 `selfWrites`
       * 抑制表就是在绕这个，靠"写盘前登记、事后清理"的时序，冷启动时会被 watcher 抢跑。
       *
       * 现在改发 `note:changed` 并带上 `origin: 'plugin'`：订阅方按来源决定要不要当真。
       * 索引照常更新（插件写的内容也必须能搜到）。
       */
      if (opts?.origin === 'plugin') {
        event.emit('note:changed', { path, kind: 'modify', origin: 'plugin' })
        return
      }
      /**
       * **把刚写盘的正文带上**（rev173.133）—— 不是省一次读盘，是为了让订阅方能把
       * 「记 pending」放在**同步段**里做完。
       *
       * 起因：同步插件的 `note:saved` 处理要 `await readText` 才能算指纹；而 Rust watcher
       * 的 `note:changed` 回响（自写抑制是 1500 ms 窗口，不保证 100% 吞掉）可能在这段
       * `await` 中间跑完判定 —— 那时 pending 还没建，磁盘已是新内容、基线还是旧内容 ⇒
       * 判成 `remote`（当成"别处更新"）把基线对齐新内容；随后 saved 醒来看到
       * `baseline.fp === 当前 fp` 直接早退 ⇒ 这次本机改动既没有 pending 也没有影子副本，
       * **永远同步不出去**。带上正文后，判定段不再有 `await`，回响不可能插队
       * （`note:saved` 总是先于它的 watcher 回响派发）。
       *
       * 正文是同一个 JS 上下文里的字符串引用，事件总线不做序列化 ⇒ 这里没有拷贝开销。
       */
      event.emit('note:saved', { path, text: content })
    },

    async createNote(path, content = '') {
      await raw.createNote(path, content)
      if (!isNotePath(path)) return
      void index.upsert(path, content)
      event.emit('note:created', { path })
    },

    async rename(from, to) {
      await raw.rename(from, to)
      if (isNotePath(from)) void index.remove(from)
      if (isNotePath(to)) indexFromDisk(to)
      event.emit('note:renamed', { from, to })
    },

    async move(from, to) {
      await raw.move(from, to)
      /**
       * 文件移动 = 改名；**目录移动**没法逐条搬（索引里是完整路径），
       * 直接整库重建一次 —— 移动目录不是高频操作，正确性优先。
       */
      if (isNotePath(from) && isNotePath(to)) {
        void index.remove(from)
        indexFromDisk(to)
      } else {
        void index.rebuild().catch((e: unknown) => onLog(`移动后重建索引失败：${String(e)}`))
      }
      event.emit('note:renamed', { from, to })
    },

    async delete(path) {
      const trashId = await raw.delete(path)
      void index.remove(path)
      /** `trashId` 给"撤销删除"用（宿主恢复后，`restoreTrash` 会把索引补回来） */
      event.emit('note:deleted', { path, trashId })
      return trashId
    },

    async restoreTrash(id) {
      const restored = await raw.restoreTrash(id)
      if (isNotePath(restored)) indexFromDisk(restored)
      event.emit('note:created', { path: restored, restored: true })
      return restored
    },

    async emptyTrash() {
      const n = await raw.emptyTrash()
      // 清空回收站不影响索引（索引只索引活笔记），但插件可能需要刷新回收站视图
      event.emit('note:deleted', { path: '', trashId: '*', count: n })
      return n
    },
  }
}

/**
 * 外部改动 → 索引 + `note:changed` 事件（宿主在 `fs.watch` 回调里调）。
 *
 * 注意语义：**本机保存也会触发 watch**（Rust 侧 notify 看的是文件系统），所以一次保存
 * 可能收到 `note:saved` + `note:changed` 两个事件。这是刻意的：前者是"应用写了盘"，
 * 后者是"磁盘内容变了"（后者也覆盖别的程序改文件）。插件处理幂等即可。
 */
export function applyExternalChange(
  e: { kind: 'create' | 'modify' | 'delete' | 'rename'; path: string },
  raw: FsApi,
  index: IndexApi,
  event: EventBus,
  onLog: (msg: string) => void = () => {},
): void {
  const path = e.path
  if (!isNotePath(path)) return

  if (e.kind === 'delete') {
    void index.remove(path)
    event.emit('note:changed', { path, kind: 'delete' })
    return
  }
  void raw
    .readText(path)
    .then((text) => index.upsert(path, text))
    .catch((err: unknown) => onLog(`外部改动索引失败 ${path}：${String(err)}`))
  event.emit('note:changed', { path, kind: e.kind })
}
