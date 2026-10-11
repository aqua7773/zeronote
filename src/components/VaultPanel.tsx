import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { cn } from '@/lib/utils'
import { isValidVaultName, listOtherVaults, vaultPathOf } from '@/lib/vaults'
import { Button } from './ui/button'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from './ui/dialog'

/**
 * 笔记库面板（**移动端专用**）。
 *
 * 桌面上「打开笔记库…」走系统的目录选择器，可以选任意文件夹；
 * 安卓没有目录选择器（Tauri 返回 `FolderPickerNotImplemented`），
 * 所以这里改成应用内列表：默认库 + `库根/.vaults/*`，可切换、可新建。
 *
 * 见 `src/lib/vaults.ts` 的顶部注释（目录约定与为什么用 `.vaults`）。
 */
export interface VaultPanelProps {
  open: boolean
  onOpenChange: (next: boolean) => void
  /** 库根 —— 默认库就是它本身，其它库在它下面的 `.vaults/` 里 */
  root: string
  /** 当前库的绝对路径 */
  current: string
  /** 选中某个库（传绝对路径） */
  onPick: (path: string) => void
}

/**
 * 库行。
 *
 * 刻意**不用深色高亮块**标当前 —— 原来用 `bg-primary text-primary-foreground`，
 * 深底把两行字都压暗（用户反馈：「挡住默认库的那个黑框影响阅读」）。这里还有第二层原因：
 * `tailwind-merge` 不认识自定义色名 `text-primary-foreground`，会把它归进**字号**组、
 * 与 `text-xs` 冲突后静默丢掉颜色（HANDOFF 记过同一个坑）。
 * 现在当前项只用**字重 + 「·当前」**标注，底色一律不铺。
 */
function VaultRow({
  label,
  hint,
  active,
  onClick,
}: {
  label: string
  hint: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full flex-col items-start gap-0.5 px-2.5 py-2 text-left',
        'transition-colors duration-150 ease-out hover:bg-accent',
      )}
    >
      <span className={cn('text-xs text-foreground', active ? 'font-semibold' : 'font-normal')}>
        {label}
        {active ? <span className="ml-1.5 font-normal text-muted-foreground">·当前</span> : null}
      </span>
      <span className="w-full truncate text-[10px] text-muted-foreground">{hint}</span>
    </button>
  )
}

export function VaultPanel({ open, onOpenChange, root, current, onPick }: VaultPanelProps) {
  const [others, setOthers] = useState<string[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  /**
   * 打开面板时加载其它库。
   * setState 刻意放在 `.then` 回调里（而不是 `await` 之后 / 也不是调用另一个
   * 会 setState 的函数）—— 对 oxlint 的 `set-state-in-effect` 规则来说，
   * 只有这样才能表明「这是异步更新，不是 effect 内同步 setState」。
   */
  useEffect(() => {
    if (!open) return
    listOtherVaults(root)
      .then(setOthers)
      .catch((e) => setErr(String(e)))
  }, [open, root])

  /**
   * 统一的开关入口：**关闭时**清掉输入与错误。
   * 刻意放在事件处理里而不是 effect 里 —— 在 effect 里同步 setState 会触发
   * `set-state-in-effect`（React 编译器不建议，项目 oxlint 把它当 warning）。
   */
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setName('')
        setErr(null)
      }
      onOpenChange(next)
    },
    [onOpenChange],
  )

  const createAndPick = useCallback(async () => {
    const n = name.trim()
    if (!isValidVaultName(n)) {
      setErr('库名不能为空、不能含 / 或 \\、不能以 . 开头（最多 40 字）')
      return
    }
    if (others.includes(n)) {
      setErr(`已经有一个叫「${n}」的库了`)
      return
    }
    setBusy(true)
    try {
      const path = vaultPathOf(root, n)
      // 建目录 + 建 `.zn`（与首次启动同一个命令）
      await invoke('ensure_vault', { vault: path })
      onPick(path)
      handleOpenChange(false)
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }, [name, others, root, onPick, handleOpenChange])

  const pick = (path: string) => {
    onPick(path)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} width={420}>
      <DialogHeader
        title="笔记库"
        description="手机版不能选任意文件夹，所有库都建在这个目录下："
      />
      {/* 库与库之间用**短横线**分隔。
          刻意不用 Tailwind 的 `divide-y` —— 真机实测它一条线都没渲染出来
          （面板中部整段做了像素级扫描：无任何非白行）。改用显式 `border-t`，所见即所得。 */}
      <DialogBody>
        <VaultRow
          label="默认库"
          hint={root}
          active={current === root}
          onClick={() => pick(root)}
        />
        {others.map((n) => {
          const p = vaultPathOf(root, n)
          return (
            <div key={n} className="border-t border-border">
              <VaultRow label={n} hint={p} active={current === p} onClick={() => pick(p)} />
            </div>
          )
        })}
        {others.length === 0 ? (
          <p className="px-1 pt-3 text-xs text-muted-foreground">
            还没有别的库。在下面起个名字新建 —— 每个库是一批独立的笔记。
          </p>
        ) : null}
        {err ? <p className="px-1 pt-3 text-xs text-destructive">{err}</p> : null}
      </DialogBody>
      <DialogFooter className="justify-between">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="新库名字"
          className={cn(
            'h-7 min-w-0 flex-1 rounded-ui-md border border-border-strong bg-background px-2',
            'text-xs text-foreground outline-none placeholder:text-muted-foreground',
            'focus-visible:ring-2 focus-visible:ring-primary/30',
          )}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void createAndPick()
          }}
        />
        <Button variant="primary" size="md" disabled={busy} onClick={() => void createAndPick()}>
          新建并切换
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
