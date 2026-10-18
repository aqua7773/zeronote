// @vitest-environment happy-dom
/**
 * `@atomic-editor/editor` 补丁回归（rev131 · 工程债 #2）。
 *
 * 补丁：`patches/@atomic-editor__editor@0.6.2.patch` —— 对齐 Typora 的「标记后必须有空格」：
 *  - 空 ATX 标题（`#` / `# ` 后立刻换行）⇒ 不当标题、不隐藏 `#`；
 *  - Setext 下划线只有一个 `-` ⇒ 不当标题。
 *
 * 两类断言：
 *  1. **静态护栏**：版本 + patch 声明 + `node_modules` 里实际应用了补丁 —— 升级 atomic 后
 *     忘记重打会立刻红（「升级必须重打」这条约定从此有测试拦）；
 *  2. **真实渲染**：挂载 MarkdownEditor（真实 atomic + CM6），断言标题行的装饰类按补丁出现/消失。
 */
import { render } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MarkdownEditor } from '../src/components/MarkdownEditor'

const ROOT = path.resolve(import.meta.dirname, '..')

function mount(value: string) {
  return render(
    <MarkdownEditor path="a.md" value={value} onChange={() => {}} onSave={() => {}} />,
  ).container
}

/** 光标在文件开头（第 1 行是源码态）；标题放在后面几行才会走 inline-preview 渲染 */
// 标题行的装饰类：ATX/Setext 1–6 级分别映射到 cm-atomic-h1…h6（见 dist/inline-preview.js 的 LINE_CLASS_BY_BLOCK）
const headingRows = (c: HTMLElement) =>
  c.querySelectorAll(
    '.cm-atomic-h1, .cm-atomic-h2, .cm-atomic-h3, .cm-atomic-h4, .cm-atomic-h5, .cm-atomic-h6',
  )

describe('atomic-editor 补丁：静态护栏', () => {
  it('package.json 声明了补丁，且 node_modules 里确实打上了', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      pnpm?: { patchedDependencies?: Record<string, string> }
    }
    expect(pkg.pnpm?.patchedDependencies).toEqual({
      '@atomic-editor/editor@0.6.2': 'patches/@atomic-editor__editor@0.6.2.patch',
    })
    const dist = fs.readFileSync(
      path.join(ROOT, 'node_modules/@atomic-editor/editor/dist/inline-preview.js'),
      'utf8',
    )
    expect(dist).toContain('isBareHeadingForTypora')
  })
})

describe('atomic-editor 补丁：渲染行为', () => {
  it('正常 ATX 标题 ⇒ 行上有 heading 装饰类', () => {
    const c = mount('正文\n\n# 标题\n')
    expect(headingRows(c).length).toBeGreaterThan(0)
  })

  it('空 ATX 标题（`# ` 后换行）⇒ 不给 heading 装饰类', () => {
    const c = mount('正文\n\n# \n\n结尾\n')
    expect(headingRows(c).length).toBe(0)
  })

  it('Setext 单个 `-` ⇒ 不当标题；`---` 仍当标题', () => {
    const single = mount('正文\n\n标题文字\n-\n\n结尾\n')
    expect(headingRows(single).length).toBe(0)

    const triple = mount('正文\n\n标题文字\n---\n\n结尾\n')
    expect(headingRows(triple).length).toBeGreaterThan(0)
  })
})
