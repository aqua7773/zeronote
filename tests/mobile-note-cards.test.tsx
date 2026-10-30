// @vitest-environment happy-dom
/**
 * 卡片菜单进 Android 返回键层栈（rev173.66）。
 *
 * 修的是交接卡「可选小项」：卡片菜单开着按返回键会被判成"都没得关" ⇒ 直接退 App。
 * 判据：
 *  · 菜单打开时把关闭函数压进 App 的 `layerExitsRef`（与 FileTree 同一约定）；
 *  · 返回键先关菜单、返回 true（App 据此不再往下走 / 不 exit）；
 *  · 菜单关掉（返回键关 / 点菜单项关）后从栈里移除 —— 不留一层死出口。
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileNoteCards } from '../src/components/MobileNoteCards'
import type { NoteMeta } from '../src/kernel/contract'

afterEach(cleanup)

const note = (path: string, title: string): NoteMeta => ({
  path,
  id: path,
  title,
  mtime: 1,
  size: 0,
  frontmatter: {},
  kind: 'note',
})

/** App 的 `layerExitsRef` 形态 */
type LayerStack = { current: Array<() => boolean> }

function makeProps(layers?: LayerStack) {
  return {
    notes: [note('a.md', '甲')],
    onOpen: vi.fn(),
    onNewNote: vi.fn(),
    readText: vi.fn(async () => '正文'),
    onDelete: vi.fn(),
    onPurge: vi.fn(),
    onRename: vi.fn(),
    variant: 'panel' as const,
    layers: layers as never,
  }
}

describe('MobileNoteCards 卡片菜单：返回键层栈', () => {
  it('菜单打开时压栈；返回键先关菜单（返回 true）并从栈里移除', async () => {
    const layers: LayerStack = { current: [] }
    render(<MobileNoteCards {...makeProps(layers)} />)
    await act(async () => {}) // 等卡片正文异步读完
    fireEvent.click(screen.getByLabelText('更多'))
    expect(screen.getByText('重命名…')).toBeTruthy()
    expect(layers.current).toHaveLength(1)

    let handled = false
    act(() => {
      handled = layers.current[0]()
    })
    expect(handled).toBe(true)
    expect(screen.queryByText('重命名…')).toBeNull()
    expect(layers.current).toHaveLength(0)
  })

  it('点菜单项后同样从栈里移除（不留死出口）', async () => {
    const layers: LayerStack = { current: [] }
    const props = makeProps(layers)
    render(<MobileNoteCards {...props} />)
    await act(async () => {})
    fireEvent.click(screen.getByLabelText('更多'))
    expect(layers.current).toHaveLength(1)

    fireEvent.click(screen.getByText('打开'))
    expect(props.onOpen).toHaveBeenCalledWith('a.md')
    expect(layers.current).toHaveLength(0)
  })

  it('不传 layers（桌面 / 浏览器预览）也能正常开菜单', async () => {
    render(<MobileNoteCards {...makeProps()} />)
    await act(async () => {})
    fireEvent.click(screen.getByLabelText('更多'))
    expect(screen.getByText('重命名…')).toBeTruthy()
  })
})

/**
 * 只列笔记（rev173.273 · 真人使用测试 #7）。
 *
 * `notes` 含附件（图片 / 文档 / 音视频）—— 文件树要按类型分组显示它们，但时间流 /
 * 卡片流是「按时间看写过的东西」，一张 png 或 pdf 出现在那里点开还是「打开附件」。
 */
describe('MobileNoteCards 只列笔记', () => {
  it('图片 / 文档 / 音视频不进卡片流', async () => {
    const props = makeProps()
    props.notes = [
      note('笔记.md', '笔记甲'),
      { ...note('附件/图.png', '图片乙'), kind: 'image' },
      { ...note('附件/手册.pdf', '文档丙'), kind: 'doc' },
      { ...note('附件/clip.mp4', '视频丁'), kind: 'media' },
    ]
    render(<MobileNoteCards {...props} />)
    await act(async () => {})
    // 卡片正文是笔记内容（readText 返回「正文」），所以按卡片数量 + 只读笔记正文来断言
    expect(document.querySelectorAll('.zn-mobile-card')).toHaveLength(1)
    expect(props.readText).toHaveBeenCalledTimes(1)
    expect(props.readText).toHaveBeenCalledWith('笔记.md')
  })
})
