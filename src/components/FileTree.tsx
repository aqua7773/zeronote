import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import type {
  ItemMenuContext,
  ItemMenuKind,
  ItemMenuRegistration,
  NoteMeta,
} from '../kernel/contract'
import { ContextMenu, type MenuItem } from '@/components/ui'

type TreeNode = {
  name: string
  /**
   * 显示名 —— 来自 `NoteMeta.title`（frontmatter 的 `title` → 正文首行 → 文件名）。
   * 与 `name`（磁盘文件名）分开：新建笔记默认叫 `untitled-<时间戳>.md`，
   * 而用户眼里的名字是正文那行 `# 新笔记`。目录节点没有这个字段。
   */
  title?: string
  path: string
  children: TreeNode[]
  isDir: boolean
  /**
   * `note` = Markdown 笔记；`doc` = 只读文档（pdf / epub / …）。
   * 只用于**区分显示**（文档挂类型徽章）—— "打开走哪条命令"由 `App.tsx` 的
   * `core.openDocument` 派发，文件树不掺业务判断。
   */
  kind?: 'note' | 'doc' | 'image' | 'media'
  /**
   * **虚拟分组节点**（2026-10-13 加）—— 不对应磁盘上的真实目录，
   * 只是把只读文档聚合到一处显示。见 `DOCS_NODE`。
   * 2026-10-18 rev173.3：图片附件同理，聚到「附件」分组（`ATTACH_NODE`）。
   */
  virtual?: boolean
}

/**
 * 虚拟「文档」分组的哨兵路径 —— 它**不是**库内路径（真实路径不可能长这样，
 * 因为 `resolve()` 会拒绝任何带 `__` 前缀的合法文件名的概率极低，
 * 且这个值只在文件树内部用、从不发给内核）。
 */
const DOCS_NODE = '__zn_docs__'

/**
 * 虚拟「附件」分组的哨兵路径（rev173.3）—— 图片附件的聚合入口。
 *
 * 为什么要有它：「插入图片」把图复制进笔记所在目录后，文件树里**什么都看不到**，
 * 用户找不到自己的图（「附件的入口也没做」）。图片收进一个分组：
 * 一处能看到全部附件、点开就是全屏预览，不污染笔记的目录层级。
 */
const ATTACH_NODE = '__zn_attachments__'

/**
 * 文件树展开状态持久化（2026-10-18 用户要求：「文件树现在是每次进入都会展开，
 * 设置成默认记住上次状态」）。
 *
 * 只记**折叠**的路径集合：没有记录 = 全展开，与旧行为一致（老用户升级后观感不变）。
 * 按库隔离（key 带库路径）—— 每个库的目录结构不同，混在一起会串。
 * localStorage 不可用（隐私模式 / 配额满）时静默退回内存态，不影响使用。
 */
const TREE_COLLAPSED_KEY = 'zn-tree-collapsed'

function readCollapsed(vault: string | null): Set<string> {
  try {
    const raw = localStorage.getItem(vault ? `${TREE_COLLAPSED_KEY}:${vault}` : TREE_COLLAPSED_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr)
      ? new Set(arr.filter((x): x is string => typeof x === 'string'))
      : new Set()
  } catch {
    return new Set()
  }
}

/**
 * 目录树 = **目录清单**（`dirs`，含空目录）＋ 笔记清单（`notes`）。
 *
 * 目录清单是必需的：只靠笔记路径只能**反推**出"装过文件的"目录，**空文件夹反推不出来**
 * —— 那样"新建文件夹"会像没反应（静默失效）。所以 Rust 侧单给了 `list_dirs`。
 *
 * **只读文档单独收进一个虚拟「文档」分组**（用户 2026-10-13 要求）：
 * 文档散落在一堆目录里会让笔记树很难扫；聚合显示后，**文件本身一动不动**
 * （路径不变、仍在原目录），只是视图上归到一处。文档在磁盘上的真实位置仍然
 * 靠每行的 `title`（悬停可见完整路径）交代。
 */
function buildTree(notes: NoteMeta[], dirs: string[]): TreeNode[] {
  const root: TreeNode[] = []

  /** 逐段找到 / 建出目录节点，返回最末一段（空串 = 库根，返回 null） */
  const ensureDir = (path: string): TreeNode | null => {
    if (!path) return null
    const parts = path.split('/')
    let level = root
    let acc = ''
    let node: TreeNode | null = null
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part
      let dir = level.find((x) => x.isDir && !x.virtual && x.name === part)
      if (!dir) {
        dir = { name: part, path: acc, children: [], isDir: true }
        level.push(dir)
      }
      level = dir.children
      node = dir
    }
    return node
  }

  for (const d of dirs) ensureDir(d)

  /** 只读文档 / 附件（图片 + 音视频）的收集桶（最后统一挂到各自的虚拟分组下） */
  const docs: TreeNode[] = []
  const attachments: TreeNode[] = []

  for (const n of notes) {
    const parts = n.path.split('/')
    const name = parts[parts.length - 1]
    // 文档 / 附件不进各自目录，收进虚拟分组 —— 注意是**视图聚合**，文件不动
    if (n.kind === 'doc' || n.kind === 'image' || n.kind === 'media') {
      const bucket = n.kind === 'doc' ? docs : attachments
      bucket.push({
        name,
        path: n.path,
        children: [],
        isDir: false,
        title: n.title,
        kind: n.kind,
      })
      continue
    }
    const parentPath = parts.slice(0, -1).join('/')
    const parent = ensureDir(parentPath)
    const bucket = parent ? parent.children : root
    bucket.push({
      name,
      path: parentPath ? `${parentPath}/${name}` : name,
      children: [],
      isDir: false,
      title: n.title,
      kind: n.kind,
    })
  }

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) =>
      a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh') : a.isDir ? -1 : 1,
    )
    nodes.forEach((n) => sort(n.children))
  }
  sort(root)

  // 「文档」分组固定放**最后**（笔记优先；它不参与上面那套"目录优先"的排序）
  if (docs.length) {
    docs.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    root.push({
      name: '文档',
      path: DOCS_NODE,
      children: docs,
      isDir: true,
      kind: 'doc',
      virtual: true,
    })
  }

  // 「附件」分组（rev173.3）：图片与音视频附件的唯一可见入口，排在「文档」之后
  if (attachments.length) {
    attachments.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    root.push({
      name: '附件',
      path: ATTACH_NODE,
      children: attachments,
      isDir: true,
      kind: 'media',
      virtual: true,
    })
  }

  return root
}

/** 路径最后一段（文件名或目录名） */
const baseName = (p: string) => (p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p)

