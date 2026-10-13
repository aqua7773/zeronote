import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react'
import type { NoteMeta } from '../kernel/contract'
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
  kind?: 'note' | 'doc'
  /**
   * **虚拟分组节点**（2026-10-13 加）—— 不对应磁盘上的真实目录，
   * 只是把只读文档聚合到一处显示。见 `DOCS_NODE`。
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

  /** 只读文档的收集桶（最后统一挂到虚拟分组下） */
  const docs: TreeNode[] = []

  for (const n of notes) {
    const parts = n.path.split('/')
    const name = parts[parts.length - 1]
    // 文档不进各自目录，收进虚拟分组 —— 注意是**视图聚合**，文件不动
    if (n.kind === 'doc') {
      docs.push({
        name,
        path: n.path,
        children: [],
        isDir: false,
        title: n.title,
        kind: 'doc',
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

  return root
}

/** 路径最后一段（文件名或目录名） */
const baseName = (p: string) => (p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p)

/** 所在目录（库内相对路径，库根 = 空串） */
const parentDir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

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

function Node({
  node,
  depth,
  activePath,
  selected,
  onPick,
  onContextMenu,
  onLongPress,
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
  /** 点一行：普通=单选并打开，Ctrl/⌘=切换该项，Shift=从锚点到该项的范围 */
  onPick: (path: string, mods: { toggle: boolean; range: boolean }) => void
  onContextMenu: (path: string, isDir: boolean, x: number, y: number) => void
  /** 触摸长按（Android 把长按转成 `contextmenu`，`pointerType === 'touch'`）—— 手机上进多选 */
  onLongPress: (path: string) => void
  renaming: Renaming | null
  draft: string
  setDraft: (v: string) => void
  onSubmitRename: () => void
  onCancelRename: () => void
}) {
  const [open, setOpen] = useState(true)
  const pad = { paddingLeft: `calc(var(--zn-space-2) + ${depth * 12}px)` }
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 进入内联编辑态时全选，直接敲新名字即可覆盖
  useEffect(() => {
    if (renaming?.path === node.path) inputRef.current?.select()
  }, [renaming, node.path])

  const editing = renaming?.path === node.path

  if (node.isDir) {
    return (
      <>
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
            className="zn-tree-item"
            style={pad}
            onClick={() => setOpen((v) => !v)}
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
            <span>{open ? '▾' : '▸'}</span>
            <span>{node.name}</span>
            {node.virtual && <span className="zn-ext">{node.children.length}</span>}
          </button>
        )}
        {open &&
          node.children.map((c) => (
            <Node
              key={c.path}
              node={c}
              depth={depth + 1}
              activePath={activePath}
              selected={selected}
              onPick={onPick}
              onContextMenu={onContextMenu}
              onLongPress={onLongPress}
              renaming={renaming}
              draft={draft}
              setDraft={setDraft}
              onSubmitRename={onSubmitRename}
              onCancelRename={onCancelRename}
            />
          ))}
      </>
    )
  }

  // 显示名优先用「笔记名」（frontmatter.title → 正文首行），没有才退回文件名。
  // 重命名态的输入框仍是**文件名**（它改的是磁盘上的名字，不是显示名）——
  // 所以下面 title 提示里始终带着真实路径，免得"名字怎么和文件对不上"。
  // 文档（pdf / epub / …）：Rust 侧给的 `title` 就是**带扩展名的文件名**
  // （文档没有 frontmatter / 首行标题那套语义），这里再挂一个类型徽章
  // —— 否则它在树里和笔记长得一模一样，用户分不清哪个能编辑。
  const isDoc = node.kind === 'doc'
  const docExt = isDoc ? node.name.slice(node.name.lastIndexOf('.') + 1).toLowerCase() : ''
  const label = node.title || node.name.replace(/\.(md|markdown)$/i, '')
  const active = node.path === activePath
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
    <button
      className={`zn-tree-item${active ? ' is-active' : ''}${picked ? ' is-picked' : ''}`}
      style={pad}
      onClick={(e) => onPick(node.path, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey })}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        /* 触摸长按 → 进多选（而不是弹菜单）。判据用 `pointerType`：鼠标右键是 `mouse`，
           安卓长按是 `touch`（2026-10-13 真机实测，见 HANDOFF rev67）。 */
        if ((e.nativeEvent as PointerEvent).pointerType === 'touch') {
          onLongPress(node.path)
          return
        }
        onContextMenu(node.path, false, e.clientX, e.clientY)
      }}
      title={`${node.path}（右键：重命名 / 删除；Ctrl 点选可多选）`}
    >
      <span>{label}</span>
      {isDoc && <span className="zn-ext">.{docExt}</span>}
    </button>
  )
}

