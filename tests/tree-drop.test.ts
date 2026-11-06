// @vitest-environment happy-dom
/**
 * 文件树拖拽的落点判定 / 动作规划（rev173.400 · 私密笔记拖入移出）。
 *
 * 为什么这些必须单测：鼠标与手机触摸是两套事件链，落点规则共用一个纯函数
 * （`lib/tree-drop.ts`）。规则错了的后果不是"没反应"，而是**密文被搬进公开目录**
 * （rev173.376 刻意禁掉的那条）—— 所以反向用例和正向一样重要。
 */
import { describe, expect, it } from 'vitest'
import {
  GROUP_NODE_PREFIX,
  groupKeyOf,
  isSourceGroupPath,
  parseDropTarget,
  planTreeDrop,
  resolveTreeDrop,
  sourceGroupDropPath,
} from '../src/lib/tree-drop'

const dirs = new Set(['归档', '测试文件'])
const base = { over: null, overVirtual: false, overSourceEntry: false, fromPath: 'a.md', dirs }

describe('分组哨兵', () => {
  it('前缀拼接与还原一致', () => {
    expect(sourceGroupDropPath('private')).toBe('__zn_group_private')
    expect(isSourceGroupPath('__zn_group_private')).toBe(true)
    expect(isSourceGroupPath('归档')).toBe(false)
    expect(groupKeyOf(GROUP_NODE_PREFIX + 'private')).toBe('private')
    expect(parseDropTarget('__zn_group_private')).toEqual({ kind: 'source', group: 'private' })
    expect(parseDropTarget('')).toEqual({ kind: 'dir', dir: '' })
    expect(parseDropTarget(null)).toBeNull()
  })
})

describe('resolveTreeDrop 落点判定', () => {
  it('栏内空白 ⇒ 库根', () => {
    expect(resolveTreeDrop({ ...base })).toEqual({ kind: 'dir', dir: '' })
  })

  it('真实目录行 ⇒ 那个目录', () => {
    expect(resolveTreeDrop({ ...base, over: '归档' })).toEqual({ kind: 'dir', dir: '归档' })
  })

  it('文件行 ⇒ 不动作', () => {
    expect(resolveTreeDrop({ ...base, over: 'b.md' })).toBeNull()
  })

  it('拖进自己 / 自己的子目录 ⇒ 不动作', () => {
    expect(resolveTreeDrop({ ...base, over: 'a.md' })).toBeNull()
    expect(resolveTreeDrop({ ...base, over: 'a.md/x' })).toBeNull()
  })

  it('私密分组行 ⇒ source 落点（移入）', () => {
    expect(resolveTreeDrop({ ...base, over: '__zn_group_private', overVirtual: true })).toEqual({
      kind: 'source',
      group: 'private',
    })
  })

  it('源条目本身不是落点（拖到条目上不能猜成"这个组"）', () => {
    expect(
      resolveTreeDrop({ ...base, over: '.zn/private/notes/x.zn', overSourceEntry: true }),
    ).toBeNull()
  })

  it('未知虚拟分组（将来恢复文档分组）⇒ 不动作', () => {
    expect(resolveTreeDrop({ ...base, over: '__zn_docs__', overVirtual: true })).toBeNull()
  })
})

describe('planTreeDrop 松手动作', () => {
  it('公开笔记 → 私密分组 = 移入；已经在 .zn/ 里的被滤掉', () => {
    expect(
      planTreeDrop({
        fromSource: false,
        paths: ['a.md', '.zn/private/notes/x.zn'],
        target: { kind: 'source', group: 'private' },
        dirs,
      }),
    ).toEqual({ kind: 'into-source', group: 'private', paths: ['a.md'] })
  })

  it('公开笔记 → 目录 = 普通移动（原地跳过；目录标 isDir）', () => {
    expect(
      planTreeDrop({
        fromSource: false,
        paths: ['a.md', '归档/b.md', '测试文件'],
        target: { kind: 'dir', dir: '归档' },
        dirs,
      }),
    ).toEqual({
      kind: 'move',
      entries: [
        { from: 'a.md', to: '归档/a.md', isDir: false },
        { from: '测试文件', to: '归档/测试文件', isDir: true },
      ],
    })
  })

  it('私密条目 → 目录 = 移出（带分组 key，路由到对应插件命令）', () => {
    expect(
      planTreeDrop({
        fromSource: true,
        sourceGroup: 'private',
        paths: ['.zn/private/notes/x.zn'],
        target: { kind: 'dir', dir: '归档' },
        dirs,
      }),
    ).toEqual({ kind: 'out-of-source', group: 'private', paths: ['.zn/private/notes/x.zn'], dir: '归档' })
  })

  it('私密条目 → 同一私密分组 = 不动作', () => {
    expect(
      planTreeDrop({
        fromSource: true,
        sourceGroup: 'private',
        paths: ['.zn/private/notes/x.zn'],
        target: { kind: 'source', group: 'private' },
        dirs,
      }),
    ).toBeNull()
  })

  it('源条目拖出但不知道分组 ⇒ 不动作（宁可不搬，也不搬错）', () => {
    expect(
      planTreeDrop({
        fromSource: true,
        paths: ['.zn/private/notes/x.zn'],
        target: { kind: 'dir', dir: '' },
        dirs,
      }),
    ).toBeNull()
  })

  it('没有落点 / 没有路径 ⇒ 不动作', () => {
    expect(planTreeDrop({ fromSource: false, paths: ['a.md'], target: null, dirs })).toBeNull()
    expect(
      planTreeDrop({ fromSource: false, paths: [], target: { kind: 'dir', dir: '归档' }, dirs }),
    ).toBeNull()
  })
})
