/**
 * 文档内容转换器（`doc.registerCodec`）—— 读盘后 / 写盘前的**通用**转换点（rev173.180）。
 *
 * ## 为什么需要它
 *
 * 内核的编辑器只有一条链路：`fs.readText(path)` → 内容进编辑器 → 保存时 `fs.writeText(path, text)`。
 * 密文落盘的功能（私密笔记、加密容器）因此没法用编辑器 —— 要么插件自绘一个降级编辑器，
 * 要么把明文临时写到磁盘上（崩溃就残留）。
 *
 * 这个钩子把「磁盘字节 ⇄ 编辑器文本」抽成一个可插拔的转换：**内核不认识加密 / 压缩 / 任何格式**，
 * 只认识「这个路径的内容要过一次转换」。
 *
 * ## 它不改的事
 *
 * - 三方合并、脏标记、自动保存、草稿、标签页、`doc.on` 广播全部还在**明文层面**跑 —— 它们只看见
 *   `contentRef` / `baseRef`，与普通笔记没有区别。
 * - 转换只在四个"真读写磁盘"的点发生（`openNote` / `saveNow` / `mergeWithDisk` / `reloadActiveFromDisk`）。
 *
 * ## 安全语义（别退化）
 *
 * 1. **打开过某个 codec 的文档，保存时必须还用那个 codec。** 插件被卸载 / 禁用后 codec 就没了，
 *    此时若退回"原样写盘"，正在编辑的私密笔记会被**明文写回磁盘**（静默失效，比报错危险得多）
 *    ⇒ 这种情况一律拒写并抛错。
 * 2. `transient: true` 的 codec 不写会话恢复草稿 —— 草稿落在 `localStorage` 里是明文。
 * 3. codec 自己的 `match` 抛错只影响它自己（按"没匹配"处理），不能把内核拖崩。
 */
import type { Disposable, DocCodec } from './contract'

export type { DocCodec }

/** 已注册的转换器（模块级单例：useDocSession / useDocIO 各自 import 即共享同一份） */
const codecs = new Map<string, DocCodec>()

/**
 * 「这个路径打开时用的是哪个 codec」。
 *
 * 存在的唯一目的：codec 在文档打开途中被卸载时，保存要**失败**而不是明文落盘。
 * key 是库内相对路径（换库后同名路径复用，行为一致，无害）。
 */
const openedVia = new Map<string, string>()

export function registerDocCodec(codec: DocCodec): Disposable {
  codecs.set(codec.id, codec)
  return {
    dispose: () => {
      // 只删自己那一份：同 id 被后来的注册覆盖时，旧的那个 dispose 不该把新的删掉
      if (codecs.get(codec.id) === codec) codecs.delete(codec.id)
    },
  }
}

/** 找这个路径的转换器：后注册的优先（插件覆盖内置）。`match` 抛错按"不匹配"处理。 */
export function pickCodec(path: string): DocCodec | null {
  // Map 的插入顺序就是注册顺序；倒序 = 后注册的优先
  const list = [...codecs.values()]
  for (let i = list.length - 1; i >= 0; i--) {
    try {
      if (list[i].match(path)) return list[i]
    } catch (e) {
      console.warn('[zn] doc codec 的 match() 抛错（已按不匹配处理）', e)
    }
  }
  return null
}

/** 读盘后调用：需要转换就转换，不需要就原样返回。成功时记下"这个路径由谁打开的"。 */
export async function decodeForOpen(raw: string, path: string): Promise<string> {
  /**
   * 这个路径之前由某个 codec 打开过 —— 那个 codec 现在没了（插件被卸载 / 禁用）⇒ **拒绝打开**。
   * 不这样做的后果：密文被原样喂进编辑器，用户看到一脸乱码，还可能被当成笔记内容存回去。
   */
  const owner = openedVia.get(path)
  if (owner !== undefined && !codecs.has(owner)) {
    throw new Error('这篇内容的转换器已卸载（插件被禁用或移除）—— 打不开，请重新启用插件')
  }
  const codec = pickCodec(path)
  if (!codec) return raw
  const plain = await codec.decode(raw, path)
  openedVia.set(path, codec.id)
  return plain
}

/**
 * 写盘前调用：需要转换就转换。
 *
 * ⚠️ 打开时用过 codec 的路径 ⇒ **必须还由同一个 codec 转换**；它被卸载了就抛错（拒绝明文落盘）。
 * 没用过 codec 的路径 ⇒ 按当前注册表判断（可能这时才有 codec，例如插件晚加载）。
 */
export async function encodeForSave(plain: string, path: string): Promise<string> {
  const owner = openedVia.get(path)
  if (owner !== undefined) {
    const codec = codecs.get(owner)
    if (!codec) {
      throw new Error('内容的转换器已卸载（插件被禁用或移除）—— 拒绝写盘，以免明文落到磁盘上')
    }
    return codec.encode(plain, path)
  }
  const codec = pickCodec(path)
  return codec ? codec.encode(plain, path) : plain
}

/** 文档关闭时调用：清掉"打开过"的记录（不必等 unload，路径会被重新打开覆盖）。 */
export function forgetOpenedVia(path: string | null): void {
  if (path) openedVia.delete(path)
}

/**
 * 这个路径的内容是否敏感（不写草稿）。
 * 打开过的路径按打开时的 codec 判断 —— 插件中途卸载后草稿也不能突然开始写。
 */
export function isTransientPath(path: string | null): boolean {
  if (!path) return false
  const owner = openedVia.get(path)
  if (owner !== undefined) return codecs.get(owner)?.transient === true
  return pickCodec(path)?.transient === true
}

/** 仅供单测 / 诊断：当前注册了几个、打开了哪些 */
export function codecDebugState(): { codecs: string[]; openedVia: Record<string, string> } {
  return { codecs: [...codecs.keys()], openedVia: Object.fromEntries(openedVia) }
}
