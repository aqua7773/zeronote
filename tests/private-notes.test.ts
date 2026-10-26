/**
 * 私密文件夹插件（`examples/private-notes`）纯逻辑单测 —— rev173.180 期 1
 *
 * 只测不依赖宿主的部分：id / 路径 / 索引编解码 / 排序 / 标题提取 / 索引增删 / 环探测。
 * 加解密、面板、codec 注册留给 CDP 实测（那些要真 WebView + 真 Argon2 + 真 Tauri）。
 *
 * 覆盖原则（`docs/开发约定.md` §4）：每条正向断言配一条反向用例 ——
 * 最危险的几条是「索引损坏被当成空库」（下一次保存就把真数据盖掉）与
 * 「标题提取把正文吞了」，都单独立用例。
 */
import { describe, expect, it } from 'vitest'
import {
  INDEX_FILE,
  INDEX_VERSION,
  NOTES_DIR,
  PRIVATE_DIR,
  emptyIndex,
  findNote,
  hasNotesRing,
  newNoteId,
  notePath,
  parseIndex,
  removeNote,
  serializeIndex,
  sortNotes,
  titleFromText,
  upsertNote,
} from '../examples/private-notes/index.js'

describe('private-notes 纯函数', () => {
  it('目录常量都在 .zn/ 下（内核天然跳过 ⇒ 不进文件树 / 搜索 / 回收站）', () => {
    expect(PRIVATE_DIR.startsWith('.zn/')).toBe(true)
    expect(NOTES_DIR.startsWith('.zn/')).toBe(true)
    expect(INDEX_FILE.startsWith('.zn/')).toBe(true)
  })

  it('notePath 拼在 notes 目录下，扩展名 .zn', () => {
    expect(notePath('abc')).toBe(`${NOTES_DIR}/abc.zn`)
  })

  it('newNoteId 只含 base36 字符（文件名不能有路径分隔符 / 标题）', () => {
    const ids = new Set()
    for (let i = 0; i < 50; i++) {
      const id = newNoteId()
      expect(id).toMatch(/^[0-9a-z]{8,16}$/)
      ids.add(id)
    }
    // 同一毫秒里 50 次也不该撞（随机尾巴 4 位）
    expect(ids.size).toBeGreaterThan(45)
  })

  it('parseIndex 接受合法索引（并补齐缺省字段）', () => {
    const idx = parseIndex(
      JSON.stringify({
        v: INDEX_VERSION,
        notes: [
          { id: 'a', title: '甲', createdAt: 1, updatedAt: 2 },
          { id: 'b' }, // 缺字段也收，补默认值
          { title: '没有 id' }, // 没有 id 的条目丢弃
        ],
      }),
    )
    expect(idx.notes).toHaveLength(2)
    expect(idx.notes[1]).toEqual({ id: 'b', title: '', createdAt: 0, updatedAt: 0 })
  })

  it('parseIndex 对损坏内容**抛错**（绝不当成空库 —— 否则下次保存会盖掉真数据）', () => {
    expect(() => parseIndex('not json')).toThrow(/不是合法 JSON/)
    expect(() => parseIndex(JSON.stringify({ v: 99, notes: [] }))).toThrow(/格式不认识/)
    expect(() => parseIndex(JSON.stringify({ v: INDEX_VERSION }))).toThrow(/格式不认识/)
    expect(() => parseIndex(JSON.stringify(null))).toThrow(/格式不认识/)
  })

  it('serializeIndex / parseIndex 往返一致', () => {
    const idx = {
      v: INDEX_VERSION,
      notes: [{ id: 'x', title: '标题', createdAt: 10, updatedAt: 20 }],
    }
    expect(parseIndex(serializeIndex(idx))).toEqual(idx)
  })

  it('sortNotes 按更新时间降序且稳定', () => {
    const notes = [
      { id: 'a', title: '', createdAt: 0, updatedAt: 100 },
      { id: 'b', title: '', createdAt: 0, updatedAt: 300 },
      { id: 'c', title: '', createdAt: 0, updatedAt: 200 },
    ]
    expect(sortNotes(notes).map((n) => n.id)).toEqual(['b', 'c', 'a'])
    // 不改原数组
    expect(notes.map((n) => n.id)).toEqual(['a', 'b', 'c'])
    // 同一时间按 id 兜底（稳定，不随机）
    const same = sortNotes([
      { id: 'z', title: '', createdAt: 0, updatedAt: 5 },
      { id: 'a', title: '', createdAt: 0, updatedAt: 5 },
    ])
    expect(same.map((n) => n.id)).toEqual(['a', 'z'])
  })

  it('titleFromText：取第一个标题行；没有标题取首行；空内容给「未命名」', () => {
    expect(titleFromText('# 我的私密\n\n正文')).toBe('我的私密')
    expect(titleFromText('## 二级标题')).toBe('二级标题')
    expect(titleFromText('直接一行正文\n第二行')).toBe('直接一行正文')
    expect(titleFromText('- 列表项')).toBe('列表项')
    expect(titleFromText('')).toBe('未命名')
    expect(titleFromText('   \n\n')).toBe('未命名')
    expect(titleFromText('#')).toBe('#')
  })

  it('标题过长会截断（列表里不该被一整段正文撑爆）', () => {
    const long = '# ' + '很长'.repeat(100)
    expect(titleFromText(long).length).toBe(120)
  })

  it('upsertNote 新增 / 覆盖同 id / 不重复', () => {
    let idx = emptyIndex()
    idx = upsertNote(idx, { id: 'a', title: '一', createdAt: 1, updatedAt: 1 })
    idx = upsertNote(idx, { id: 'b', title: '二', createdAt: 2, updatedAt: 2 })
    expect(idx.notes).toHaveLength(2)
    idx = upsertNote(idx, { id: 'a', title: '一改', createdAt: 1, updatedAt: 9 })
    expect(idx.notes).toHaveLength(2)
    expect(findNote(idx, 'a')?.title).toBe('一改')
    expect(findNote(idx, 'zzz')).toBe(null)
  })

  it('removeNote 只删指定那篇', () => {
    let idx = upsertNote(emptyIndex(), { id: 'a', title: '', createdAt: 0, updatedAt: 0 })
    idx = upsertNote(idx, { id: 'b', title: '', createdAt: 0, updatedAt: 0 })
    idx = removeNote(idx, 'a')
    expect(idx.notes.map((n) => n.id)).toEqual(['b'])
    // 删不存在的 id 不报错
    expect(removeNote(idx, 'nope').notes).toHaveLength(1)
  })

  it('hasNotesRing 只认 rings.notes（secrets 环不算、坏 JSON 不算）', () => {
    expect(hasNotesRing(JSON.stringify({ rings: { notes: { kdf: {} } } }))).toBe(true)
    expect(hasNotesRing(JSON.stringify({ rings: { secrets: { kdf: {} } } }))).toBe(false)
    expect(hasNotesRing(JSON.stringify({ rings: {} }))).toBe(false)
    expect(hasNotesRing('坏 JSON')).toBe(false)
    expect(hasNotesRing('')).toBe(false)
  })
})
