/**
 * 重命名对话框（rev173.276 · 真人使用测试 #16 / #17 的补位）。
 *
 * 为什么不用 `window.prompt`：
 *  · wry 的 `onJsPrompt`（`RustWebChromeClient.kt`）**没有用 `defaultValue`** —— 对话框
 *    永远是空框，用户想改中间两个字只能重打一遍（用户 #17 的原话）；
 *  · Android 上原生 AlertDialog 与 WebView 的交互出过「输入到一半闪退」（用户 #16），
 *    宿主这边至少先把**可控**的那一半换掉 —— 自绘对话框不经过原生壳。
 *
 * 与 FileTree 的内联重命名同一套语义：打开即选中主名、回车确认、Esc 取消、空名不提交。
 */
import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui'

export interface RenameDialogProps {
  open: boolean
  /** 当前文件名（含扩展名）—— 打开时预填，并选中主名 */
  initial: string
  onCancel: () => void
  /** 收到用户输入的原样文字（宿主决定补不补 `.md`、拼不拼目录） */
  onConfirm: (next: string) => void
}

/** `.md` 只选主名（与 FileTree 的 #17 一致）：扩展名一起选中时用户常顺手删掉它 */
function mainNameRange(name: string): [number, number] | null {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  return [0, dot]
}

export function RenameDialog({ open, initial, onCancel, onConfirm }: RenameDialogProps) {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement | null>(null)

  /* Dialog 打开时会聚焦「第一个可聚焦元素」= 右上角的 × —— 这里把焦点抢回输入框，
     并只选中主名（光标落在主名末尾，点中间即可插入）。
     ⚠️ 不在这里 setValue：宿主用条件渲染（每次打开都是新实例），初值由 useState 拿到即可；
     在 effect 里同步 setState 会被 lint 判成 cascading render。 */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const input = inputRef.current
      if (!input) return
      input.focus()
      const range = mainNameRange(initial)
      if (range) input.setSelectionRange(range[0], range[1])
      else input.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [initial])

  const submit = () => {
    const next = value.trim()
    if (!next) return
    onConfirm(next)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      width={420}
    >
      <DialogHeader title="重命名" description="只改文件名 —— 扩展名不用自己补" />
      <DialogBody>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          aria-label="新文件名"
          className="w-full rounded-ui-sm border border-border-strong bg-background px-2 py-1.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button onClick={submit} disabled={!value.trim()}>
          确定
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
