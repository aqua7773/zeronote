/**
 * 文件树拖拽的**落点判定**与**松手动作规划**（rev173.400 · 私密笔记改造 §4.2 收尾）。
 *
 * 为什么抽成纯函数：鼠标 `pointerdown` 拖拽与手机 `touchstart` 拖拽是**两套独立的事件链**，
 * 以前落点判定各写一段内联逻辑（`resolveDropTarget` 与 `applyMove` 里那份注释写着「内联一份」）。
 * 加「拖到私密分组 / 从私密分组拖出」时如果只改一处，另一端的拖拽就会静默失效 ——
 * 项目对这类「同一逻辑多处实现」踩过三次（见 `docs/共享逻辑.md`、AGENTS §8.8）。
 * 现在两边都调这里，规则只有一份。
 */

/** 条目路径的最后一段（文件名） */
export const baseName = (p: string) => (p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p)

/** 父目录（库根 = 空串） */
export const parentDir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/**
 * 额外笔记源分组的哨兵前缀（rev173.376 · 私密笔记改造 §4.2）。
 * 分组 key 来自插件（如 `private`），拼成 `__zn_group_private`；**只在文件树内部用**，
 * 从不发给内核（源条目的 path 是真实路径）。
 */
export const GROUP_NODE_PREFIX = '__zn_group_'

export const isSourceGroupPath = (p: string | null | undefined): boolean =>
  typeof p === 'string' && p.startsWith(GROUP_NODE_PREFIX)

export const groupKeyOf = (p: string): string => p.slice(GROUP_NODE_PREFIX.length)

export const sourceGroupDropPath = (group: string): string => `${GROUP_NODE_PREFIX}${group}`

/** 一次拖拽的有效落点 */
export type TreeDropTarget =
  /** 真实目录（`''` = 库根） */
  | { kind: 'dir'; dir: string }
  /** 某个额外笔记源分组行（私密笔记） */
  | { kind: 'source'; group: string }

/** 松手时该执行的动作 */
export type TreeDropPlan =
  /** 普通移动（公开条目 → 公开目录） */
  | { kind: 'move'; entries: Array<{ from: string; to: string; isDir: boolean }> }
  /** 公开条目 → 额外源分组（私密笔记：移入） */
  | { kind: 'into-source'; group: string; paths: string[] }
  /** 额外源条目 → 公开目录（私密笔记：移出） */
  | { kind: 'out-of-source'; group: string; paths: string[]; dir: string }

export interface DropHit {
  /** 命中的 `[data-zn-path]`（`null` = 文件树栏内空白 ⇒ 库根） */
  over: string | null
  /** 命中行是不是**虚拟分组行**（`data-zn-virtual`） */
  overVirtual: boolean
  /** 命中行是不是**额外源条目**（`data-zn-group`） */
  overSourceEntry: boolean
  /** 拖的是哪一条（用来拒绝「拖进自己 / 自己的子目录」） */
  fromPath: string
  /** 真实目录集合（`list_dirs` 的结果） */
  dirs: Set<string>
}

/**
 * 落点判定（鼠标 / 触摸共用）：
 *  · 栏内空白 ⇒ 库根；
 *  · 真实目录行 ⇒ 那个目录；
 *  · 额外源分组行 ⇒ 该分组（移入落点）；
 *  · 文件行 / 源条目 / 自己或自己的子目录 ⇒ `null`（不动作）。
 */
export function resolveTreeDrop(hit: DropHit): TreeDropTarget | null {
  const { over, overVirtual, overSourceEntry, fromPath, dirs } = hit
  if (over === null) return { kind: 'dir', dir: '' }
  // 拖到别的条目上：源条目不是目录、也不是"组"，不能当落点
  if (overSourceEntry) return null
  if (overVirtual) {
    // 目前只有额外笔记源会生成虚拟分组；将来若恢复文档/附件分组，这里返回 null 保持旧行为
    return isSourceGroupPath(over) ? { kind: 'source', group: groupKeyOf(over) } : null
  }
  if (over === fromPath || over.startsWith(`${fromPath}/`)) return null
  return dirs.has(over) ? { kind: 'dir', dir: over } : null
}

/** 把落点换成拖拽高亮用的字符串（`dropTarget` state 的值） */
export function dropTargetPath(t: TreeDropTarget | null): string | null {
  if (!t) return null
  return t.kind === 'dir' ? t.dir : sourceGroupDropPath(t.group)
}

/** 把字符串还原成落点（高亮 state → 松手动作） */
export function parseDropTarget(path: string | null): TreeDropTarget | null {
  if (path === null) return null
  return isSourceGroupPath(path) ? { kind: 'source', group: groupKeyOf(path) } : { kind: 'dir', dir: path }
}

export interface DropPlanInput {
  /** 拖的这批是不是来自额外源（组内条目） */
  fromSource: boolean
  /** 来自哪个源分组（`fromSource` 为真时必填；用于把动作路由到对应插件命令） */
  sourceGroup?: string
  /** 这次拖动的路径（已合并多选；源条目恒为单条） */
  paths: string[]
  target: TreeDropTarget | null
  /** 真实目录集合：普通移动时要判断哪些是目录（决定 `onRename` 的 isDir） */
  dirs: Set<string>
}

/**
 * 松手动作规划：
 *  · 公开 → 额外源分组 ⇒ `into-source`（源自己负责加密搬入）；
 *  · 额外源 → 真实目录 / 库根 ⇒ `out-of-source`（源自己负责解密落盘）；
 *  · 额外源 → 同一分组 ⇒ 不动作；
 *  · 公开 → 真实目录 ⇒ `move`（原有磁盘 move 语义，原地跳过）。
 *
 * 移入只接受**公开笔记**：`.zn/` 路径已经在私有目录里，再"移入"没有意义（会让插件
 * 拿密文当明文再加密一次），所以这里直接滤掉。
 */
export function planTreeDrop(input: DropPlanInput): TreeDropPlan | null {
  const { fromSource, sourceGroup, paths, target, dirs } = input
  if (!target || !paths.length) return null

  if (target.kind === 'source') {
    if (fromSource) return null
    const movable = paths.filter((p) => !p.startsWith('.zn/'))
    return movable.length ? { kind: 'into-source', group: target.group, paths: movable } : null
  }

  // 源条目拖出：必须带分组 key 才知道交给哪个插件（没带 ⇒ 不动作，宁可不搬也别搬错）
  if (fromSource) return sourceGroup ? { kind: 'out-of-source', group: sourceGroup, paths, dir: target.dir } : null

  const entries = paths
    .filter((p) => parentDir(p) !== target.dir)
    .map((p) => ({
      from: p,
      to: target.dir ? `${target.dir}/${baseName(p)}` : baseName(p),
      isDir: dirs.has(p),
    }))
  return entries.length ? { kind: 'move', entries } : null
}
