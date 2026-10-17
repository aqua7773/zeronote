/**
 * 底层异常 → 用户能懂的话 —— 从 `App.tsx` 原样迁出（rev122 · L1）。
 *
 * 依据 NN/g Error-Message Guidelines：说清**具体出了什么问题**、给出**可执行的补救**，
 * 不罗列错误码、不指责用户、不过早报错。原始异常仍附在末尾括号里 ——
 * 排查时有用，但不占主位。
 */
import { looksLikeStoragePermissionError } from './androidPerm'

export type FailKind = 'read' | 'write' | 'create' | 'rename' | 'delete' | 'list' | 'vault'

const FAIL_BASE: Record<FailKind, string> = {
  read: '无法打开这篇笔记',
  write: '保存失败',
  create: '新建笔记失败',
  rename: '重命名失败',
  delete: '删除失败',
  list: '读取笔记库失败',
  vault: '这个文件夹无法作为笔记库',
}

const FAIL_HINT: Record<FailKind, string> = {
  read: '文件可能已被移动或删除，可点「重新扫描」。',
  write: '磁盘可能已满或文件被占用；内容仍在编辑器里，稍后重试即可。',
  create: '请确认笔记库可写。',
  rename: '请检查是否与现有文件重名。',
  delete: '文件可能正被其他程序占用。',
  list: '笔记库可能已被移动或删除，可重新选择一个文件夹。',
  vault: '请确认该文件夹有读写权限。',
}

export function failMsg(kind: FailKind, e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  // 重名走同一句人话（重命名与新建都可能撞名）
  if ((kind === 'rename' || kind === 'create') && /exists|已?存在/i.test(raw)) {
    return '已存在同名笔记。'
  }
  /**
   * **缺「所有文件访问」权限**必须说清"怎么办"（rev64）。
   *
   * 原来只是干巴巴一句 `Permission denied (os error 13)`：用户既不知道是哪个权限、
   * 也不知道去哪开 —— 它是 Android 的特殊权限、**系统不弹窗申请**，猜是猜不到的。
   * 这里补上唯一可操作的那一步（命令面板入口已随 rev64 加进内核）。
   */
  if (looksLikeStoragePermissionError(raw)) {
    return '没有「所有文件访问」权限，读不到库里的文件。到 ☰ → 命令面板运行「请求『所有文件访问』权限」，在系统页面允许后再重新扫描插件。'
  }
  return `${FAIL_BASE[kind]}：${FAIL_HINT[kind]}（${raw}）`
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'
