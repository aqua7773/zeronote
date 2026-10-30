/**
 * itemMenu 原语 —— **条目菜单动作**（rev173.281 · 真人使用测试 J#18）。
 *
 * ## 为什么需要它
 *
 * 文件树（`FileTree.tsx`）与时间流卡片（`MobileNoteCards.tsx`）的右键 / 长按菜单
 * 一直**长在组件内部**：菜单项写死在组件的 `items` 数组里（剪切 / 重命名 / 删除…），
 * 插件根本没有入口。J#18 要把「导出为…」放进这两个菜单、且归 `import-export` 插件，
 * 于是先在内核补一条协议：**插件声明动作，宿主负责渲染**。
 *
 * ## 与 `command` 的关系
 *
 * 动作**不直接带回调**，只写 `command`（与 `contributes.commands` / `command.register`
 * 同一套 id）。三个好处：
 *  ① 懒激活天然成立 —— 宿主 `commands.execute` 发现没实现会先激活插件；
 *  ② 一个动作 = 一条命令，命令面板 / 快捷键 / 市场能力自述都能复用同一份元数据；
 *  ③ 菜单项只是**入口**，插件换实现（`bind` 接管）时菜单不用重注册。
 *
 * ## 去重
 *
 * 同一个插件对同一个 `command` 可能在两处都登记（manifest 静态声明 + `apply` 里运行时注册）
 * ⇒ 后者覆盖前者（一个动作只出现一次）。没有 `command` 的父项按 `title` 去重。
 *
 * 插件卸载时宿主调 `release(pluginId)` 兜底回收 —— 与 `releaseServices` /
 * `releaseEditorMarks` / `releaseCapabilities` 同一套「卸载即净」规矩。
 */
import type { Disposable, ItemMenuAction, ItemMenuApi, ItemMenuRegistration } from './contract'

type Entry = {
  action: ItemMenuAction
  pluginId: string
  /** 登记顺序：同 `order` 时按它排（先登记的先出现） */
  seq: number
}

export type ItemMenuRegistry = {
  /** 无主登记（内核自用；插件走 `scoped`） */
  api: ItemMenuApi
  /** 按插件 id 视图化 —— 插件拿到的 `ctx.itemMenu` 就是它 */
  scoped(pluginId: string): ItemMenuApi
  /** 宿主用：静态登记 `manifest.contributes.itemMenus`（**不加载插件**） */
  declare(actions: ItemMenuAction[], pluginId: string): Disposable
  /** 当前全部登记项（已去重、已排序）—— 宿主渲染菜单时读它 */
  list(): ItemMenuRegistration[]
  /** 插件卸载时兜底回收它的全部动作（静态声明由宿主自己 dispose） */
  release(pluginId: string): void
}

/** 默认排序权重（与 `ItemMenuAction.order` 的缺省值一致） */
export const DEFAULT_ITEM_MENU_ORDER = 100

/**
 * 去重键：同一个插件 + 同一个命令 = 同一个动作。
 * 父项（没有 command）按标题去重 —— 它没有更稳定的身份。
 */
function keyOf(action: ItemMenuAction, pluginId: string): string {
  return `${pluginId}\u0000${action.command ? `c:${action.command}` : `t:${action.title}`}`
}

/**
 * 形状校验：错在插件作者手里，**注册当场报**比"菜单里少一项"好查。
 * 这里只校验宿主一定要用到的字段，`where` / `kinds` 的取值由类型保证（JS 插件写错就按缺省处理）。
 */
function validate(action: ItemMenuAction): ItemMenuAction {
  if (!action || typeof action !== 'object') {
    throw new Error('itemMenu.register：动作必须是对象')
  }
  if (typeof action.title !== 'string' || !action.title.trim()) {
    throw new Error('itemMenu.register：动作必须有非空 title')
  }
  if (action.children?.length) {
    for (const child of action.children) {
      if (!child || typeof child.command !== 'string' || !child.command.trim()) {
        throw new Error(`itemMenu.register：「${action.title}」的子项必须有 command`)
      }
      if (typeof child.title !== 'string' || !child.title.trim()) {
        throw new Error(`itemMenu.register：「${action.title}」的子项必须有非空 title`)
      }
    }
  } else if (typeof action.command !== 'string' || !action.command.trim()) {
    throw new Error(`itemMenu.register：「${action.title}」既没有 command 也没有 children`)
  }
  return action
}

export function createItemMenuRegistry(
  onChange: (list: ItemMenuRegistration[]) => void = () => {},
): ItemMenuRegistry {
  const entries = new Map<string, Entry>()
  let seq = 0

  function snapshot(): ItemMenuRegistration[] {
    return [...entries.values()]
      .sort(
        (a, b) =>
          (a.action.order ?? DEFAULT_ITEM_MENU_ORDER) - (b.action.order ?? DEFAULT_ITEM_MENU_ORDER) ||
          a.seq - b.seq,
      )
      .map((e) => ({ ...e.action, pluginId: e.pluginId }))
  }

  const notify = () => onChange(snapshot())

  function add(action: ItemMenuAction, pluginId: string): Disposable {
    const valid = validate(action)
    const key = keyOf(valid, pluginId)
    const entry: Entry = { action: valid, pluginId, seq: ++seq }
    entries.set(key, entry)
    notify()
    return {
      dispose: () => {
        // 只摘自己那层：被后来者覆盖过的旧登记 dispose 时不能顺手删掉新的
        if (entries.get(key) === entry) {
          entries.delete(key)
          notify()
        }
      },
    }
  }

  function addMany(actions: ItemMenuAction[], pluginId: string): Disposable {
    const subs: Disposable[] = []
    try {
      for (const a of actions) subs.push(add(a, pluginId))
    } catch (e) {
      // 一条写坏不该留下半套动作
      for (const s of subs) s.dispose()
      throw e
    }
    return { dispose: () => subs.forEach((s) => s.dispose()) }
  }

  const api: ItemMenuApi = {
    register: (action) => add(action, ''),
  }

  return {
    api,
    scoped(pluginId: string): ItemMenuApi {
      return { register: (action) => add(action, pluginId) }
    },
    declare: (actions, pluginId) => addMany(actions, pluginId),
    list: snapshot,
    release(pluginId: string) {
      let changed = false
      for (const [key, e] of [...entries]) {
        if (e.pluginId === pluginId) {
          entries.delete(key)
          changed = true
        }
      }
      if (changed) notify()
    },
  }
}
