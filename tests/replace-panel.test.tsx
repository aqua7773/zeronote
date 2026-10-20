// @vitest-environment happy-dom
/**
 * 全局替换面板（rev173.49 · 待办 #3）。
 *
 * 判据：
 *  · **先试运行**：点「试运行」只读不写，列出命中（文件 + 处数）；
 *  · **确认才写**：点「全部替换」→ 确认框 → 每个文件先 delete（备份进回收站）再 writeText；
 *  · 范围目录生效（只扫该目录下的笔记）；
 *  · 非法正则给一句话，不静默失败。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReplacePanel } from '../src/components/ReplacePanel'
import type { FsApi, NoteMeta } from '../src/kernel/contract'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const note = (path: string): NoteMeta => ({
  path,
  id: path,
  title: path,
  mtime: 0,
  size: 0,
  frontmatter: {},
  kind: 'note',
})

function makeFs(initial: Record<string, string>) {
  const files = { ...initial }
  const readText = vi.fn(async (p: string) => files[p] ?? '')
  const writeText = vi.fn(async (p: string, c: string) => {
    files[p] = c
  })
  const del = vi.fn(async (p: string) => {
    const old = files[p]
    delete files[p]
    return `.zn/trash/20261020/${p}`
  })
  void del
  const fs = {
    readText,
    writeText,
    delete: del,
    listNotes: vi.fn(async () => []),
    listDirs: vi.fn(async () => []),
    vaultPath: () => '/vault',
    createNote: vi.fn(),
    rename: vi.fn(),
    mkdir: vi.fn(),
    move: vi.fn(),
    copy: vi.fn(),
    exists: vi.fn(async () => false),
    listTrash: vi.fn(async () => []),
    restoreTrash: vi.fn(),
    purgeTrash: vi.fn(),
    emptyTrash: vi.fn(),
    watch: vi.fn(),
  } as unknown as FsApi
  return { fs, files, readText, writeText, del }
}

const baseProps = { open: true, onClose: () => {} }

describe('ReplacePanel', () => {
  it('试运行只读不写，列出命中清单', async () => {
    const { fs, readText, writeText, del } = makeFs({
      'a.md': '今天开会，会议纪要在附件里。',
      'b.md': '无关内容',
    })
    render(<ReplacePanel {...baseProps} fs={fs} notes={[note('a.md'), note('b.md')]} />)

    fireEvent.change(screen.getByLabelText('查找'), { target: { value: '会议' } })
    fireEvent.click(screen.getByRole('button', { name: '试运行' }))

    await screen.findByText('a.md')
    expect(screen.getByText('1 处')).toBeTruthy()
    expect(readText).toHaveBeenCalledTimes(2)
    // 试运行阶段绝不写盘
    expect(writeText).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
  })

  it('全部替换：先进回收站再写新内容，并回调 onApplied', async () => {
    const { fs, files, writeText, del } = makeFs({
      'a.md': '旧会议记录',
      'b.md': '另一篇会议记录',
    })
    const onApplied = vi.fn()
    const confirmSpy = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmSpy)

    render(
      <ReplacePanel
        {...baseProps}
        fs={fs}
        notes={[note('a.md'), note('b.md')]}
        onApplied={onApplied}
      />,
    )

    fireEvent.change(screen.getByLabelText('查找'), { target: { value: '会议记录' } })
    fireEvent.change(screen.getByLabelText('替换为'), { target: { value: '会议纪要' } })
    fireEvent.click(screen.getByRole('button', { name: '试运行' }))
    await screen.findByText('a.md')
    await screen.findByText('b.md')

    fireEvent.click(screen.getByRole('button', { name: '全部替换' }))

    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1))
    expect(confirmSpy).toHaveBeenCalled()
    // 两篇都：delete 一次 + writeText 一次；内容已换
    expect(del).toHaveBeenCalledTimes(2)
    expect(writeText).toHaveBeenCalledTimes(2)
    expect(files['a.md']).toBe('旧会议纪要')
    expect(files['b.md']).toBe('另一篇会议纪要')
    expect(onApplied.mock.calls[0][0].sort()).toEqual(['a.md', 'b.md'])
    expect(onApplied.mock.calls[0][1]).toBe(2)
  })

  it('选目录范围后只扫该目录下的笔记', async () => {
    const { fs, readText } = makeFs({
      '工作/a.md': '会议',
      '学习/b.md': '会议',
    })
    render(
      <ReplacePanel
        {...baseProps}
        fs={fs}
        notes={[note('工作/a.md'), note('学习/b.md')]}
      />,
    )

    fireEvent.change(screen.getByLabelText('替换范围目录'), { target: { value: '工作' } })
    fireEvent.change(screen.getByLabelText('查找'), { target: { value: '会议' } })
    fireEvent.click(screen.getByRole('button', { name: '试运行' }))

    await screen.findByText('工作/a.md')
    expect(readText).toHaveBeenCalledTimes(1)
    expect(readText).toHaveBeenCalledWith('工作/a.md')
  })

  it('非法正则：给出具体原因，不崩溃', async () => {
    const { fs } = makeFs({ 'a.md': 'x' })
    render(<ReplacePanel {...baseProps} fs={fs} notes={[note('a.md')]} />)

    fireEvent.click(screen.getByRole('button', { name: /正则/ }))
    fireEvent.change(screen.getByLabelText('查找'), { target: { value: '([' } })
    fireEvent.click(screen.getByRole('button', { name: '试运行' }))

    await screen.findByText(/查找表达式无效/)
  })
})