/** 所在目录（库内相对路径，库根 = 空串） */
const parentDir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/**
 * 框选命中：选择框与树节点**相交**即算。
 *
 * 不过滤「祖先目录 + 子项」：用户框住一片时，视觉上就该整片高亮。
 * 去重放在**批量操作**那一侧（`dedupe`）—— 删/移动目录时整棵树一起走，
 * 子项再列一次会变成"找不到源"。
 */
function hitTest(
  root: HTMLElement,
  box: { x0: number; y0: number; x1: number; y1: number },
): string[] {
  const hits: string[] = []
  for (const el of root.querySelectorAll<HTMLElement>('[data-zn-path]')) {
    const r = el.getBoundingClientRect()
    // 完全不重叠 ⇒ 跳过（相交即选，与资源管理器一致）
    if (r.right < box.x0 || r.left > box.x1 || r.bottom < box.y0 || r.top > box.y1) continue
    const p = el.dataset.znPath
    if (p) hits.push(p)
  }
  return hits
}

/**
 * 去掉「祖先已经在列表里」的路径。
 *
 * 为什么需要：框选会把目录和目录里的条目一起选中，而删除/剪切/复制目录时是**整棵树**一起动
 * —— 子项再列一次，第二个操作就会报"要删除的东西不存在"。
 */
function dedupe(paths: string[]): string[] {
  const set = new Set(paths)
  return paths.filter((p) => {
    for (const q of set) {
      if (q !== p && p.startsWith(`${q}/`)) return false
    }
    return true
  })
}

/** 内联命名输入框的统一外观（新建与重命名共用） */
const INPUT_CLASS =
  'w-full min-w-0 rounded-ui-sm border border-primary bg-background px-1.5 py-0.5 text-xs text-foreground outline-none'

/**
 * 内联编辑态（**新建后的命名**与**重命名**共用一套输入框）。
 * 放弃改名（空输入 / Esc）一律**保留原名** —— 删除是右键菜单的职责，不靠清空输入框。
 */
type Renaming = { path: string; isDir: boolean }

/**
 * 右键菜单状态。
 * `path === null` ⇒ 在树的**空白处**右键：只给"新建…"，落点是库根。
 * `dir` = "新建…"的落点目录（右键目录 = 它自己；右键文件 = 它的父目录）。
 */
type MenuState = {
  path: string | null
  dir: string
  isDir: boolean
  multi: boolean
  x: number
  y: number
}

/**
 * 把一个文件树条目换成**插件认识的三档类型**（rev173.281 · J#18）。
 *
 * 内核的 `NoteMeta.kind` 有 note / doc / image / media 四档，但插件不需要
 * （也不该）认识这些细节：导出、分享这类动作只关心「这是笔记 / 文件夹 / 其它附件」。
 */
function itemKindOf(meta: NoteMeta | undefined, isDir: boolean): ItemMenuKind {
  if (isDir) return 'dir'
  return (meta?.kind ?? 'note') === 'note' ? 'note' : 'attachment'
}

