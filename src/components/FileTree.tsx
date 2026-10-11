import { useMemo, useState } from 'react'
import type { NoteMeta } from '../kernel/contract'

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

function Node({
  node,
  depth,
  activePath,
  onOpen,
}: {
  node: TreeNode
  depth: number
  activePath: string | null
  onOpen: (path: string) => void
}) {
  const [open, setOpen] = useState(true)
  const pad = { paddingLeft: `calc(var(--zn-space-2) + ${depth * 12}px)` }

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
            />
          ))}
      </>
    )
  }

  const label = node.name.replace(/\.(md|markdown)$/i, '')
  const active = node.path === activePath
  return (
    <button
      className={`zn-tree-item${active ? ' is-active' : ''}`}
      style={pad}
      onClick={() => onOpen(node.path)}
      title={node.path}
    >
      <span>{label}</span>
    </button>
  )
}

export function FileTree({
  notes,
  activePath,
  onOpen,
}: {
  notes: NoteMeta[]
  activePath: string | null
  onOpen: (path: string) => void
}) {
  const tree = useMemo(() => buildTree(notes), [notes])

  if (!notes.length) {
    return (
      <div className="zn-tree" style={{ color: 'var(--zn-fg-subtle)', fontSize: 'var(--zn-text-sm)' }}>
        库里还没有 .md 文件
      </div>
    )
  }

  return (
    <div className="zn-tree">
      {tree.map((n) => (
        <Node key={n.path} node={n} depth={0} activePath={activePath} onOpen={onOpen} />
      ))}
    </div>
  )
}
