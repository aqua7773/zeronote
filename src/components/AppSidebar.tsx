/**
 * 侧栏（库名 + 文件树 + 回收站/切库按钮）—— 从 `App.tsx` 原样迁出（rev122 · L2）。
 *
 * 只做渲染：数据与回调全部由 `App` 传入，组件自身不持任何状态
 * （宽度拖拽在 `App` 的 resizer 里，状态仍在 App）。
 */
import type { MutableRefObject } from 'react'
import { Settings } from 'lucide-react'
import type { NoteMeta } from '../kernel/contract'
import { baseName } from '../lib/app-paths'
import { FileTree } from './FileTree'

export type AppSidebarProps = {
  vault: string | null
  notes: NoteMeta[]
  dirs: string[]
  activePath: string | null
  /** 移动端抽屉是否展开（桌面端恒为 false，宽度由 `width` 决定） */
  open: boolean
  width: number
  /** 返回键层级栈 —— 由 App 维护，FileTree 反应用来注册"关闭一层" */
  layers: MutableRefObject<Array<() => boolean>>
  clipboard: { mode: 'cut' | 'copy'; paths: string[] } | null
  onOpen: (path: string) => void
  onNewFile: (dir: string) => Promise<string | null>
  onNewDir: (dir: string) => Promise<string | null>
  onRename: (from: string, to: string, isDir: boolean) => void
  onDeleteMany: (paths: string[]) => void
  onPurgeMany: (paths: string[]) => void
  onCut: (paths: string[]) => void
  onCopy: (paths: string[]) => void
  onPaste: (dir: string) => void
  onDuplicate: (path: string) => void
  onOpenTrash: () => void
  /** 弹出「切换笔记库」菜单（坐标 = 按钮的 client 坐标） */
  onOpenVaultMenu: (x: number, y: number) => void
  /** 打开设置（2026-10-18 用户要求：侧栏头部放一个设置图标，不必再进 ☰ 菜单） */
  onOpenSettings: () => void
  /** 桌面「时间流」入口（rev173.48）—— 文件树右键菜单用；手机端不传 */
  onOpenTimeline?: () => void
}

export function AppSidebar({
  vault,
  notes,
  dirs,
  activePath,
  open,
  width,
  layers,
  clipboard,
  onOpen,
  onNewFile,
  onNewDir,
  onRename,
  onDeleteMany,
  onPurgeMany,
  onCut,
  onCopy,
  onPaste,
  onDuplicate,
  onOpenTrash,
  onOpenVaultMenu,
  onOpenSettings,
  onOpenTimeline,
}: AppSidebarProps) {
  return (
    <aside className={`zn-sidebar${open ? ' is-open' : ''}`} style={{ width }}>
      <div className="zn-sidebar-head">
        {/* 固定显示应用名；具体是哪个库看状态栏右侧的完整路径（那儿更准确）。
            悬停在这行上仍能看到库路径，信息没丢。 */}
        <span className="zn-vault-name" title={vault ?? ''}>
          ZeroNote
        </span>
        {/* 设置入口（2026-10-18 用户要求）—— 图标放侧栏头部右侧，省掉「☰ 菜单 → 设置」两步；
            ☰ 菜单里的「设置」项保留（两处入口不冲突）。 */}
        <button
          type="button"
          className="zn-icon-btn"
          onClick={onOpenSettings}
          title="设置"
          aria-label="设置"
        >
          <Settings size={15} />
        </button>
      </div>
      {vault ? (
        <FileTree
          // 换库即重建：展开/折叠状态按库隔离（key 带库路径，localStorage 各存各的）
          key={vault}
          vault={vault}
          notes={notes}
          dirs={dirs}
          activePath={activePath}
          onOpen={onOpen}
          onNewFile={onNewFile}
          onNewDir={onNewDir}
          onRename={onRename}
          onDeleteMany={onDeleteMany}
          onPurgeMany={onPurgeMany}
          clipboard={clipboard}
          onCut={onCut}
          onCopy={onCopy}
          onPaste={onPaste}
          onDuplicate={onDuplicate}
          layers={layers}
          onOpenTimeline={onOpenTimeline}
        />
      ) : (
        <div
          className="zn-tree"
          style={{ fontSize: 'var(--zn-text-sm)', color: 'var(--zn-fg-subtle)' }}
        >
          还没选择笔记库
        </div>
      )}
      {/* 库信息归侧栏底部（用户要求）；状态栏留给文档级信息。
          这里显示库目录名，完整路径挂在 tooltip 上。
          它是一个**按钮**：点一下弹「切换笔记库」（最近打开过的库 + 打开其它文件夹…），
          不必再绕系统目录选择器。菜单贴在按钮上方展开（见 App 的 openVaultMenu）。 */}
      {/* 回收站入口（常驻）—— 删除一直是进 `.zn/trash/` 的，这是唯一能再拿到它们的地方 */}
      <button
        type="button"
        className="zn-sidebar-foot"
        onClick={onOpenTrash}
        title="回收站：删除的笔记都在这里，可恢复"
      >
        🗑 回收站
      </button>
      <button
        type="button"
        className="zn-sidebar-foot"
        title={vault ?? ''}
        aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          onOpenVaultMenu(r.left, r.top)
        }}
      >
        {vault ? baseName(vault) : '未选择笔记库'}
      </button>
    </aside>
  )
}