export function FileTree({
  notes,
  dirs = [],
  activePath,
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
}: {
  notes: NoteMeta[]
  /** 目录清单（含空目录）—— 见 `buildTree` 的说明 */
  dirs?: string[]
  activePath: string | null
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
   * 「层出口」栈（App 持有）—— 多选 / 右键菜单这类**状态由本组件自持**的浮层，
   * 打开时把自己的关闭函数压进去，让 Android 返回键能先关掉它（见 App 的 `backRef`）。
   * 不传也能用 —— 返回键只在 Android 存在，桌面端不需要。
   */
  layers?: RefObject<Array<() => boolean>>
}) {
  const tree = useMemo(() => buildTree(notes, dirs), [notes, dirs])
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [renaming, setRenaming] = useState<Renaming | null>(null)
  const [draft, setDraft] = useState('')
  /** 多选：当前高亮的路径；空数组时退化为「只有打开的那篇被选中」 */
  const [selected, setSelected] = useState<string[]>([])
  /** Shift 范围选择的锚点 */
  const [anchor, setAnchor] = useState<string | null>(null)
  /**
   * **多选模式**（2026-10-13 加，给手机用）—— 触屏没有 Ctrl/Shift，多选入口等于没了；
   * 改成「长按一行进选择模式」：进入后点一行 = 加/减选（**不打开**笔记），
   * 树顶出现批量操作条（剪切 / 复制 / 删除 / 退出）。
   * 桌面不受影响：鼠标右键的 `pointerType` 是 `mouse`，仍走原来的右键菜单。
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

  /* 用「派生」而不是 effect 同步：外部（搜索面板、快速打开）打开别的笔记时，
     activePath 会变，这里直接把它当作唯一选中项，不必写 setState-in-effect。
     注意依赖必须是 selected / activePath 本身 —— 若在外面先算出 "effectiveSelected"
     数组再依赖它，那个数组每次渲染都是新的，memo 就白做了（lint 也会报）。 */
  const selectedSet = useMemo(() => {
    const eff = selected.length ? selected : activePath ? [activePath] : []
    return new Set(eff)
  }, [selected, activePath])

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

  const pick = (path: string, mods: { toggle: boolean; range: boolean }) => {
    // 多选模式（手机长按进的）：点一行 = 加/减选，**不打开**笔记 —— 否则一开编辑器
    // 就把抽屉收起来，多选根本做不下去。
    if (selectMode) {
      setSelected((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]))
      setAnchor(path)
      return
    }
    if (mods.range && anchor) {
      const a = flatPaths.indexOf(anchor)
      const b = flatPaths.indexOf(path)
      if (a >= 0 && b >= 0) {
        const lo = Math.min(a, b)
        const hi = Math.max(a, b)
        setSelected(flatPaths.slice(lo, hi + 1))
        return
      }
    }
    if (mods.toggle) {
      setSelected((prev) => {
        const base = prev.length ? prev : activePath ? [activePath] : []
        return base.includes(path) ? base.filter((p) => p !== path) : [...base, path]
      })
      setAnchor(path)
      return
    }
    // 普通点击：单选 + 打开
    setSelected([path])
    setAnchor(path)
    onOpen(path)
  }

  /** 手机长按一行 → 进多选并把该行选上（Android 把长按转成 `contextmenu`，见 HANDOFF rev67） */
  const enterSelect = (path: string) => {
    setMenu(null)
    setSelectMode(true)
    setSelected([path])
    setAnchor(path)
  }

  /** 退出多选（✕ / Android 返回键）—— 顺手清空选中，视觉上不留残影 */
  const exitSelect = () => {
    setSelectMode(false)
    setSelected([])
  }

  /* 多选 / 右键菜单都是「返回键该先关掉的一层」—— 打开时把关闭函数压进 App 的层出口栈。
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
        库里还没有 .md 文件（右键可新建）
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
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
    const picked = selected.length ? selected : activePath ? [activePath] : []
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
    onDeleteMany(paths)
    setSelected([])
    setMenu(null)
    // 删完就退出多选 —— 留着"已选 N 项"而 N 已经是 0，看着像没删掉（静默失效的样子）
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
          const picked = multi ? [...selectedSet] : [path]
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
        }
        return list
      })()
    : []

  return (
    <div
      className="zn-tree zn-filetree"
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        // 空白处右键 = 在**库根**新建（节点的右键已 stopPropagation，不会走到这里）
        e.preventDefault()
        setMenu({ path: null, dir: '', isDir: true, multi: false, x: e.clientX, y: e.clientY })
      }}
    >
      {/* 多选条（手机长按树项进入）—— 只在这一层出现，操作完自动退出 */}
      {selectMode && (
        <div className="zn-select-bar">
          <button
            type="button"
            className="zn-icon-btn"
            onClick={exitSelect}
            title="退出多选"
            aria-label="退出多选"
          >
            ✕
          </button>
          <span className="zn-select-count">已选 {selectedSet.size} 项</span>
          <span className="zn-select-actions">
            <button
              type="button"
              className="zn-plain-btn"
              onClick={() => {
                onCut([...selectedSet])
                exitSelect()
              }}
            >
              剪切
            </button>
            <button
              type="button"
              className="zn-plain-btn"
              onClick={() => {
                onCopy([...selectedSet])
                exitSelect()
              }}
            >
              复制
            </button>
            <button
              type="button"
              className="zn-plain-btn is-danger"
              onClick={() => deletePaths([...selectedSet])}
            >
              删除
            </button>
            <button
              type="button"
              className="zn-plain-btn is-danger"
              onClick={() => {
                // 手机没有右键 ⇒ 多选条是唯一的批量入口。
                // 不在这里清选中：让用户能在确认框里点「取消」而不丢选择。
                setPurgeConfirm({ paths: [...selectedSet], x: 24, y: 120 })
              }}
            >
              彻底删除
            </button>
          </span>
        </div>
      )}
      {tree.map((n) => (
        <Node
          key={n.path}
          node={n}
          depth={0}
          activePath={activePath}
          selected={selectedSet}
          onPick={pick}
          onLongPress={enterSelect}
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

      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}

      {/* 「彻底删除」的二次确认 —— 不进回收站、撤不回来，所以必须问一次（与「删除」是两回事） */}
      {purgeConfirm && (
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
            left: Math.max(8, Math.min(purgeConfirm.x, window.innerWidth - 300)),
            top: Math.max(8, Math.min(purgeConfirm.y, window.innerHeight - 160)),
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
        </div>
      )}
    </div>
  )
}
