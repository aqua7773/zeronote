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

const isNotePath = (p: string): boolean => /\.md$/i.test(p)

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

    async writeText(path, content) {
      await raw.writeText(path, content)
      if (!isNotePath(path)) return
      // 内容已在手上，不必再 readText 一遍（省一次 IPC）
      void index.upsert(path, content)
      event.emit('note:saved', { path })
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
