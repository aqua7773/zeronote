import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
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
}

/**
 * 目录树 = **目录清单**（`dirs`，含空目录）＋ 笔记清单（`notes`）。
 *
 * 目录清单是必需的：只靠笔记路径只能**反推**出"装过文件的"目录，**空文件夹反推不出来**
 * —— 那样"新建文件夹"会像没反应（静默失效）。所以 Rust 侧单给了 `list_dirs`。
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
      let dir = level.find((x) => x.isDir && x.name === part)
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

  for (const n of notes) {
    const parts = n.path.split('/')
    const name = parts[parts.length - 1]
    const parentPath = parts.slice(0, -1).join('/')
    const parent = ensureDir(parentPath)
    const bucket = parent ? parent.children : root
    bucket.push({
      name,
      path: parentPath ? `${parentPath}/${name}` : name,
      children: [],
      isDir: false,
      title: n.title,
    })
  }

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) =>
      a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh') : a.isDir ? -1 : 1,
    )
    nodes.forEach((n) => sort(n.children))
  }
  sort(root)
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
              onContextMenu(node.path, true, e.clientX, e.clientY)
            }}
            title={`${node.path}（右键：新建 / 重命名 / 删除）`}
          >
            <span>{open ? '▾' : '▸'}</span>
            <span>{node.name}</span>
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
        onContextMenu(node.path, false, e.clientX, e.clientY)
      }}
      title={`${node.path}（右键：重命名 / 删除；Ctrl 点选可多选）`}
    >
      <span>{label}</span>
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
  /** 应用级剪贴板（null = 空）：菜单据此决定「粘贴」这一项在不在 */
  clipboard: { mode: 'cut' | 'copy'; paths: string[] } | null
  onCut: (paths: string[]) => void
  onCopy: (paths: string[]) => void
  /** 粘贴到 `dir`（`''` = 库根） */
  onPaste: (dir: string) => void
  /** 创建副本（同目录 + 「 副本」；文件与目录都支持） */
  onDuplicate: (path: string) => void
}) {
  const tree = useMemo(() => buildTree(notes, dirs), [notes, dirs])
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [renaming, setRenaming] = useState<Renaming | null>(null)
  const [draft, setDraft] = useState('')
  /** 多选：当前高亮的路径；空数组时退化为「只有打开的那篇被选中」 */
  const [selected, setSelected] = useState<string[]>([])
  /** Shift 范围选择的锚点 */
  const [anchor, setAnchor] = useState<string | null>(null)

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
    const next = /\.(md|markdown)$/i.test(joined) ? joined : `${joined}.md`
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
      {tree.map((n) => (
        <Node
          key={n.path}
          node={n}
          depth={0}
          activePath={activePath}
          selected={selectedSet}
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

      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  )
}
