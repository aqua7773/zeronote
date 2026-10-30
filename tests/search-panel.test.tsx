// @vitest-environment happy-dom
/**
 * 搜索面板的筛选行（rev173.47 · 待办 #4）：标签下拉 / 目录下拉 / 正则开关。
 *
 * 测的是**联动**：面板不自己匹配，而是把 `tag` / `dir` / `regex` 传给内核 `index.query`。
 * 用假的 IndexApi（面板按契约注入 index，本来就不认识内核）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchPanel } from '../src/components/SearchPanel'
import type { IndexApi } from '../src/kernel/contract'

afterEach(cleanup)

function makeIndex() {
  const query = vi.fn(async (q: string) =>
    q
      ? [{ path: 'a.md', title: 'A', excerpt: `命中：${q}`, score: 1 }]
      : [{ path: 'a.md', title: 'A', excerpt: '开头', score: 0 }],
  )
  const tags = vi.fn(async () => [
    { tag: '工作', count: 3 },
    { tag: '生活', count: 1 },
  ])
  const rebuild = vi.fn(async () => ({ count: 4, ms: 1 }))
  const index = {
    query,
    tags,
    rebuild,
    upsert: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    scoped: () => index,
  } as unknown as IndexApi
  return { index, query, tags }
}

const baseProps = {
  open: true,
  onClose: () => {},
  onOpenNote: () => {},
  notes: [
    { path: 'a.md', mtime: 2 },
    { path: '学习/b.md', mtime: 1 },
  ],
}

describe('SearchPanel 筛选行', () => {
  it('标签选项来自 index.tags()，选中后把 tag 交给内核（空关键词也算查询）', async () => {
    const { index, query, tags } = makeIndex()
    render(<SearchPanel {...baseProps} index={index} />)

    await waitFor(() => expect(tags).toHaveBeenCalled())
    const select = screen.getByRole('combobox', { name: '按标签筛选' })
    await waitFor(() => expect(screen.getByText('工作（3）')).toBeTruthy())

    fireEvent.change(select, { target: { value: '工作' } })
    await waitFor(() =>
      expect(query).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ tag: '工作', regex: false }),
      ),
    )
  })

  it('目录选项从笔记路径推出来（含多级前缀），选中后把 dir 交给内核', async () => {
    const { index, query } = makeIndex()
    render(<SearchPanel {...baseProps} index={index} />)

    const select = screen.getByRole('combobox', { name: '按目录筛选' })
    await waitFor(() => expect(screen.getByRole('option', { name: '学习' })).toBeTruthy())

    fireEvent.change(select, { target: { value: '学习' } })
    await waitFor(() =>
      expect(query).toHaveBeenCalledWith('', expect.objectContaining({ dir: '学习' })),
    )
  })

  it('打开「正则」后查询带 regex: true；语法错误给出提示', async () => {
    const { index, query } = makeIndex()
    render(<SearchPanel {...baseProps} index={index} />)

    fireEvent.click(screen.getByRole('button', { name: /正则/ }))
    const input = screen.getByLabelText('搜索笔记')

    fireEvent.change(input, { target: { value: '^# 标题' } })
    await waitFor(() =>
      expect(query).toHaveBeenCalledWith(
        '^# 标题',
        expect.objectContaining({ regex: true }),
      ),
    )

    fireEvent.change(input, { target: { value: '([' } })
    await screen.findByText(/正则无效/)
  })

  it('「清除筛选」把三项一起复位', async () => {
    const { index, query } = makeIndex()
    render(<SearchPanel {...baseProps} index={index} />)

    fireEvent.click(screen.getByRole('button', { name: /正则/ }))
    fireEvent.change(screen.getByLabelText('搜索笔记'), { target: { value: '关键词' } })
    await waitFor(() =>
      expect(query).toHaveBeenCalledWith('关键词', expect.objectContaining({ regex: true })),
    )

    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    expect(screen.getByRole('button', { name: /正则/ }).getAttribute('aria-pressed')).toBe('false')
    await waitFor(() =>
      expect(query).toHaveBeenCalledWith('关键词', expect.objectContaining({ regex: false })),
    )
  })
})

/**
 * 自动聚焦开关（rev173.270 · 真人使用测试 #8）。
 *
 * 手机全屏搜索页传 `autoFocus={false}` —— 页面一出现就 focus 会把软键盘顶上来，
 * 盖掉半个结果区。桌面（侧栏视图 / 浮层）保持默认 `true`，打开即可打字。
 */
describe('SearchPanel 自动聚焦', () => {
  it('默认（桌面）打开即聚焦搜索框', async () => {
    const { index } = makeIndex()
    render(<SearchPanel {...baseProps} index={index} />)
    const input = screen.getByLabelText('搜索笔记')
    await waitFor(() => expect(document.activeElement).toBe(input))
  })

  it('autoFocus=false（手机全屏页）不聚焦，软键盘不弹', async () => {
    const { index } = makeIndex()
    render(<SearchPanel {...baseProps} index={index} autoFocus={false} />)
    const input = screen.getByLabelText('搜索笔记')
    // 聚焦在 setTimeout(0) 里做；等一轮宏任务再断言「仍然没聚焦」
    await new Promise((r) => setTimeout(r, 20))
    expect(document.activeElement).not.toBe(input)
  })
})
