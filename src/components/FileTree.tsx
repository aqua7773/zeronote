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
import { LONG_PRESS_MS, hapticTick, spawnRipple } from '../lib/long-press-feedback'
import { bootMark } from '../lib/boot-marks'
import {
  GROUP_NODE_PREFIX,
  baseName,
  dropTargetPath,
  parentDir,
  parseDropTarget,
  planTreeDrop,
  resolveTreeDrop,
} from '../lib/tree-drop'

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
  kind?: 'note' | 'doc' | 'image' | 'media' | 'file'
  /**
   * **虚拟分组节点**（2026-10-13 加）—— 不对应磁盘上的真实目录。
   * rev173.385：文档 / 附件不再虚拟聚合，一律按真实目录显示；
   * 虚拟分组只留给额外笔记源（私密笔记，`GROUP_NODE_PREFIX`）。
   */
  virtual?: boolean
  /**
   * 额外笔记源的分组 key（rev173.376）—— 普通目录 / 文档 / 附件都没有这个字段。
   * 用于**禁止对分组条目做磁盘操作**（重命名 / 删除 / 拖拽），它们是插件拥有的条目。
   */
  group?: string
  /** 显示名覆盖（rev173.376）：私密条目的磁盘名是随机 id（`x8f3.zn`），必须显示标题 */
  label?: string
  /** 分组图标（emoji；只有虚拟分组节点有） */
  icon?: string
}

/**
 * 额外笔记源分组的哨兵前缀（rev173.376 · 私密笔记改造 §4.2）。
 * 定义已收进 `src/lib/tree-drop.ts`（拖拽落点判定也要用同一份，rev173.400）。
 */

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
 * **只读文档 / 图片 / 音视频一律按真实目录显示**（rev173.385 用户要求）：
 * 之前它们被聚到虚拟的「文档」「附件」分组，导致文件树和磁盘结构对不上；
 * 现在取消这两个虚拟分组，附件落点是 `附件/图片|视频|音频|文档|其它/`，
 * 在树里就是普通目录，能展开、能右键、能拖拽。
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

  /**
   * 额外笔记源的分组桶（rev173.376 · 私密笔记改造 §4.2）。
   * key 是源给的分组 key；Map 的插入顺序 = 条目第一次出现的顺序（宿主按注册顺序合并）。
   */
  const groups = new Map<string, { label: string; icon?: string; nodes: TreeNode[] }>()

  for (const n of notes) {
    const parts = n.path.split('/')
    const name = parts[parts.length - 1]
    /**
     * 额外笔记源（私密笔记）：**不进目录层级**，收进自己的虚拟分组。
     * 显示名用标题 —— 磁盘名是随机 id（`k3f8a.zn`），对用户没有意义。
     */
    if (n.group) {
      const g = groups.get(n.group) ?? {
        label: n.groupLabel ?? n.group,
        icon: n.groupIcon,
        nodes: [],
      }
      g.nodes.push({
        name,
        label: n.title || name,
        path: n.path,
        children: [],
        isDir: false,
        title: n.title,
        kind: n.kind,
        group: n.group,
      })
      groups.set(n.group, g)
      continue
    }
    // 文档 / 图片 / 音视频与普通笔记一样，进它们**真实所在的目录**（rev173.385）；
    // 不再收进虚拟分组 —— 文件树必须等于磁盘结构，否则用户找不到自己放的图。
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

  /**
   * 额外笔记源分组（rev173.376 · 私密笔记）：排在**最后** —— 它随开关出现 / 消失，
   * 放在树尾不会推动用户在其它笔记上的肌肉记忆。源返回空数组 ⇒ 这里根本不建节点。
   */
  for (const [key, g] of groups) {
    if (!g.nodes.length) continue
    g.nodes.sort((a, b) => (a.label ?? a.name).localeCompare(b.label ?? b.name, 'zh'))
    root.push({
      name: g.label,
      path: `${GROUP_NODE_PREFIX}${key}`,
      children: g.nodes,
      isDir: true,
      virtual: true,
      group: key,
      icon: g.icon,
    })
  }

  return root
}

/** 路径工具 `baseName` / `parentDir` 已收进 `src/lib/tree-drop.ts`（rev173.400，拖拽判定共用） */

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
 * 内核的 `NoteMeta.kind` 有 note / doc / image / media / file 五档，但插件不需要
 * （也不该）认识这些细节：导出、分享这类动作只关心「这是笔记 / 文件夹 / 其它附件」。
 */
function itemKindOf(meta: NoteMeta | undefined, isDir: boolean): ItemMenuKind {
  if (isDir) return 'dir'
  return (meta?.kind ?? 'note') === 'note' ? 'note' : 'attachment'
}

/**
 * 触摸设备（Android）—— 菜单**不在长按瞬间弹**，等手指抬起再弹（rev173.321 · 用户 2026-11-02：
 * 「移动端菜单改成长按时不弹，在长按释放的时候弹菜单」）。
 *
 * 为什么：Android 长按 ~500ms 会派发 `contextmenu`，菜单是全屏遮罩式的，一弹出来就把
 * 还没结束的触摸序列遮住了 —— 想"按住拖"的人只要慢半拍，后半个手势就变成在遮罩上拖。
 * 改成松手再弹之后：按住期间界面干净，移动即拖拽，抬起不动才出菜单。
 */
const TOUCH_UI = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)

/** 长按判定：按住这么久再松手 = 弹菜单（2026-11-02 用户：500 → **300ms**，统一值见 `LONG_PRESS_MS`） */
const MENU_LONG_PRESS_MS = LONG_PRESS_MS

