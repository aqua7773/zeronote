import { useEffect, useMemo, useRef, useState } from 'react'
import type { NoteMeta } from '../kernel/contract'
import { ContextMenu, type MenuItem } from '@/components/ui'

type TreeNode = { name: string; path: string; children: TreeNode[]; isDir: boolean }

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
        level.push({ name: part, path: acc, children: [], isDir: false })
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
  onOpen,
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
  onOpen: (path: string) => void
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
              onOpen={onOpen}
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

  const label = node.name.replace(/\.(md|markdown)$/i, '')
  const active = node.path === activePath

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
      className={`zn-tree-item${active ? ' is-active' : ''}`}
      style={pad}
      onClick={() => onOpen(node.path)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu(node.path, e.clientX, e.clientY)
      }}
      title={`${node.path}（右键：重命名 / 删除）`}
    >
      <span>{label}</span>
    </button>
  )
}

export function FileTree({
  notes,
  activePath,
  onOpen,
  onRename,
  onDelete,
}: {
  notes: NoteMeta[]
  activePath: string | null
  onOpen: (path: string) => void
  onRename: (from: string, to: string) => void
  onDelete: (path: string) => void
}) {
  const tree = useMemo(() => buildTree(notes), [notes])
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

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
  const items: MenuItem[] = menu
    ? [
        { label: '重命名', onClick: () => startRename(menu.path) },
        {
          label: '删除',
          danger: true,
          onClick: () => {
            onDelete(menu.path)
            setMenu(null)
          },
        },
      ]
    : []

  return (
    <div className="zn-tree">
      {tree.map((n) => (
        <Node
          key={n.path}
          node={n}
          depth={0}
          activePath={activePath}
          onOpen={onOpen}
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
