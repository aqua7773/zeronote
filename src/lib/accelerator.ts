/**
 * 关掉**新窗口**里 WebView2 自带的浏览器加速键（rev173.70）。
 *
 * 主窗口由 Rust `setup` 一次性处理；`note-*`（标签拆出的笔记窗口）和 `plugin-*`
 * （插件的独立窗口）是页面用 `WebviewWindow` **现建**的 —— WebView2 的加速键开关是
 * 每个 webview 各自的，不补这一下，用户在独立窗口里按 Ctrl+F 会弹出窗口右上角的
 * 原生查找栏，编辑器的查找面板永远打不开（rev173.42 只修了主窗口）。
 *
 * 时序：构造完立刻 invoke 会撞「窗口还不存在」（Rust `get_webview_window` 返回 None），
 * 必须等 `tauri://created` —— 它代表后端已经把 webview 注册好。
 */
import { invoke } from '@tauri-apps/api/core'
import type { WebviewWindow } from '@tauri-apps/api/webviewWindow'

/** 对指定 label 补设置；返回是否读回「已关闭」。失败只记日志，不让建窗流程跟着失败。 */
export async function disableAcceleratorKeysFor(label: string): Promise<boolean> {
  try {
    return await invoke<boolean>('disable_accelerator_keys_for', { label })
  } catch (e) {
    console.warn('[accelerator] 关闭浏览器加速键失败', label, e)
    return false
  }
}

/**
 * 监听窗口创建完成再补设置。
 *
 * 兜底 800ms：`tauri://created` 万一在监听注册前就发过（窗口极小 / 极快），
 * 再补一次；`done` 保证正常路径只调一次。
 */
export function watchAcceleratorKeys(win: WebviewWindow): void {
  let done = false
  const run = () => {
    if (done) return
    done = true
    void disableAcceleratorKeysFor(win.label)
  }
  const timer = setTimeout(run, 800)
  void win
    .once('tauri://created', () => {
      clearTimeout(timer)
      run()
    })
    .catch(() => {})
  // 窗口关掉就不用再补了（否则 800ms 的兜底会对着已销毁的 label 打一条 warn）
  void win
    .once('tauri://destroyed', () => {
      done = true
      clearTimeout(timer)
    })
    .catch(() => {})
}