/** 多选态的勾选框（纯视觉；点击由整行承担，避免按钮套按钮） */
function CheckBox({ on }: { on: boolean }) {
  return (
    <span className={`zn-check${on ? ' is-on' : ''}`} aria-hidden="true">
      {on ? '✓' : ''}
    </span>
  )
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
  onRenameSource,
  selectMode,
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
  /** 点一行：普通=单选并打开，Ctrl/⌘=切换该项，Shift=从锚点到该项的范围 */
  onPick: (path: string, isDir: boolean, mods: { toggle: boolean; range: boolean }) => void
  onContextMenu: (path: string, isDir: boolean, x: number, y: number) => void
  /** 源条目改名（rev173.398）：右键条目就直接弹输入框，不走磁盘菜单 */
  onRenameSource?: (path: string) => void
  /** 多选态：行首画勾选框，点行 = 勾选 / 取消（不打开、不折叠） */
  selectMode: boolean
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
            data-zn-dir="1"
            data-zn-virtual={node.virtual ? '1' : undefined}
            data-zn-group={node.group ? '1' : undefined}
            /* 多选态：点目录 = 勾选它（连带里面全部条目），不再折叠 */
            onClick={() =>
              selectMode
                ? onPick(node.path, true, { toggle: false, range: false })
                : onToggleOpen(node.path)
            }
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              // 虚拟分组**不对应磁盘目录** ⇒ 不给任何文件操作菜单（它只是视图聚合）
              if (node.virtual) return
              // 手机：长按**不立刻**弹菜单，等松手（触摸通道里判，见 TOUCH_UI）
              if (TOUCH_UI) return
              onContextMenu(node.path, true, e.clientX, e.clientY)
            }}
            title={
              node.group
                ? `${node.name}（插件维护的分组 —— 随开关出现 / 消失）`
                : node.virtual
                  ? '插件维护的分组（不对应磁盘目录）'
                  : `${node.path}（右键：新建 / 重命名 / 删除）`
            }
          >
            {selectMode ? (
              <CheckBox on={selected.has(node.path)} />
            ) : (
              <span className="zn-tree-caret">{open ? '▾' : '▸'}</span>
            )}
            <span className="zn-tree-label">
              {node.icon ? `${node.icon} ${node.name}` : node.name}
            </span>
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
                onRenameSource={onRenameSource}
                selectMode={selectMode}
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
  /** rev173.386：其它普通文件（zip / ini / toml …）—— 同样挂扩展名徽章 */
  const isFile = node.kind === 'file'
  const hasKindBadge = isDoc || isImage || isMedia || isFile
  const ext = hasKindBadge
    ? node.name.slice(node.name.lastIndexOf('.') + 1).toLowerCase()
    : ''
  /**
   * 显示名（2026-10-17 用户定「文件显示 .md」）：
   *  · 笔记 —— 直接显示**磁盘文件名**（含 `.md`），一眼看出是 Markdown；
   *  · 只读文档（pdf/epub/…）/ 图片 / 音视频 / 其它文件 —— 去掉扩展名：它后面已经跟着
   *    `.pdf` / `.png` / `.mp4` 徽章了，再带一次会变成 `测试书籍.epub .epub`。
   */
  const label = node.label ?? (hasKindBadge ? node.name.replace(/\.[a-z0-9]+$/i, '') : node.name)
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
        data-zn-group={node.group ? '1' : undefined}
        /* 源分组 key（rev173.400）：拖出时要靠它把动作路由给对应插件命令 */
        data-zn-group-key={node.group}
        onClick={(e) =>
          /**
           * 额外笔记源条目（rev173.376）：**强制单选 + 打开**。
           * 不能让 Ctrl/Shift 把它拉进多选集合 —— 后面的批量删除 / 移动走的是公开笔记那套
           * 磁盘操作，对插件拥有的条目完全不适用（误删一篇私密笔记进全局回收站）。
           */
          onPick(
            node.path,
            false,
            node.group ? { toggle: false, range: false } : { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey },
          )
        }
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        // 额外笔记源条目（rev173.398）：磁盘操作仍归插件，但「改名」交给宿主弹输入框 ——
        // 源实现了 `rename` 才有这个入口（`onRenameSource` 由宿主按能力传入）
        if (node.group) {
          if (onRenameSource) onRenameSource(node.path)
          return
        }
        // 手机长按（Android 把长按转成 contextmenu）与电脑右键**同一个菜单**（2026-10-18 用户要求）。
        // rev173.321：手机改成**松手才弹**（长按那一刻弹会把正在进行的拖拽遮住）。
        if (TOUCH_UI) return
        onContextMenu(node.path, false, e.clientX, e.clientY)
      }}
      title={
        node.group
          ? `${node.title ?? node.name}（插件维护的条目）`
          : `${node.path}（右键：重命名 / 删除；Ctrl 点选可多选）`
      }
    >
      {/* 圆点：与目录行的三角同宽同高，垂直居中 —— 让文件行也有"项目符号"，
          且名字与同级文件夹名对齐（用户 2026-10-17：「笔记前面加圆点，大小与三角一致」）。
          多选态换成勾选框（rev173.318）。 */}
      {selectMode ? (
        <CheckBox on={selected.has(node.path)} />
      ) : (
        <span className="zn-tree-caret zn-tree-dot" aria-hidden="true">
          ●
        </span>
      )}
      <span className="zn-tree-label">{label}</span>
      {hasKindBadge && <span className="zn-ext">.{ext}</span>}
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
  onRenameSource,
  onDropToSource,
  onDropFromSource,
  onDeleteMany,
  onPurgeMany,
  layers,
  onOpenTimeline,
  itemActions = [],
  onItemAction,
  onShowInfo,
  onReveal,
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
  /**
   * 源条目（私密笔记）改名（rev173.398）：右键条目 → 宿主弹输入框 → 交回新标题。
   * 不传 ⇒ 源条目右键仍然没有菜单（只有插件自己负责改名 UI）。
   */
  onRenameSource?: (path: string) => void
  /**
   * 拖**公开笔记**到额外源分组行（rev173.400 · 私密笔记：移入）。
   * 宿主转给插件（`private.move-in`）；不传 ⇒ 分组行不是落点。
   */
  onDropToSource?: (group: string, paths: string[]) => void
  /**
   * 把额外源分组的条目**拖出**到公开目录（rev173.400 · 私密笔记：移出）。
   * `group` = 源分组 key；`dir` = `''` 表示库根。不传 ⇒ 源条目不能拖动。
   */
  onDropFromSource?: (group: string, paths: string[], dir: string) => void
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
  /**
   * 「详细…」—— 弹条目的元信息（大小 / 创建 / 修改 / 路径）。
   * rev173.325 · 真人测试6 #4：用户要求文件右键菜单能看详细属性。不传 ⇒ 菜单里不出现。
   */
  onShowInfo?: (path: string, isDir: boolean) => void
  /**
   * 「在文件夹中打开」—— 交给系统文件管理器定位该条目（rev173.325 · 真人测试6 #4）。
   * 桌面由 App 走原生命令；手机端调用方如实提示不支持。不传 ⇒ 菜单里不出现。
   */
  onReveal?: (path: string) => void
}) {
  const tree = useMemo(() => buildTree(notes, dirs), [notes, dirs])
  /**
   * 启动打点（rev173.356）：文件树挂载完成 = 「首屏列表真正画出来」的时刻。
   * 与 `vault-refresh-*` 配合能区分「等列表 → 构建树 → React 渲染」三段各花多久。
   */
  useEffect(() => {
    bootMark('tree-mounted')
  }, [])
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
  /** ghost 的 DOM 节点 —— 触摸拖拽时直接改 `style.left/top`，避免每帧重渲染整棵树（rev173.331 · 真人测试7 #3） */
  const ghostRef = useRef<HTMLDivElement | null>(null)
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
  /**
   * 树容器的元素本身（rev173.331 修：真机上 `rootRef.current` 在触摸 effect 里是 `null`）。
   *
   * 为什么不能只用 `rootRef` + `useEffect(…, [])`：effect 只在**挂载后**跑一次，若跑的那一帧
   * 还没有 `.zn-tree`（手机冷启动时 App 先渲染一版没有树的布局），`root` 就是 null，
   * 而依赖是 `[]` ⇒ **永远不会重跑**，于是 touchstart 监听器一次都没绑上：
   * 文件树长按不出涟漪、拖拽不动、菜单也不弹（真人测试7 追加反馈）。
   * 修法：callback ref 把「元素出现 / 消失」变成 state，effect 依赖它 ⇒ 元素一挂上就绑。
   */
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null)
  const bindRoot = useCallback((el: HTMLDivElement | null) => {
    rootRef.current = el
    setRootEl(el)
  }, [])
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
     数组再依赖它，那个数组每次渲染都是新的，memo 就白做了（lint 也会报）。

     ⚠️ **多选态不回退**（rev173.318）：多选时勾选集合就是用户真正勾的那些，
     空集合就是"一个都没勾"。回退到 activePath 会让人看到"打开的那篇还亮着却没勾"。 */
  const selectedSet = useMemo(() => {
    const eff = selectMode
      ? selected
      : selected.length
        ? selected
        : !selectionCleared && activePath
          ? [activePath]
          : []
    return new Set(eff)
  }, [selected, activePath, selectionCleared, selectMode])

  /* 换了笔记（外部打开 / 搜索跳转）⇒ 恢复"回退到 activePath"的行为 */
  useEffect(() => {
    setSelectionCleared(false)
  }, [activePath])

  /**
   * 所有**真实目录**的路径集合 —— 拖拽移动只认文件夹做落点。
   * 虚拟分组（私密笔记）不在这里（它只是视图聚合，不是磁盘目录）。
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
   * **目录 → 它的全部子孙**（含子目录与文件）—— 多选时"勾文件夹 = 勾里面的东西"要用。
   * 虚拟分组（私密笔记）也在内：用户眼里它就是一组条目。
   */
  const descendantsMap = useMemo(() => {
    const map = new Map<string, string[]>()
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (!n.isDir) continue
        const all: string[] = []
        const collect = (kids: TreeNode[]) => {
          for (const c of kids) {
            all.push(c.path)
            if (c.isDir) collect(c.children)
          }
        }
        collect(n.children)
        map.set(n.path, all)
        walk(n.children)
      }
    }
    walk(tree)
    return map
  }, [tree])

  /**
   * **多选：切换一项的勾选**（rev173.318 · 用户 2026-11-01 定的规则）。
   *
   * 用户原话：「进入多选时，在每条笔记/文件夹前加一个勾选框，勾选文件夹时一并勾选其中的文件」，
   * 以及「取消一个，文件夹就变成未勾选，其余文件依旧被选中」。
   *
   * 所以三条规则：
   *  ① 勾一项 ⇒ 勾上自己；**目录**还把自己全部子孙一起勾上；
   *  ② 取消一项 ⇒ 取消自己与自己的全部子孙；
   *  ③ 取消任何一项时，**它的祖先目录也一并取消** —— 否则会出现"目录勾着、里面却没全勾"
   *     这种自相矛盾的状态（用户要的是"文件夹变回未勾选"）。
   * 反过来：逐个勾子项**不会**自动把父目录勾上（父目录只有"被直接勾"才进集合）。
   */
  const toggleSelect = (path: string, isDir: boolean) => {
    setSelectionCleared(false)
    setSelected((prev) => {
      const set = new Set(prev)
      if (set.has(path)) {
        for (const p of [...set]) {
          if (p === path || p.startsWith(`${path}/`)) set.delete(p)
          else if (path.startsWith(`${p}/`)) set.delete(p) // 祖先不再"全选"
        }
      } else {
        set.add(path)
        if (isDir) for (const d of descendantsMap.get(path) ?? []) set.add(d)
      }
      return [...set]
    })
    setAnchor(path)
  }

  /** 「移入…」子菜单的坐标（null = 没开） */
  const [moveMenu, setMoveMenu] = useState<{ x: number; y: number } | null>(null)

  /** 批量「移入…」的目标目录：库根 + 所有真实目录 */
  const moveTargets = useMemo(() => {
    const all = ['', ...dirs].filter((d, i, arr) => arr.indexOf(d) === i)
    return all.sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'zh')))
  }, [dirs])

  /** 把当前勾选的条目整体搬进 `target`（`''` = 库根），搬完退出多选 */
  const moveSelectedTo = (target: string) => {
    const paths = dedupe([...selectedSet])
    for (const p of paths) {
      // 不能把它们搬进自己或自己的子目录（Rust 侧也会拒，这里先挡掉免得弹错）
      if (target === p || (target && target.startsWith(`${p}/`))) continue
      if (parentDir(p) === target) continue // 已在目标目录里
      onRename(p, target ? `${target}/${baseName(p)}` : baseName(p), dirPathSet.has(p))
    }
    setMoveMenu(null)
    setSelected([])
    setSelectionCleared(true)
    setSelectMode(false)
  }

  const pick = (path: string, isDir: boolean, mods: { toggle: boolean; range: boolean }) => {
    // 点选模式（右键菜单「多选」进的）：点一行 = 勾选/取消，**不打开**笔记 ——
    // 否则一开编辑器就把抽屉收起来，多选根本做不下去。
    // ⚠️ 不自动弹菜单（rev173.317）：菜单的遮罩会把列表盖住，多选没法连续点。
    if (selectMode) {
      toggleSelect(path, isDir)
      return
    }
    // 用户点了某一行 ⇒ 主动清空的态结束（重新有选中）
    setSelectionCleared(false)
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
      const base = selected.length ? selected : activePath ? [activePath] : []
      const next = base.includes(path) ? base.filter((p) => p !== path) : [...base, path]
      setSelected(next)
      setAnchor(path)
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
   *  · 鼠标：只认左键；位移超过 4px 才算拖拽，否则仍是普通点击；
   *  · **触摸**走另一条通道（`useEffect` 里的 touch 监听，见下）—— 手指拖拽要先按住
   *    150ms 再动，普通滚动不会被误判成拖拽（rev173.317 · 真人测试5 #5）；
   *  · 点在**滚动条**上不算；
   *  · 拖拽移动只认**文件夹**做落点（虚拟分组不是目录），且拒绝拖进自己/自己的子孙；
   *  · 拖的若是选中集合里的一项 ⇒ **整批移动**；否则只移动它自己；
   *  · 拖完拦掉那次 click，否则一松手就把最后经过的笔记打开了。
   *
   * 为什么监听 window 而不是容器的 `onPointerMove`：拖出侧栏时容器收不到事件，
   * 框/拖都会卡住；挂到 window 上，松手在哪儿都能结束。
   */
  /**
   * **拖拽落点判定**（rev173.319 · 用户 2026-11-01）：
   *  · 落在**目录行**上 ⇒ 那个目录；
   *  · 落在**文件树栏内的空白** ⇒ 库根（返回 `''`）；
   *  · 落在**栏外** / 文件行 / 自己或自己的子目录上 ⇒ `null` = **不做动作**。
   *
   * 用户原话：「拖到文件树栏空白处，就放根目录，拖出文件树栏外不做动作」。
   */
  const resolveDropTarget = (x: number, y: number, fromPath: string): string | null => {
    const root = rootRef.current
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    if (!root || !el) return null
    // 拖出文件树栏外 ⇒ 不动作（松手就是取消）
    if (!root.contains(el)) return null
    const row = el.closest<HTMLElement>('[data-zn-path]')
    // 判定规则收在 `lib/tree-drop.ts`：鼠标与触摸两条拖拽链共用（rev173.400）
    const target = resolveTreeDrop({
      over: row?.dataset.znPath ?? null,
      overVirtual: row?.dataset.znVirtual === '1',
      overSourceEntry: row?.dataset.znGroup === '1',
      fromPath,
      dirs: dirPathSet,
    })
    return dropTargetPath(target)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.pointerType && e.pointerType !== 'mouse')) return
    const root = rootRef.current
    if (!root) return
    // 点在滚动条上 → 放行（垂直滚动条占容器右侧那几像素）
    const box0 = root.getBoundingClientRect()
    if (root.offsetWidth - root.clientWidth > 0 && e.clientX > box0.left + root.clientWidth) return

    const start = { x: e.clientX, y: e.clientY }
    /** 按下点落在哪个条目上（null = 空白 ⇒ 框选模式） */
    const hitEl = (e.target as HTMLElement).closest<HTMLElement>('[data-zn-path]') ?? null
    /**
     * 额外笔记源条目（rev173.400）：**可以拖**，但只走「移出到公开目录」这一条
     * （`planTreeDrop` 会把它记成 `out-of-source`，不会调磁盘 `rename` ——
     * 直接 rename 会把密文搬进公开目录，rev173.376 刻意禁掉的正是这条）。
     */
    const fromSource = hitEl?.dataset.znGroup === '1'
    /** 源分组 key（rev173.400）：拖出时用它选命令 */
    const sourceGroup = hitEl?.dataset.znGroupKey ?? undefined
    // 虚拟分组行自身不参与拖动（它没有磁盘路径；拖动只会让 planTreeDrop 拼出无效 rename）
    if (hitEl?.dataset.znVirtual === '1') return
    const fromPath = hitEl?.dataset.znPath ?? null
    let dragging = false
    /** 拖拽移动的落点（只在 fromPath 非空时有意义） */
    let target: string | null = null

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
        setMarquee(box)
        setSelected(hitTest(root, box))
        // 框选**不进点选模式**：框选完用右键菜单 / 顶部批量栏操作这批选中项
        setSelectMode(false)
        return
      }

      // ── 拖拽移动：目录行 = 进那个目录；栏内空白 = 库根；栏外 = 不动作 ──
      // 落点值没变就不 setState（rev173.331）：鼠标拖拽时也少掉一半无效重渲染
      const next = resolveDropTarget(ev.clientX, ev.clientY, fromPath)
      if (next !== target) {
        target = next
        setDropTarget(next)
      }
      // 拖拽视觉：源行淡出 + 跟手的小标签（用户 2026-10-17：「拖拽要有动画效果」）
      setDraggingPath(fromPath)
      const count = selectedSet.has(fromPath) && selectedSet.size > 1 ? selectedSet.size : 1
      setDragGhost({
        x: ev.clientX,
        y: ev.clientY,
        label: count > 1 ? `${baseName(fromPath)} 等 ${count} 项` : baseName(fromPath),
      })
    }

    const up = () => {
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

      // 框选松手：只保留选中集合（批量操作走右键菜单）
      if (!fromPath) return

      // `''` = 库根，是有效落点；只有 `null` 才是不动作
      if (target === null) return
      // 拖的项在选中集合里 ⇒ 整批搬；否则只手拖那一项（源条目恒为单条）
      const paths = fromSource
        ? [fromPath]
        : selectedSet.has(fromPath) && selectedSet.size > 1
          ? dedupe([...selectedSet])
          : [fromPath]
      const plan = planTreeDrop({
        fromSource,
        sourceGroup,
        paths,
        target: parseDropTarget(target),
        dirs: dirPathSet,
      })
      if (!plan) return
      if (plan.kind === 'into-source') onDropToSource?.(plan.group, plan.paths)
      else if (plan.kind === 'out-of-source') onDropFromSource?.(plan.group, plan.paths, plan.dir)
      else for (const en of plan.entries) onRename(en.from, en.to, en.isDir)
      setSelected([])
      setSelectionCleared(true)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /**
   * **触摸拖拽**（rev173.317 · 真人测试5 #5「移动端选中文件不能拖入文件夹归类」）。
   *
   * 为什么不用上面的 pointerdown：手指拖拽在列表里默认是"滚动"，直接开始拖拽会把
   * 每次滚动都变成搬文件。而**长按 500ms** 已经被系统的右键菜单占了（Android 的
   * `contextmenu`）—— 两边抢同一个手势。
   *
   * 取中间这条路：**按住 150ms（`ARM_MS`，必须远小于长按阈值）后开始移动 ⇒ 拖拽**；
   *   · 150ms 内就移动 ⇒ 用户在滚动列表，立刻放弃（不做任何事，滚动手感不变）；
   *   · 按住不动到 300ms ⇒ 弹我们自己的条目菜单（`LONG_PRESS_MS`）；
   *   · 拖拽期间 `touchmove` 一律 preventDefault，列表不会跟着滚。
   *
   * ⚠️ effect **只挂一次**：拖拽过程里每帧都在 setState（ghost 跟手），若依赖里有
   * 会变的回调（`onRename` 常常是内联箭头），effect 会每帧卸载重挂 = 拖拽被自己 reset 掉。
   * 所以最新值走 ref，监听器生命周期与渲染无关。
   */
  const dragRefs = useRef({ selectedSet, dirPathSet, onRename, onDropToSource, onDropFromSource })
  // 每次渲染后同步最新值（渲染期写 ref 会被 React 19 的 lint 拦）
  useEffect(() => {
    dragRefs.current = { selectedSet, dirPathSet, onRename, onDropToSource, onDropFromSource }
  })
  useEffect(() => {
    const root = rootEl
    if (!root) return
    /**
     * 开始移动前要按住多久（= 拖拽"上膛"）。
     *
     * 必须**明显小于** `LONG_PRESS_MS`（300ms）：否则「按住 150–300ms 后开始拖」会被判成长按而不是拖拽。
     * 2026-11-02 长按 500 → 300 时同步从 240 降到 **150**（给拖拽留出 150ms 的确定性窗口）。
     */
    const ARM_MS = 150
    /** 判定"真的在移动"的位移门槛 */
    const START_PX = 8

    let timer: number | null = null
    let armed = false
    /** 长按到点的反馈定时器（rev173.325 · 真人测试6 #3：到 500ms 振一下 + 按下点涟漪） */
    let feedbackTimer: number | null = null
    let dragging = false
    let fromPath: string | null = null
    let target: string | null = null
    let start = { x: 0, y: 0 }
    /** 按下时刻 + 是否真的移动过 —— 松手时据此判「长按释放 = 弹菜单」（rev173.321） */
    let pressAt = 0
    let moved = false
    /** 按下那一行是不是目录 / 虚拟分组（弹菜单时要用） */
    let pressIsDir = false
    let pressVirtual = false
    /** 按下那一行是不是额外源条目（rev173.400：可拖出，但不弹磁盘操作菜单） */
    let pressSource = false
    /** 源分组 key（拖出时用来选命令） */
    let pressSourceGroup: string | undefined
    /**
     * 一帧最多判一次落点（rev173.331 · 真人测试7 #3「拖拽会有很明显的卡顿感」）。
     *
     * 旧实现每次 `touchmove` 都 ①`document.elementFromPoint()`（强制同步布局）
     * ②`setDropTarget` ③`setDragGhost(新对象)` ⇒ 整棵树每帧重渲染两次。
     * 手指拖动时 touchmove 频率可达 60–120Hz，等于把渲染预算全烧在拖拽上。
     * 现在：touchmove 只记最新坐标 + 排一次 rAF，落点与 ghost 一帧只算一次。
     */
    let moveRaf = 0
    let pending: { x: number; y: number } | null = null
    /** ghost 是否已挂上（首次走 setState，之后直接改 style，不再触发重渲染） */
    let ghostShown = false

    /** 用最新坐标算落点 + 跟手标签（每帧最多执行一次） */
    const applyMove = () => {
      moveRaf = 0
      const pt = pending
      pending = null
      if (!pt || !fromPath) return
      const { selectedSet: sel, dirPathSet: dirsNow } = dragRefs.current
      /**
       * 落点判定（与 `resolveDropTarget` 同口径，rev173.319）：
       * 目录行 ⇒ 它；栏内空白 ⇒ 库根 `''`；栏外 / 文件行 / 自己或子目录 ⇒ `null`（不动作）。
       * 这里内联一份是因为本 effect 只挂一次，直接调渲染期的闭包会拿到旧的 `dirPathSet`。
       */
      const rootEl = rootRef.current
      const under = document.elementFromPoint(pt.x, pt.y) as HTMLElement | null
      let next: string | null = null
      if (under && under.closest('.zn-menu-scrim')) {
        // 遮罩这一帧还没卸载（setState 异步）⇒ 再收一次，落点下一帧再判
        setMenu(null)
        next = null
      } else if (rootEl && under && rootEl.contains(under)) {
        // 判定规则与鼠标链**共用** `lib/tree-drop.ts`（rev173.400）——
        // 以前这里内联一份，加私密分组落点时最容易只改一条链
        const row = under.closest<HTMLElement>('[data-zn-path]')
        next = dropTargetPath(
          resolveTreeDrop({
            over: row?.dataset.znPath ?? null,
            overVirtual: row?.dataset.znVirtual === '1',
            overSourceEntry: row?.dataset.znGroup === '1',
            fromPath,
            dirs: dirsNow,
          }),
        )
      }
      // 值没变就不 setState —— 手指在一个目录里滑动时不应重渲染任何一行
      if (next !== target) {
        target = next
        setDropTarget(next)
      }
      if (!ghostShown) {
        ghostShown = true
        const count = sel.has(fromPath) && sel.size > 1 ? sel.size : 1
        setDragGhost({
          x: pt.x,
          y: pt.y,
          label: count > 1 ? `${baseName(fromPath)} 等 ${count} 项` : baseName(fromPath),
        })
      } else if (ghostRef.current) {
        // 跟手只改样式：left/top 是定位属性，不触发布局重排（ghost 是 fixed 定位）
        ghostRef.current.style.left = `${pt.x}px`
        ghostRef.current.style.top = `${pt.y}px`
      }
    }

    const detach = () => {
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onCancel)
    }

    const clearFeedback = () => {
      if (feedbackTimer !== null) {
        window.clearTimeout(feedbackTimer)
        feedbackTimer = null
      }
    }

    const reset = () => {
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
      if (moveRaf) {
        cancelAnimationFrame(moveRaf)
        moveRaf = 0
      }
      pending = null
      ghostShown = false
      clearFeedback()
      armed = false
      dragging = false
      fromPath = null
      target = null
      moved = false
      pressAt = 0
      pressIsDir = false
      pressVirtual = false
      pressSource = false
      pressSourceGroup = undefined
      detach()
      setDropTarget(null)
      setDraggingPath(null)
      setDragGhost(null)
    }

    const onCancel = () => reset()

    const onEnd = () => {
      // 松手前把最后一帧落点补算掉：rAF 可能还没跑（或刚 touchmove 就抬指），
      // 不补的话「最后停在哪个目录上」会丢
      if (moveRaf) {
        cancelAnimationFrame(moveRaf)
        moveRaf = 0
      }
      applyMove()
      const wasDragging = dragging
      const src = fromPath
      const tgt = target
      const held = pressAt ? Date.now() - pressAt : 0
      const didMove = moved
      const isDir = pressIsDir
      const isVirtual = pressVirtual
      const isSource = pressSource
      const sourceGroup = pressSourceGroup
      const at = { x: start.x, y: start.y }
      reset()

      // 拖拽松手：执行移动（这条分支不再弹菜单）
      if (wasDragging) {
        // 松手后系统还会补一次 click —— 拦掉，否则会把最后经过的笔记打开
        suppressClickRef.current = true
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 0)
        if (!src || tgt === null) return
        const {
          selectedSet: sel,
          dirPathSet: dirsNow,
          onRename: rename,
          onDropToSource: intoSource,
          onDropFromSource: outOfSource,
        } = dragRefs.current
        // 源条目恒为单条（它在树里强制单选，见 Node 的 onClick）
        const paths = isSource ? [src] : sel.has(src) && sel.size > 1 ? dedupe([...sel]) : [src]
        const plan = planTreeDrop({
          fromSource: isSource,
          sourceGroup,
          paths,
          target: parseDropTarget(tgt),
          dirs: dirsNow,
        })
        if (!plan) return
        if (plan.kind === 'into-source') intoSource?.(plan.group, plan.paths)
        else if (plan.kind === 'out-of-source') outOfSource?.(plan.group, plan.paths, plan.dir)
        else for (const en of plan.entries) rename(en.from, en.to, en.isDir)
        setSelected([])
        setSelectionCleared(true)
        return
      }

      /**
       * **长按释放才弹菜单**（rev173.321 · 用户：「移动端菜单改成长按时不弹，在长按释放的时候弹菜单」）。
       *
       * 条件：按住 ≥ `MENU_LONG_PRESS_MS`、期间没移动超过门槛、不是虚拟分组。
       * 弹完要把紧随其后的那次 click 拦掉，否则松手会顺手把笔记打开。
       *
       * 额外源条目（rev173.400）：允许拖（上面那条分支），但长按**不弹磁盘操作菜单** ——
       * 路径与增删都由插件管，改名走右键（`Node` 的 onContextMenu）。
       */
      if (!src || didMove) return
      if (held < MENU_LONG_PRESS_MS) return
      if (isVirtual || isSource) return
      suppressClickRef.current = true
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
      const { selectedSet: sel } = dragRefs.current
      setMenu({
        path: src,
        dir: isDir ? src : parentDir(src),
        isDir,
        multi: sel.has(src) && sel.size > 1,
        x: at.x,
        y: at.y,
      })
    }

    const onMove = (e: TouchEvent) => {
      const t = e.touches[0]
      if (!t || !fromPath) return
      const dx = t.clientX - start.x
      const dy = t.clientY - start.y
      if (!dragging) {
        if (dx * dx + dy * dy < START_PX * START_PX) return
        // 越过门槛就算"移动过"（松手时不再当长按处理）
        moved = true
        if (!armed) {
          // 还没到 150ms 就开始划 ⇒ 用户在滚动，这次不拖
          reset()
          return
        }
        dragging = true
        // 拖拽不是"长按待释放"，到点反馈到此为止
        clearFeedback()
        setDraggingPath(fromPath)
        /**
         * **拖拽开始 ⇒ 先把菜单收掉**（rev173.320 · 真机实测）。
         *
         * 病根：Android 在按住 ~500ms 时会派发 `contextmenu`，行的菜单（连同全屏遮罩
         * `.zn-menu-scrim`）就这么弹出来 —— 用户"按住再拖"的节奏一旦慢半拍，之后的
         * 每次 `elementFromPoint` 都命中遮罩，落点永远判不出来 ⇒ 看起来"拖不进文件夹"。
         */
        setMenu(null)
      }
      // 拖拽中不许列表跟着滚（必须 passive:false 才生效）
      e.preventDefault()
      // 落点判定与 ghost 跟手都推给 rAF：一帧一次（见 `applyMove` 的注释）
      pending = { x: t.clientX, y: t.clientY }
      if (!moveRaf) moveRaf = requestAnimationFrame(applyMove)
    }

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      const el = t.target as HTMLElement | null
      const row = el?.closest?.<HTMLElement>('[data-zn-path]') ?? null
      const p = row?.dataset.znPath ?? null
      // 只从**条目**上起手；空白处的触摸留给滚动
      if (!p) return
      /**
       * 额外笔记源条目（rev173.400）：**允许起手** —— 拖出到公开目录 = 移出。
       * 但不弹长按菜单（见 `onEnd`）；拖到别的落点由 `planTreeDrop` 判 no-op
       * （不会走磁盘 rename，密文不会被搬进公开目录）。
       */
      const fromSourceRow = row?.dataset.znGroup === '1'
      // 虚拟分组行自身不参与拖动（没有磁盘路径）
      if (row?.dataset.znVirtual === '1') return
      reset()
      fromPath = p
      start = { x: t.clientX, y: t.clientY }
      pressAt = Date.now()
      moved = false
      pressIsDir = row?.dataset.znDir === '1'
      pressVirtual = row?.dataset.znVirtual === '1'
      pressSource = fromSourceRow
      pressSourceGroup = row?.dataset.znGroupKey ?? undefined
      timer = window.setTimeout(() => {
        timer = null
        armed = true
      }, ARM_MS)
      /**
       * **到点反馈**（rev173.325 · 真人测试6 #3）：按住满 300ms 振一下 + 按下点涟漪，
       * 用户才知道"现在抬手就会弹菜单"。松手才弹菜单的判定一行没动。
       */
      feedbackTimer = window.setTimeout(() => {
        feedbackTimer = null
        hapticTick()
        spawnRipple(start.x, start.y)
      }, MENU_LONG_PRESS_MS)
      // passive:false —— 拖拽时要能 preventDefault 挡住滚动
      window.addEventListener('touchmove', onMove, { passive: false })
      window.addEventListener('touchend', onEnd)
      window.addEventListener('touchcancel', onCancel)
    }

    root.addEventListener('touchstart', onStart, { passive: true })
    return () => {
      root.removeEventListener('touchstart', onStart)
      reset()
    }
  }, [rootEl])

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

  /** 退出多选：清空勾选、回到普通浏览（返回键同样走这一条） */
  const exitSelectMode = () => {
    setSelectMode(false)
    setSelected([])
    setSelectionCleared(true)
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
          /**
           * **多选态的批量组**（rev173.318 · 用户 2026-11-01）：
           * 顶栏去掉之后，批量操作全在这里。判据是 `selectMode`（不是 `menu.multi`）——
           * 右键的那一条**不一定在勾选集合里**（比如勾了 A/B 却右键 C），那种情况也该给批量项。
           */
          const batchPaths = selectMode ? dedupe([...selectedSet]) : []
          const batch = batchPaths.length > 0
          const picked = batch ? batchPaths : [path]
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
            label: '复制文件',
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
          /**
           * 「详细…」/「在文件夹中打开」（rev173.325 · 真人测试6 #4）：
           * 用户要「点了之后展示文件的详细信息，大小、创建时间、修改时间等等，
           * 还应该有在文件夹中打开，直接跳转到文件实际地址」。
           * 只在宿主传了口才出现 —— 单测 / 独立窗口没有这两个能力时不摆死按钮。
           */
          if (onShowInfo) {
            list.push({
              label: '详细…',
              divider: true,
              onClick: () => {
                const at = menu
                setMenu(null)
                if (at) onShowInfo(path, at.isDir)
              },
            })
          }
          if (onReveal) {
            list.push({
              label: '在文件夹中打开',
              onClick: () => {
                setMenu(null)
                onReveal(path)
              },
            })
          }
          list.push({
            label: batch
              ? `删除选中的 ${batchPaths.length} 项`
              : menu.isDir
                ? '删除文件夹'
                : '删除',
            danger: true,
            onClick: () => deletePaths(batch ? batchPaths : [path]),
          })
          // 彻底删除（不进回收站）—— 单独一项，且**必须二次确认**（`setPurgeConfirm`）
          list.push({
            label: batch ? `彻底删除选中的 ${batchPaths.length} 项…` : '彻底删除…',
            danger: true,
            onClick: () => {
              const targets = batch ? batchPaths : [path]
              setMenu(null)
              setPurgeConfirm({ paths: targets, x: menu.x, y: menu.y })
            },
          })
          /**
           * 批量组：移入… / 退出多选（顶栏去掉后，这里是多选态仅有的操作入口）
           */
          if (batch) {
            list.push({
              label: '移入…',
              divider: true,
              onClick: () => {
                const at = { x: menu.x, y: menu.y }
                setMenu(null)
                setMoveMenu(at)
              },
            })
            list.push({ label: '退出多选', onClick: () => exitSelectMode() })
          }
          /**
           * 「多选」入口（rev173.317 改了行为）。
           *
           * 点完**直接关菜单**，切到"每行前面一个勾选框"的多选形态 —— 用户要的是
           * "进入多选列表"（真人测试5 #1）。菜单留着的话，第一下点其他行会落在菜单遮罩上，
           * 只会把菜单关掉，看起来就是"点了没选中"。
           *
           * rev173.318：**文件夹也能进多选**（勾上它 = 连带里面全部条目），
           * 所以不再限制 `!menu.isDir`。
           */
          if (!selectMode) {
            list.push({
              label: '多选',
              divider: true,
              onClick: () => {
                setSelectMode(true)
                // 走同一个 toggle：勾的是文件夹就**连带里面全部条目**
                toggleSelect(path, menu.isDir)
                setMenu(null)
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
          const picked = selectMode ? dedupe([...selectedSet]) : [path]
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
      /* `is-drop-root`：拖到栏内空白 ⇒ 落到库根，没有具体行可高亮，用整栏描边提示 */
      className={`zn-tree zn-filetree${dropTarget === '' ? ' is-drop-root' : ''}`}
      ref={bindRoot}
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
        //
        // ⚠️ portal 出去的东西不算「树里的空白」（rev173.317 · 真人测试5 #1）：
        // 右键菜单 / 菜单遮罩 / 彻底删除确认框都 `createPortal` 到 body，但它们**仍在
        // React 树上**是本组件的子节点 —— 点击会沿 React 树冒泡到这里。以前只挡了
        // `[role="menu"]`，点菜单遮罩（`.zn-menu-scrim`）会被当成"点空白"⇒ 选中被清空、
        // 多选态被退出。这正是「点多选后点其他文件就取消选中」的一半原因。
        if (!rootRef.current?.contains(e.target as Node)) return
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
      {/* 多选态**不占布局**（rev173.318 · 用户 2026-11-01：「多选的形式，不要添加顶栏」）——
          勾选框直接画在每行行首，批量操作走长按 / 右键菜单。
          这里只留「移入…」弹出的目标目录列表。 */}
      {moveMenu && (
        <ContextMenu
          x={moveMenu.x}
          y={moveMenu.y}
          anchor={menuAnchor}
          items={moveTargets.map((d) => ({
            label: d === '' ? '库根' : d,
            onClick: () => moveSelectedTo(d),
          }))}
          onClose={() => setMoveMenu(null)}
        />
      )}
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
        <div
          ref={ghostRef}
          className="zn-drag-ghost"
          style={{ left: dragGhost.x, top: dragGhost.y }}
        >
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
          selectMode={selectMode}
          onRenameSource={onRenameSource}
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