function Node({
  node,
  depth,
  activePath,
  selected,
  dropTarget,
  reveal,
  dragging,
  collapsed,
  onToggleOpen,
  onPick,
  onContextMenu,
  renaming,
  draft,
  setDraft,
  onSubmitRename,
  onCancelRename,
}: {
  node: TreeNode
  depth: number
  activePath: string | null
  /** 当前多选集合（用 Set 判断，避免每行 O(n) 扫数组） */
  selected: Set<string>
  /** 拖拽移动的落点（高亮用；`null` = 没在拖） */
  dropTarget?: string | null
  /** 需要自动展开到的路径（新建/重命名落在折叠的目录里时，父级把路径放进来） */
  reveal?: string | null
  /** 正在被拖动的条目（源行淡出） */
  dragging?: string | null
  /** 已折叠的目录路径（FileTree 持有并持久化；各节点的 open 由它派生） */
  collapsed: Set<string>
  /** 切换某个目录的展开 / 折叠 */
  onToggleOpen: (path: string) => void
  /** 点一行：普通=单选并打开，Ctrl/⌘=切换该项，Shift=从锚点到该项的范围；`pos` 是点击位置，选中多项时用来直接弹菜单 */
  onPick: (
    path: string,
    mods: { toggle: boolean; range: boolean },
    pos: { x: number; y: number },
  ) => void
  onContextMenu: (path: string, isDir: boolean, x: number, y: number) => void
  renaming: Renaming | null
  draft: string
  setDraft: (v: string) => void
  onSubmitRename: () => void
  onCancelRename: () => void
}) {
  /**
   * 展开 / 折叠**不再由节点自己 useSate(true) 决定**（2026-10-18 用户要求「记住上次状态」）：
   * 状态源收归 FileTree 的 `collapsed` 集合并落 localStorage，这里只做派生。
   * 没记录的目录 = 展开（与旧行为一致）。
   */
  const open = !collapsed.has(node.path)
  /**
   * 节点自身的内边距**固定** —— 层级缩进交给外面那层 `.zn-tree-kids`（每层一条竖线）。
   * 以前是 `depth * 12px`，缩进靠节点自己算，画不出引导线。
   */
  const pad = { paddingLeft: 'var(--zn-space-2)' }
  const inputRef = useRef<HTMLInputElement | null>(null)

  /**
   * 进入内联编辑态：笔记只选中**主名**（不含 `.md`），光标落在末尾；目录整体选中。
   *
   * rev173.270 · 真人使用测试 #17：以前一律整体 `select()`，想改中间一个字只能全删重打；
   * 且扩展名一起选中，用户常常顺手把它删掉 ⇒ 变出一个没扩展名的文件。
   */
  useEffect(() => {
    if (renaming?.path !== node.path) return
    const input = inputRef.current
    if (!input) return
    const base = node.name.replace(/\.md$/i, '')
    if (base !== node.name && base.length > 0) {
      input.focus()
      input.setSelectionRange(0, base.length)
    } else {
      input.select()
    }
  }, [renaming, node.path, node.name])

  // 新建/重命名落在本节点子树里 ⇒ 自动展开（否则输入框在折叠目录里，看着像"没反应"）
  // 只在「确实折着」时动一次：toggle 是切换语义，不拦 open 反而会把它折上。
  useEffect(() => {
    if (!reveal) return
    if (!open && (reveal === node.path || reveal.startsWith(`${node.path}/`))) onToggleOpen(node.path)
  }, [reveal, open, node.path, onToggleOpen])

  const editing = renaming?.path === node.path

  if (node.isDir) {
    return (
      <div className="zn-node">
        {editing ? (
          <input
            ref={inputRef}
            style={pad}
            value={draft}
            aria-label="重命名文件夹"
            className={INPUT_CLASS}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onSubmitRename()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onCancelRename()
              }
            }}
            onBlur={onSubmitRename}
          />
        ) : (
          <button
            className={`zn-tree-item${selected.has(node.path) ? ' is-picked' : ''}${
              dropTarget === node.path ? ' is-drop-target' : ''
            }${dragging === node.path ? ' is-dragging' : ''}`}
            style={pad}
            data-zn-path={node.path}
            onClick={() => onToggleOpen(node.path)}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              // 虚拟分组**不对应磁盘目录** ⇒ 不给任何文件操作菜单（它只是视图聚合）
              if (node.virtual) return
              onContextMenu(node.path, true, e.clientX, e.clientY)
            }}
            title={
              node.virtual
                ? '只读文档（PDF / EPUB / …）—— 只是聚到一处显示，文件仍在你原来的目录里'
                : `${node.path}（右键：新建 / 重命名 / 删除）`
            }
          >
            <span className="zn-tree-caret">{open ? '▾' : '▸'}</span>
            <span className="zn-tree-label">{node.name}</span>
            {node.virtual && <span className="zn-ext">{node.children.length}</span>}
          </button>
        )}
        {open && node.children.length > 0 && (
          /**
           * 子级包一层容器：缩进与**竖向引导线**都靠它（2026-10-17 用户要求「层级更清晰」）。
           * 好处：每层一条 `border-left`，深度一眼可见，还不用在节点上算渐变背景。
           * ⚠️ **空文件夹不渲染容器**：竖线规则是 `.zn-node:not(:last-child) > .zn-tree-kids`
           * —— 若空文件夹也有容器，`kids: 0` 却会画出一条空竖线（用户规则：有同级但没子项的不加）。
           */
          <div className="zn-tree-kids">
            {node.children.map((c) => (
              <Node
                key={c.path}
                node={c}
                depth={depth + 1}
                activePath={activePath}
                selected={selected}
                collapsed={collapsed}
                onToggleOpen={onToggleOpen}
                dropTarget={dropTarget}
                reveal={reveal}
                dragging={dragging}
                onPick={onPick}
                onContextMenu={onContextMenu}
                renaming={renaming}
                draft={draft}
                setDraft={setDraft}
                onSubmitRename={onSubmitRename}
                onCancelRename={onCancelRename}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  // 显示名优先用「笔记名」（frontmatter.title → 正文首行），没有才退回文件名。
  // 重命名态的输入框仍是**文件名**（它改的是磁盘上的名字，不是显示名）——
  // 所以下面 title 提示里始终带着真实路径，免得"名字怎么和文件对不上"。
  // 文档（pdf / epub / …）：Rust 侧给的 `title` 就是**带扩展名的文件名**
  // （文档没有 frontmatter / 首行标题那套语义），这里再挂一个类型徽章
  // —— 否则它在树里和笔记长得一模一样，用户分不清哪个能编辑。
  const isDoc = node.kind === 'doc'
  /** 附件（rev173.3 图片 · rev173.226 音视频）：与只读文档同样挂扩展名徽章 */
  const isImage = node.kind === 'image'
  const isMedia = node.kind === 'media'
  const ext =
    isDoc || isImage || isMedia
      ? node.name.slice(node.name.lastIndexOf('.') + 1).toLowerCase()
      : ''
  /**
   * 显示名（2026-10-17 用户定「文件显示 .md」）：
   *  · 笔记 —— 直接显示**磁盘文件名**（含 `.md`），一眼看出是 Markdown；
   *  · 只读文档（pdf/epub/…）/ 图片 / 音视频 —— 去掉扩展名：它后面已经跟着
   *    `.pdf` / `.png` / `.mp4` 徽章了，再带一次会变成 `测试书籍.epub .epub`。
   */
  const label = isDoc || isImage || isMedia ? node.name.replace(/\.[a-z0-9]+$/i, '') : node.name
  /**
   * 高亮判据**用选中集合**，不用裸 `activePath`（2026-10-17 修）：
   * `selectedSet` 已经处理了「selected 为空 ⇒ 回退到当前打开的那篇」，
   * 而点空白处会把 `selectionCleared` 置真、让集合变空 —— 若这里还按 activePath 判，
   * 打开的笔记会继续亮着，看起来就是"没清掉选中"。
   */
  const active = node.path === activePath && selected.has(node.path)
  const picked = selected.has(node.path) && !active

  if (editing) {
    return (
      <input
        ref={inputRef}
        style={pad}
        value={draft}
        aria-label="重命名笔记"
        className={INPUT_CLASS}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onSubmitRename()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancelRename()
          }
        }}
        onBlur={onSubmitRename}
      />
    )
  }

  return (
    <div className="zn-node">
      <button
        className={`zn-tree-item${active ? ' is-active' : ''}${picked ? ' is-picked' : ''}${
          dropTarget === node.path ? ' is-drop-target' : ''
        }${dragging === node.path ? ' is-dragging' : ''}`}
        style={pad}
        data-zn-path={node.path}
        onClick={(e) =>
          onPick(
            node.path,
            { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey },
            { x: e.clientX, y: e.clientY },
          )
        }
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        // 手机长按（Android 把长按转成 contextmenu）与电脑右键**同一个菜单**（2026-10-18 用户要求）。
        onContextMenu(node.path, false, e.clientX, e.clientY)
      }}
      title={`${node.path}（右键：重命名 / 删除；Ctrl 点选可多选）`}
    >
      {/* 圆点：与目录行的三角同宽同高，垂直居中 —— 让文件行也有"项目符号"，
          且名字与同级文件夹名对齐（用户 2026-10-17：「笔记前面加圆点，大小与三角一致」） */}
      <span className="zn-tree-caret zn-tree-dot" aria-hidden="true">
        ●
      </span>
      <span className="zn-tree-label">{label}</span>
      {(isDoc || isImage || isMedia) && <span className="zn-ext">.{ext}</span>}
      </button>
    </div>
  )
}

