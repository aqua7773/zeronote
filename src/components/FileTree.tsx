import { useEffect, useMemo, useRef, useState } from 'react'
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

function buildTree(notes: NoteMeta[]): TreeNode[] {
  const root: TreeNode[] = []
  for (const n of notes) {
    const parts = n.path.split('/')
    let level = root
    let acc = ''
    parts.forEach((part, i) => {
      acc = acc ? `${acc}/${part}` : part
      const isFile = i === parts.length - 1
      if (isFile) {
        level.push({ name: part, path: acc, children: [], isDir: false, title: n.title })
      } else {
        let dir = level.find((x) => x.isDir && x.name === part)
        if (!dir) {
          dir = { name: part, path: acc, children: [], isDir: true }
          level.push(dir)
        }
        level = dir.children
      }
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

/** 右键菜单的状态。`confirmDelete` = 已经在原位置切成「确认删除」 */
type MenuState = { path: string; x: number; y: number }

function Node({
  node,
  depth,
  activePath,
  selected,
  onPick,
  onContextMenu,
  renamingPath,
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
  onContextMenu: (path: string, x: number, y: number) => void
  renamingPath: string | null
  draft: string
  setDraft: (v: string) => void
  onSubmitRename: () => void
  onCancelRename: () => void
}) {
  const [open, setOpen] = useState(true)
  const pad = { paddingLeft: `calc(var(--zn-space-2) + ${depth * 12}px)` }
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 进入重命名态时全选，直接敲新名字即可覆盖
  useEffect(() => {
    if (renamingPath === node.path) inputRef.current?.select()
  }, [renamingPath, node.path])

  if (node.isDir) {
    return (
      <>
        <button className="zn-tree-item" style={pad} onClick={() => setOpen((v) => !v)}>
          <span>{open ? '▾' : '▸'}</span>
          <span>{node.name}</span>
        </button>
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
              renamingPath={renamingPath}
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

  if (renamingPath === node.path) {
    return (
      <input
        ref={inputRef}
        style={pad}
        value={draft}
        aria-label="重命名笔记"
        className="w-full min-w-0 rounded-ui-sm border border-primary bg-background px-1.5 py-0.5 text-xs text-foreground outline-none"
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
        onContextMenu(node.path, e.clientX, e.clientY)
      }}
      title={`${node.path}（右键：重命名 / 删除；Ctrl 点选可多选）`}
    >
      <span>{label}</span>
    </button>
  )
}

export function FileTree({
  notes,
  activePath,
  onOpen,
  onDeleteMany,
  onRename,
}: {
  notes: NoteMeta[]
  activePath: string | null
  onOpen: (path: string) => void
  /** 删除（单条也走这条，传长度 1 的数组）—— 多选时一次删多篇 */
  onDeleteMany: (paths: string[]) => void
  onRename: (from: string, to: string) => void
}) {
  const tree = useMemo(() => buildTree(notes), [notes])
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
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

  const startRename = (path: string) => {
    setDraft(baseName(path))
    setRenamingPath(path)
    setMenu(null)
  }

  const cancelRename = () => setRenamingPath(null)

  /**
   * 提交重命名。规则：
   *  · 只写文件名 = 同目录改名；写 `子目录/名.md` = 连目录一起（Rust 侧会自动建父目录）
   *  · 不带后缀自动补 `.md`
   *  · `..`、绝对路径、Windows 非法字符一律交给 Rust 的路径校验拒绝，错误原样显示
   */
  const submitRename = () => {
    const from = renamingPath
    setRenamingPath(null)
    if (!from) return
    const raw = draft.trim()
    if (!raw) return
    const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : ''
    let next = raw.includes('/') ? raw : dir + raw
    if (!/\.(md|markdown)$/i.test(next)) next += '.md'
    if (next === from) return
    onRename(from, next)
  }

  if (!notes.length) {
    return (
      <div className="zn-tree" style={{ color: 'var(--zn-fg-subtle)', fontSize: 'var(--zn-text-sm)' }}>
        库里还没有 .md 文件
      </div>
    )
  }

  // 删除是「一步完成 + 可撤销」—— 依据 Apple HIG：常见且可撤销的破坏操作不该弹确认，
  // 只有不可逆的才必须确认。可撤销性由 App 的撤销条提供（几秒内能把文件搬回来）。
  const deletePaths = (paths: string[]) => {
    onDeleteMany(paths)
    setSelected([])
    setMenu(null)
  }

  const items: MenuItem[] = menu
    ? (() => {
        const multi = selectedSet.size > 1 && selectedSet.has(menu.path)
        const list: MenuItem[] = []
        if (!multi) {
          list.push({ label: '重命名', onClick: () => startRename(menu.path) })
        }
        list.push({
          label: multi ? `删除选中的 ${selectedSet.size} 篇` : '删除',
          danger: true,
          onClick: () => deletePaths(multi ? [...selectedSet] : [menu.path]),
        })
        // 右键的是选中项之外的一条时，额外给一个「删除选中的 N 篇」入口
        if (!multi && selectedSet.size > 1) {
          list.push({
            label: `删除选中的 ${selectedSet.size} 篇`,
            danger: true,
            divider: true,
            onClick: () => deletePaths([...selectedSet]),
          })
        }
        return list
      })()
    : []

  return (
    <div className="zn-tree">
      {tree.map((n) => (
        <Node
          key={n.path}
          node={n}
          depth={0}
          activePath={activePath}
          selected={selectedSet}
          onPick={pick}
          onContextMenu={(path, x, y) => setMenu({ path, x, y })}
          renamingPath={renamingPath}
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
