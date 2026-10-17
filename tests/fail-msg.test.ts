import { describe, expect, it } from 'vitest'
import { failMsg } from '../src/lib/fail-msg'

describe('failMsg', () => {
  it('普通失败：说清是什么 + 给补救 + 附原始信息', () => {
    const msg = failMsg('write', new Error('disk full'))
    expect(msg).toContain('保存失败')
    expect(msg).toContain('磁盘可能已满')
    expect(msg).toContain('disk full')
  })

  it('重命名撞名 ⇒ 一句人话（不拼原始错误）', () => {
    expect(failMsg('rename', new Error('file already exists'))).toBe('已存在同名笔记。')
  })

  it('新建撞名同样走人话', () => {
    expect(failMsg('create', '已存在同名文件')).toBe('已存在同名笔记。')
  })

  it('缺「所有文件访问」权限 ⇒ 给出唯一可操作的一步', () => {
    const msg = failMsg('read', new Error('Permission denied (os error 13)'))
    expect(msg).toContain('所有文件访问')
    expect(msg).toContain('命令面板')
  })

  it('EACCES 也识别为权限问题', () => {
    expect(failMsg('list', new Error('EACCES: permission denied'))).toContain('所有文件访问')
  })

  it('非 Error 值转成字符串附在末尾', () => {
    expect(failMsg('delete', 'busy')).toContain('busy')
  })

  it('每种 kind 都有对应的话术', () => {
    const kinds = ['read', 'write', 'create', 'rename', 'delete', 'list', 'vault'] as const
    for (const k of kinds) {
      const msg = failMsg(k, new Error('x'))
      expect(msg).toContain('x')
      expect(msg.length).toBeGreaterThan(4)
    }
  })
})