export function FileTree({
  notes,
  dirs = [],
  activePath,
  vault = null,
  clipboard,
  onOpen,
  onNewFile,
  onNewDir,
  onCut,
  onCopy,
  onPaste,
  onDuplicate,
  onRename,
  onDeleteMany,
  onPurgeMany,
  layers,
  onOpenTimeline,
  itemActions = [],
  onItemAction,
}: {
  notes: NoteMeta[]
  /** 目录清单（含空目录）—— 见 `buildTree` 的说明 */
  dirs?: string[]
  activePath: string | null
  /**
   * 当前库的绝对路径 —— **展开/折叠状态按库隔离**（2026-10-18 用户要求
   * 「默认记住上次状态」；每个库的目录结构不同，共用一个 key 会串）。
   */
  vault?: string | null
  onOpen: (path: string) => void
  /**
   * 在 `dir`（库内相对路径，`''` = 库根）建一篇新笔记。
   * 返回**落盘后的库内路径**，失败返回 null —— 调用方据此进入内联命名态。
   */
  onNewFile: (dir: string) => Promise<string | null>
  /** 在 `dir` 建一个新文件夹，返回落盘后的库内路径 */
  onNewDir: (dir: string) => Promise<string | null>
  /** 重命名 / 移动；`isDir` 决定底层走 `move`（能搬目录树）还是 `rename` */
  onRename: (from: string, to: string, isDir: boolean) => void
  /** 删除（单条也走这条，传长度 1 的数组）—— 多选时一次删多篇 */
  onDeleteMany: (paths: string[]) => void
  /**
   * **彻底删除**（不进回收站、不可撤销）—— 用户 2026-10-13 要求。
   * 支持多选；调用方（`App.tsx`）只负责干活，**二次确认由本组件负责**（它是 UI 的事）。
   */
  onPurgeMany: (paths: string[]) => void
  /** 应用级剪贴板（null = 空）：菜单据此决定「粘贴」这一项在不在 */
  clipboard: { mode: 'cut' | 'copy'; paths: string[] } | null
  onCut: (paths: string[]) => void
  onCopy: (paths: string[]) => void
  /** 粘贴到 `dir`（`''` = 库根） */
  onPaste: (dir: string) => void
  /** 创建副本（同目录 + 「 副本」；文件与目录都支持） */
  onDuplicate: (path: string) => void
  /**
   * 「层出口」栈（App 持有）—— 右键菜单这类**状态由本组件自持**的浮层，
   * 打开时把自己的关闭函数压进去，让 Android 返回键能先关掉它（见 App 的 `backRef`）。
   * 不传也能用 —— 返回键只在 Android 存在，桌面端不需要。
   */
  layers?: RefObject<Array<() => boolean>>
  /**
   * 桌面「时间流」的入口（rev173.48 · 用户要求「文件树右键菜单加打开时间流」）。
   * 只有桌面由 App 传；手机端没有时间流 ⇒ 不传，菜单里就不出现这一项。
   */
  onOpenTimeline?: () => void
  /**
   * **条目菜单动作**（rev173.281 · J#18）—— 插件声明、内核登记的扩展项。
   * 宿主只负责按 `where` / `kinds` 过滤并渲染；点击后把目标条目作为参数交给 App。
   * 不传 ⇒ 菜单里没有插件项（单测 / 零插件都走这条路）。
   */
  itemActions?: ItemMenuRegistration[]
  onItemAction?: (action: ItemMenuRegistration, ctx: ItemMenuContext) => void
}) {
  const tree = useMemo(() => buildTree(notes, dirs), [notes, dirs])
  /**
   * **折叠的目录集合**（2026-10-18 用户要求「文件树默认记住上次状态」）。
   * 记「折叠」而不是「展开」：默认全展开 = 空集合，与升级前观感一致。
   * 换库时靠 `AppSidebar` 的 `key={vault}` 重建本组件 ⇒ 自然读到那个库自己的记录。
   */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsed(vault ?? null))

  // 折叠状态一变就落盘（localStorage 同步写，很便宜）
  useEffect(() => {
    try {
      const key = vault ? `${TREE_COLLAPSED_KEY}:${vault}` : TREE_COLLAPSED_KEY
      if (collapsed.size > 0) localStorage.setItem(key, JSON.stringify([...collapsed]))
      else localStorage.removeItem(key)
    } catch {
      /* 存不了就退化成"只记在内存里"（隐私模式 / 配额满），不影响用 */
    }
  }, [collapsed, vault])

  const toggleOpen = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [renaming, setRenaming] = useState<Renaming | null>(null)
  const [draft, setDraft] = useState('')
  /** 多选：当前高亮的路径；空数组时退化为「只有打开的那篇被选中」 */
  const [selected, setSelected] = useState<string[]>([])
  /** Shift 范围选择的锚点 */
  const [anchor, setAnchor] = useState<string | null>(null)
  /**
   * **点选模式**（2026-10-13 加，给手机用；rev141 收敛成只剩右键入口）——
   * 触屏没有 Ctrl/Shift，多选入口等于没了；从右键/长按菜单的「多选」进入后，
   * 点一行 = 加/减选（**不打开**笔记），再右键/长按对整批操作（菜单里显示
   * 「删除选中的 N 项」等）。rev141 按用户要求去掉了顶栏按钮与批量操作条。
   */
  const [selectMode, setSelectMode] = useState(false)
  /**
   * 「彻底删除」的二次确认（2026-10-13 加）—— 它**不进回收站、撤不回来**，
   * 与「删除」（移入回收站）是两回事 ⇒ 必须问一次。
   * `x/y` 是触发点的视口坐标，浮层用 `position:fixed` 贴在那儿。
   */
  const [purgeConfirm, setPurgeConfirm] = useState<{ paths: string[]; x: number; y: number } | null>(
    null,
  )
  /**
   * **框选**（2026-10-17 用户要求：鼠标左键拖拽，像资源管理器一样一次选中一片）。
   * `marquee` 是选择框的视口坐标（`null` = 没在拖）。
   */
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  )

  /** 拖拽移动时鼠标下的目标文件夹（只用于高亮，`null` = 没有有效落点） */
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  /** 正在被拖动的条目（源行半透明；`null` = 没在拖） */
  const [draggingPath, setDraggingPath] = useState<string | null>(null)
  /** 跟随鼠标的拖动标签（2026-10-17：拖拽要有跟手的视觉反馈） */
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number; label: string } | null>(null)
  /**
   * 需要**自动展开**到的路径（2026-10-17）。
   *
   * 起因（用户报）：文件夹折叠时点「新建文件夹」，新条目与内联输入框都不会出现 ——
   * 因为子树只在 `{open && children.map(...)}` 里渲染。用户看到的是"菜单点了没反应"。
   * 新建 / 重命名时把父目录路径放进来，对应节点展开一次。
   */
  const [reveal, setReveal] = useState<string | null>(null)
  /** 树容器 —— 框选要按每个节点的真实位置求交，得从 DOM 里量 */
  const rootRef = useRef<HTMLDivElement | null>(null)
  /** 刚框选完 —— 用来拦掉紧随其后的那次 click（否则会顺手打开笔记/折叠目录） */
  const suppressClickRef = useRef(false)
  /**
   * 「用户主动把选中清空了」—— 2026-10-17 加。
   *
   * 背景：`selectedSet` 在 `selected` 为空时会**回退到 `activePath`**（打开一篇笔记时
   * 那行要高亮，这是外部打开/搜索跳转变更时的唯一高亮来源）。但点空白处要求"全不选"
   * ⇒ 光清 `selected` 不够：回退逻辑会让**当前打开的那篇**继续亮着，看起来就是没清掉。
   * 所以单独记一个"已被主动清空"，点行 / 换笔记时复位。
   */
  const [selectionCleared, setSelectionCleared] = useState(false)

  /* 用「派生」而不是 effect 同步：外部（搜索面板、快速打开）打开别的笔记时，
     activePath 会变，这里直接把它当作唯一选中项，不必写 setState-in-effect。
     注意依赖必须是 selected / activePath 本身 —— 若在外面先算出 "effectiveSelected"
     数组再依赖它，那个数组每次渲染都是新的，memo 就白做了（lint 也会报）。 */
  const selectedSet = useMemo(() => {
    const eff = selected.length
      ? selected
      : !selectionCleared && activePath
        ? [activePath]
        : []
    return new Set(eff)
  }, [selected, activePath, selectionCleared])

  /* 换了笔记（外部打开 / 搜索跳转）⇒ 恢复"回退到 activePath"的行为 */
  useEffect(() => {
    setSelectionCleared(false)
  }, [activePath])

  /**
   * 所有**真实目录**的路径集合 —— 拖拽移动只认文件夹做落点。
   * 虚拟「文档」分组不在这里（它只是视图聚合，不是磁盘目录）。
   */
  const dirPathSet = useMemo(() => new Set(dirs), [dirs])

  /** 按**显示顺序**摊平的路径表 —— 树是嵌套的，Shift 范围选择得按屏幕上的顺序来 */
  const flatPaths = useMemo(() => {
    const out: string[] = []
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.isDir) walk(n.children)
        else out.push(n.path)
      }
    }
    walk(tree)
    return out
  }, [tree])

  /**
   * 菜单定位：桌面跟鼠标右下角（`pointer`）；手机挂在**长按点下方固定 72px**
   * （`below-pointer`，离长按位置拉开一段距离，不挡长按行）—— 用户 2026-10-18 定。
   */
  const menuAnchor: 'pointer' | 'below-pointer' = /Android/i.test(navigator.userAgent)
    ? 'below-pointer'
    : 'pointer'

  /**
   * 多选后**直接弹菜单**（2026-10-18 用户要求：「多选时直接弹出选中后的菜单，
   * 不需要再右键一次」）。只对 **≥2 项**的选中集合弹：单项选中时普通点击已经
   * 打开笔记了，交给右键/长按自己开菜单。
   */
  const openBatchMenu = (paths: string[], focusPath: string, x: number, y: number) => {
    if (paths.length < 2) return
    const focus = paths.includes(focusPath) ? focusPath : paths[0]
    setMenu({
      path: focus,
      dir: parentDir(focus),
      isDir: false,
      multi: true,
      x,
      y,
    })
  }

  const pick = (
    path: string,
    mods: { toggle: boolean; range: boolean },
    pos: { x: number; y: number },
  ) => {
    // 用户点了某一行 ⇒ 主动清空的态结束（重新有选中）
    setSelectionCleared(false)
    // 点选模式（右键菜单「多选」进的）：点一行 = 加/减选，**不打开**笔记 ——
    // 否则一开编辑器就把抽屉收起来，多选根本做不下去。
    // 选到 ≥2 项就直接弹批量菜单，不用再长按/右键一次。
    if (selectMode) {
      const next = selected.includes(path)
        ? selected.filter((p) => p !== path)
        : [...selected, path]
      setSelected(next)
      setAnchor(path)
      openBatchMenu(next, path, pos.x, pos.y)
      return
    }
    if (mods.range && anchor) {
      const a = flatPaths.indexOf(anchor)
      const b = flatPaths.indexOf(path)
      if (a >= 0 && b >= 0) {
        const lo = Math.min(a, b)
        const hi = Math.max(a, b)
        const next = flatPaths.slice(lo, hi + 1)
        setSelected(next)
        openBatchMenu(next, path, pos.x, pos.y)
        return
      }
    }
    if (mods.toggle) {
      const base = selected.length ? selected : activePath ? [activePath] : []
      const next = base.includes(path) ? base.filter((p) => p !== path) : [...base, path]
      setSelected(next)
      setAnchor(path)
      openBatchMenu(next, path, pos.x, pos.y)
      return
    }
    // 普通点击：单选 + 打开
    setSelected([path])
    setAnchor(path)
    onOpen(path)
  }

  /**
   * 鼠标左键在树里的两种拖拽（2026-10-17）：
   *
   *  · 从**条目上**按下再拖 = **拖拽移动**（把笔记/文件夹拖进另一个文件夹）；
   *  · 从**空白处**按下再拖 = **框选**。
   *
   * 约束与取舍：
   *  · 只认鼠标左键 —— 触摸走长按（手指拖拽在列表里通常是想滚动）；
   *  · 位移超过 4px 才算拖拽，否则仍是普通点击（打开笔记 / 折叠目录）；
   *  · 点在**滚动条**上不算；
   *  · 拖拽移动只认**文件夹**做落点（虚拟「文档」分组不是目录），且拒绝拖进自己/自己的子孙；
   *  · 拖的若是选中集合里的一项 ⇒ **整批移动**；否则只移动它自己；
   *  · 拖完拦掉那次 click，否则一松手就把最后经过的笔记打开了。
   *
   * 为什么监听 window 而不是容器的 `onPointerMove`：拖出侧栏时容器收不到事件，
   * 框/拖都会卡住；挂到 window 上，松手在哪儿都能结束。
   */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.pointerType && e.pointerType !== 'mouse')) return
    const root = rootRef.current
    if (!root) return
    // 点在滚动条上 → 放行（垂直滚动条占容器右侧那几像素）
    const box0 = root.getBoundingClientRect()
    if (root.offsetWidth - root.clientWidth > 0 && e.clientX > box0.left + root.clientWidth) return

    const start = { x: e.clientX, y: e.clientY }
    /** 按下点落在哪个条目上（null = 空白 ⇒ 框选模式） */
    const fromPath =
      (e.target as HTMLElement).closest<HTMLElement>('[data-zn-path]')?.dataset.znPath ?? null
    let dragging = false
    /** 拖拽移动的落点（只在 fromPath 非空时有意义） */
    let target: string | null = null
    /** 框选最近一次的选择框 —— 松手时按它算命中集合，用来直接弹菜单 */
    let lastBox: { x0: number; y0: number; x1: number; y1: number } | null = null

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x
      const dy = ev.clientY - start.y
      if (!dragging && Math.abs(dx) < 4 && Math.abs(dy) < 4) return
      dragging = true

      if (!fromPath) {
        // ── 框选 ──
        const box = {
          x0: Math.min(start.x, ev.clientX),
          y0: Math.min(start.y, ev.clientY),
          x1: Math.max(start.x, ev.clientX),
          y1: Math.max(start.y, ev.clientY),
        }
        lastBox = box
        setMarquee(box)
        setSelected(hitTest(root, box))
        // 框选**不进点选模式**：框选完直接用弹出的批量菜单操作这批选中项
        setSelectMode(false)
        return
      }

      // ── 拖拽移动：只认文件夹做落点 ──
      const over =
        document
          .elementFromPoint(ev.clientX, ev.clientY)
          ?.closest<HTMLElement>('[data-zn-path]')?.dataset.znPath ?? null
      const ok =
        !!over && over !== fromPath && !over.startsWith(`${fromPath}/`) && dirPathSet.has(over)
      target = ok ? over : null
      setDropTarget(target)
      // 拖拽视觉：源行淡出 + 跟手的小标签（用户 2026-10-17：「拖拽要有动画效果」）
      setDraggingPath(fromPath)
      const count = selectedSet.has(fromPath) && selectedSet.size > 1 ? selectedSet.size : 1
      setDragGhost({
        x: ev.clientX,
        y: ev.clientY,
        label: count > 1 ? `${baseName(fromPath)} 等 ${count} 项` : baseName(fromPath),
      })
    }

    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setMarquee(null)
      setDropTarget(null)
      setDraggingPath(null)
      setDragGhost(null)
      if (!dragging) return
      suppressClickRef.current = true
      // 同一次点击的 click 在本轮任务里派发 —— 下一轮再清，保证拦得到
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)

      // 框选松手：≥2 项就直接弹批量菜单（2026-10-18 用户要求，省掉再右键一次）
      if (!fromPath) {
        if (lastBox) openBatchMenu(hitTest(root, lastBox), '', ev.clientX, ev.clientY)
        return
      }

      if (!target) return
      // 拖的项在选中集合里 ⇒ 整批搬；否则只手拖那一项
      const paths =
        selectedSet.has(fromPath) && selectedSet.size > 1 ? dedupe([...selectedSet]) : [fromPath]
      // 已经在目标目录里的跳过（搬进原地 = 白跑一趟，Rust 那边还会报「目标已存在」）
      const moved = paths.filter((p) => parentDir(p) !== target)
      if (!moved.length) return
      for (const p of moved) {
        onRename(p, `${target}/${baseName(p)}`, dirPathSet.has(p))
      }
      setSelected([])
      setSelectionCleared(true)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* 右键菜单 / 点选模式都是「返回键该先关掉的一层」—— 打开时把关闭函数压进 App 的层出口栈。
     ⚠️ 必须写在下面「空库」那个 early return **之前**（Hooks 不能条件执行）。 */
  useEffect(() => {
    const stack = layers?.current
    if (!stack) return
    const close = menu
      ? () => setMenu(null)
      : selectMode
        ? () => {
            setSelectMode(false)
            setSelected([])
          }
        : null
    if (!close) return
    const fn = () => {
      close()
      return true
    }
    stack.push(fn)
    return () => {
      const i = stack.indexOf(fn)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [menu, selectMode, layers])

  const startRename = (path: string, isDir: boolean) => {
    setDraft(baseName(path))
    setRenaming({ path, isDir })
    // 父目录折叠时先展开：否则输入框在折叠的子树里，看着像"点了没反应"
    setReveal(parentDir(path))
    setMenu(null)
  }

  const cancelRename = () => setRenaming(null)

  /**
   * 提交重命名 / 移动。规则：
   *  · 只写名字 = 同目录改名；写 `子目录/名.md` = 连目录一起搬（Rust 侧会自动建父目录）
   *  · 文件不带后缀自动补 `.md`；**目录不补**（目录名里带点很常见）
   *  · `..`、绝对路径、Windows 非法字符一律交给 Rust 的路径校验拒绝，错误原样显示
   *  · 空输入 = 放弃改名；刚新建的条目**保留默认名**（删除走右键菜单，不靠清空输入框）
   */
  const submitRename = () => {
    const r = renaming
    setRenaming(null)
    if (!r) return
    const raw = draft.trim()
    if (!raw || raw === baseName(r.path)) return
    const dir = parentDir(r.path)
    const joined = raw.includes('/') ? raw : dir ? `${dir}/${raw}` : raw
    if (r.isDir) {
      if (joined !== r.path) onRename(r.path, joined, true)
      return
    }
    // 只有**没有扩展名**时才补 `.md` —— 否则把 PDF / EPUB 重命名会变成 `手册.pdf.md`
    // （2026-10-13：只读文档进文件树后才暴露这条；此前树里只有 .md，这分支永远命不中非 md）
    const next = /\.[a-z0-9]+$/i.test(joined) ? joined : `${joined}.md`
    if (next !== r.path) onRename(r.path, next, false)
  }

  /** 菜单里的「新建文件 / 新建文件夹」→ 落盘后立刻进入内联命名态 */
  const createIn = async (dir: string, isDir: boolean) => {
    setMenu(null)
    const path = isDir ? await onNewDir(dir) : await onNewFile(dir)
    if (!path) return
    // 新建的**文件**顺手打开 —— 用户刚建它，下一步多半就是写内容
    if (!isDir) onOpen(path)
    startRename(path, isDir)
  }

  /**
   * 树顶栏：**新建笔记 / 新建文件夹**（2026-10-18 用户要求，截图红框位置）。
   *
   * 复用右键菜单同一套 `createIn`：落盘后进入内联命名态、新笔记顺手打开 —— 行为与右键完全一致。
   * 空库与有内容两种情况都要有（空库时右键虽然也能新建，但没有可见入口）。
   */
  const toolbar = (
    <div className="zn-tree-toolbar">
      {/* ⚠️ 按钮都要 `stopPropagation`：根容器的 onClick 把空白处点击当成「取消选中」，
          不拦住的话新建完还没点开编辑器，选中就被同一次冒泡清掉了。 */}
      <button
        type="button"
        className="zn-plain-btn zn-tree-new"
        onClick={(e) => {
          e.stopPropagation()
          void createIn('', false)
        }}
        title="在库根新建笔记"
      >
        新建笔记
      </button>
      <button
        type="button"
        className="zn-plain-btn zn-tree-new"
        onClick={(e) => {
          e.stopPropagation()
          void createIn('', true)
        }}
        title="在库根新建文件夹"
      >
        新建文件夹
      </button>
    </div>
  )

  if (!notes.length && !dirs.length) {
    return (
      <div
        className="zn-tree zn-filetree"
        style={{ color: 'var(--zn-fg-subtle)', fontSize: 'var(--zn-text-sm)' }}
        onContextMenu={(e) => {
          // 空库也要能新建 —— 空白处右键给「新建文件 / 新建文件夹」
          e.preventDefault()
          setMenu({ path: null, dir: '', isDir: true, multi: false, x: e.clientX, y: e.clientY })
        }}
      >
        {toolbar}
        库里还没有 .md 文件（右键可新建）
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            anchor={menuAnchor}
            items={[
              { label: '新建文件', onClick: () => void createIn('', false) },
              { label: '新建文件夹', onClick: () => void createIn('', true) },
            ]}
            onClose={() => setMenu(null)}
          />
        )}
      </div>
    )
  }

  // 删除是「一步完成 + 可撤销」—— 依据 Apple HIG：常见且可撤销的破坏操作不该弹确认，
  // 只有不可逆的才必须确认。可撤销性由 App 的撤销条提供（几秒内能把文件搬回来）。
  /**
   * 键盘快捷键 —— 只在**焦点位于文件树内**时生效（子 `button` 聚焦后 keydown 会冒泡到这里）。
   * 这样 `Ctrl+C` 在编辑器里仍然是复制文本，不会把整篇笔记复制走。
   */
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey
    const picked = dedupe(selected.length ? selected : activePath ? [activePath] : [])
    const key = e.key.toLowerCase()
    if (e.key === 'F2' && picked.length === 1) {
      e.preventDefault()
      // 选中集合只含**文件**（目录不参与多选），所以这里恒为文件重命名
      startRename(picked[0], false)
    } else if (e.key === 'Delete' && picked.length) {
      e.preventDefault()
      deletePaths(picked)
    } else if (mod && key === 'x' && picked.length) {
      e.preventDefault()
      onCut(picked)
    } else if (mod && key === 'c' && picked.length) {
      e.preventDefault()
      onCopy(picked)
    } else if (mod && key === 'v') {
      e.preventDefault()
      // 贴到「选中项所在目录」；没有选中 ⇒ 库根
      onPaste(picked.length ? parentDir(picked[0]) : '')
    }
  }

  const deletePaths = (paths: string[]) => {
    // 框选可能同时选中目录与它里面的条目 —— 删除按树走，先去掉被目录包含的子项
    onDeleteMany(dedupe(paths))
    setSelected([])
    setMenu(null)
    // 删完就退出点选模式（选中已空，留着模式只会让下一次点击变成"加选"）
    setSelectMode(false)
  }

  const items: MenuItem[] = menu
    ? (() => {
        const list: MenuItem[] = []
        // 与 NoteGen 的右键结构对齐：新建在最上，其次重命名 / 删除。
        // （它菜单里的「查看目录 / 知识库 / 上传下载 / 删除远程」ZeroNote 没有对应概念，
        //   故不列出 —— 宁缺勿假。）
        list.push({ label: '新建文件', onClick: () => void createIn(menu.dir, false) })
        list.push({ label: '新建文件夹', onClick: () => void createIn(menu.dir, true) })
        if (menu.path) {
          const path = menu.path
          const multi = menu.multi
          const picked = multi ? dedupe([...selectedSet]) : [path]
          // 与 NoteGen 同序：新建 → 剪切 / 复制 / 创建副本 / 粘贴 → 重命名 → 删除
          list.push({
            label: '剪切',
            hint: 'Ctrl+X',
            divider: true,
            onClick: () => {
              onCut(picked)
              setMenu(null)
            },
          })
          list.push({
            label: '复制',
            hint: 'Ctrl+C',
            onClick: () => {
              onCopy(picked)
              setMenu(null)
            },
          })
          list.push({
            label: '创建副本',
            onClick: () => {
              onDuplicate(path)
              setMenu(null)
            },
          })
          // 剪贴板为空时**不显示**「粘贴」—— MenuItem 没有 disabled 态，
          // 与其摆一个点了没反应的灰项，不如让它不出现
          if (clipboard) {
            list.push({
              label: '粘贴',
              hint: 'Ctrl+V',
              onClick: () => {
                onPaste(menu.dir)
                setMenu(null)
              },
            })
          }
          list.push({
            label: '重命名',
            hint: 'F2',
            divider: true,
            onClick: () => startRename(path, menu.isDir),
          })
          list.push({
            label: multi
              ? `删除选中的 ${selectedSet.size} 项`
              : menu.isDir
                ? '删除文件夹'
                : '删除',
            danger: true,
            onClick: () => deletePaths(multi ? [...selectedSet] : [path]),
          })
          // 彻底删除（不进回收站）—— 单独一项，且**必须二次确认**（`setPurgeConfirm`）
          list.push({
            label: multi ? `彻底删除选中的 ${selectedSet.size} 项…` : '彻底删除…',
            danger: true,
            onClick: () => {
              const targets = multi ? [...selectedSet] : [path]
              setMenu(null)
              setPurgeConfirm({ paths: targets, x: menu.x, y: menu.y })
            },
          })
          // 右键的是选中项之外的一条时，额外给一个「删除选中的 N 项」入口
          if (!multi && selectedSet.size > 1) {
            list.push({
              label: `删除选中的 ${selectedSet.size} 项`,
              danger: true,
              divider: true,
              onClick: () => deletePaths([...selectedSet]),
            })
          }
          /**
           * 「多选」入口（2026-10-18 用户要求保留；rev141 圈掉顶栏按钮与批量条后，这里是
           * **唯一**的入口）。点击后**菜单原地切换**成多选菜单（不关、不要求再右键一次），
           * 之后点行只加/减选，选到 ≥2 项时 `pick` 再弹一次批量菜单。
           */
          // 只对**文件**给多选入口 —— 现有选择集合的语义是「只含文件」（见上面 onKeyDown 注释）
          if (!multi && !menu.isDir) {
            list.push({
              label: '多选',
              divider: true,
              // ⚠️ keepOpen：ContextMenu 点完默认会 onClose；这里要**原地切换**，不能关
              keepOpen: true,
              onClick: () => {
                setSelectMode(true)
                setSelected([path])
                setAnchor(path)
                // 菜单**不关**：直接把 `multi` 置真，下一帧 items 重算成多选菜单
                setMenu((m) => (m ? { ...m, multi: true } : m))
              },
            })
          }
        }
        /**
         * ── 插件贡献的**条目菜单动作**（rev173.281 · J#18）──
         *
         * 位置：文件操作之后、视图开关之前。第一项强制画分隔线（与「彻底删除」
         * 这类破坏性操作拉开距离）；插件自己也可以对后续项声明 `divider`。
         * 空白处右键（`menu.path === null`）**不出现** —— 动作永远针对一个条目。
         */
        if (menu.path && onItemAction && itemActions.length) {
          const path = menu.path
          const kind = itemKindOf(
            notes.find((n) => n.path === path),
            menu.isDir,
          )
          // 多选时把整批路径一起给插件（含右键的那条）；单选只给一条
          const picked = menu.multi ? dedupe([...selectedSet]) : [path]
          const ctx: ItemMenuContext = {
            path,
            kind,
            where: 'file-tree',
            ...(picked.length > 1 ? { paths: picked } : {}),
          }
          const matches = itemActions
            .filter((a) => (a.where ?? ['file-tree', 'timeline']).includes('file-tree'))
            .filter((a) => (a.kinds ?? ['note']).includes(kind))
          const toMenu = (a: ItemMenuRegistration, first: boolean): MenuItem =>
            a.children?.length
              ? {
                  label: a.title,
                  danger: a.danger,
                  divider: first ? true : a.divider,
                  children: a.children.map((c, i) => ({
                    label: c.title,
                    danger: c.danger,
                    // 子菜单第一行上面就是父项，不再画线
                    divider: i > 0 ? c.divider : undefined,
                    onClick: () => onItemAction({ ...c, pluginId: a.pluginId }, ctx),
                  })),
                }
              : {
                  label: a.title,
                  danger: a.danger,
                  divider: first ? true : a.divider,
                  onClick: () => onItemAction(a, ctx),
                }
          for (let i = 0; i < matches.length; i++) list.push(toMenu(matches[i], i === 0))
        }
        // ── 打开时间流（rev173.48 · 用户要求「文件树右键菜单加打开时间流」）──
        // 放在最后：它是"视图开关"，不是文件操作。空白处右键（menu.path === null）也能用。
        if (onOpenTimeline) {
          list.push({
            label: '打开时间流',
            divider: true,
            onClick: () => {
              setMenu(null)
              onOpenTimeline()
            },
          })
        }
        return list
      })()
    : []

  return (
    <div
      className="zn-tree zn-filetree"
      ref={rootRef}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onClickCapture={(e) => {
        // 框选刚结束的那次 click 一律拦掉 —— 见 `onPointerDown` 的说明
        if (suppressClickRef.current) {
          suppressClickRef.current = false
          e.preventDefault()
          e.stopPropagation()
        }
      }}
      onClick={(e) => {
        // 点**空白处** = 取消选中（与资源管理器一致，2026-10-17 用户要求）。
        // 点节点时事件从节点冒泡上来 —— target 落在 `[data-zn-path]` 里，这里不动选中。
        // ⚠️ 右键菜单项点击也会冒泡到这里（菜单不是 portal）：必须放行，否则点菜单项
        // 会被同一次冒泡立刻当成「点空白」清掉选中（2026-10-18 实测）。
        if ((e.target as HTMLElement).closest('[role="menu"]')) return
        if (!(e.target as HTMLElement).closest('[data-zn-path]')) {
          setSelected([])
          setAnchor(null)
          // 连「当前打开的那篇」的高亮也一起收掉（否则回退逻辑会让它继续亮着）
          setSelectionCleared(true)
          setSelectMode(false) // 点选模式也一并退出（选中已空，再点一行不该继续加选）
        }
      }}
      onContextMenu={(e) => {
        // 空白处右键 = 在**库根**新建（节点的右键已 stopPropagation，不会走到这里）
        e.preventDefault()
        setMenu({ path: null, dir: '', isDir: true, multi: false, x: e.clientX, y: e.clientY })
      }}
    >
      {toolbar}
      {/* 框选的选择框：fixed 定位（不占布局、跟随视口坐标），松手即消失 */}
      {marquee && (
        <div
          className="zn-marquee"
          style={{
            left: marquee.x0,
            top: marquee.y0,
            width: marquee.x1 - marquee.x0,
            height: marquee.y1 - marquee.y0,
          }}
        />
      )}
      {/* 拖拽移动时跟随鼠标的小标签（拖拽的"动画反馈"：源行淡出 + 这个跟手胶囊） */}
      {dragGhost && (
        <div className="zn-drag-ghost" style={{ left: dragGhost.x, top: dragGhost.y }}>
          {dragGhost.label}
        </div>
      )}
      {tree.map((n) => (
        <Node
          key={n.path}
          node={n}
          depth={0}
          activePath={activePath}
          selected={selectedSet}
          collapsed={collapsed}
          onToggleOpen={toggleOpen}
          dropTarget={dropTarget}
          reveal={reveal}
          dragging={draggingPath}
          onPick={pick}
          onContextMenu={(path, isDir, x, y) =>
            setMenu({
              path,
              dir: isDir ? path : parentDir(path),
              isDir,
              multi: selectedSet.has(path) && selectedSet.size > 1,
              x,
              y,
            })
          }
          renaming={renaming}
          draft={draft}
          setDraft={setDraft}
          onSubmitRename={submitRename}
          onCancelRename={cancelRename}
        />
      ))}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={items}
          anchor={menuAnchor}
          onClose={() => setMenu(null)}
        />
      )}

      {/* 「彻底删除」的二次确认 —— 不进回收站、撤不回来，所以必须问一次（与「删除」是两回事）。
          用 portal 挂到 body：侧栏抽屉有 transform 动画，`position:fixed` 会被祖先裁掉
          （2026-10-18 手机实测「删除框被截断」）。 */}
      {purgeConfirm &&
        createPortal(
          <div
            role="dialog"
            aria-label="确认彻底删除"
            style={{
              position: 'fixed',
              zIndex: 60,
              width: 288,
              padding: '12px 14px',
              border: '1px solid var(--zn-border)',
              borderRadius: 10,
              background: 'var(--zn-bg)',
              color: 'var(--zn-fg)',
              boxShadow: '0 8px 24px rgba(0,0,0,.22)',
              fontSize: 'var(--zn-text-sm)',
              lineHeight: 1.6,
              left: Math.max(8, Math.min(purgeConfirm.x, window.innerWidth - 296)),
              top: Math.max(8, Math.min(purgeConfirm.y, window.innerHeight - 170)),
            }}
          >
            <div style={{ fontWeight: 600 }}>
              {purgeConfirm.paths.length > 1
                ? `彻底删除这 ${purgeConfirm.paths.length} 项？`
                : '彻底删除这一项？'}
            </div>
            <div style={{ color: 'var(--zn-fg-subtle)' }}>
              不经过回收站，<strong>永久抹掉</strong> —— 撤不回来。
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
              <button type="button" className="zn-plain-btn" onClick={() => setPurgeConfirm(null)}>
                取消
              </button>
              <button
                type="button"
                className="zn-plain-btn is-danger"
                onClick={() => {
                  const ps = purgeConfirm.paths
                  setPurgeConfirm(null)
                  setSelected([])
                  setSelectMode(false)
                  onPurgeMany(ps)
                }}
              >
                彻底删除
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
