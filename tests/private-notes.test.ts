/**
 * 私密文件夹插件（`examples/private-notes`）纯逻辑单测 —— rev173.180 期 1 / rev173.181 期 2
 *
 * 只测不依赖宿主的部分：id / 路径 / 索引编解码 / 排序 / 标题提取 / 索引增删 / 环探测 ·
 * 期 2 的回收站索引操作 / 搜索匹配 / 移出文件名。
 * 加解密、面板、codec 注册留给 CDP 实测（那些要真 WebView + 真 Argon2 + 真 Tauri）。
 *
 * 覆盖原则（`docs/开发约定.md` §4）：每条正向断言配一条反向用例 ——
 * 最危险的几条是「索引损坏被当成空库」（下一次保存就把真数据盖掉）、
 * 「标题提取把正文吞了」、「恢复后排序跳变」、「移出文件名以 . 开头（移出去就看不见）」。
 */
import { describe, expect, it } from 'vitest'
import {
  INDEX_FILE,
  INDEX_VERSION,
  NOTES_DIR,
  PRIVATE_DIR,
  TRASH_DIR,
  emptyIndex,
  excerptOf,
  findNote,
  findTrash,
  hasNotesRing,
  moveToTrash,
  newNoteId,
  notePath,
  parseIndex,
  publicPathFor,
  purgeTrashEntry,
  removeNote,
  restoreFromTrash,
  searchNotes,
  serializeIndex,
  sortNotes,
  sortTrash,
  titleFromText,
  trashPath,
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

  it('serializeIndex / parseIndex 往返一致（含 trash 段）', () => {
    const idx = {
      v: INDEX_VERSION,
      notes: [{ id: 'x', title: '标题', createdAt: 10, updatedAt: 20 }],
      trash: [{ id: 'y', title: '删掉的', createdAt: 1, updatedAt: 2, deletedAt: 3 }],
    }
    expect(parseIndex(serializeIndex(idx))).toEqual(idx)
  })

  it('老索引（期 1 写的、没有 trash 段）照旧能读，trash = []', () => {
    const old = JSON.stringify({ v: INDEX_VERSION, notes: [] })
    expect(parseIndex(old).trash).toEqual([])
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

/* ───────────────────────── 期 2：回收站 ───────────────────────── */

describe('private-notes 回收站（索引层面）', () => {
  const seed = () => {
    let idx = emptyIndex()
    idx = upsertNote(idx, { id: 'a', title: '甲', createdAt: 100, updatedAt: 200 })
    idx = upsertNote(idx, { id: 'b', title: '乙', createdAt: 300, updatedAt: 400 })
    return idx
  }

  it('trashPath 在私密回收站目录下（不解密、不碰全局回收站）', () => {
    expect(TRASH_DIR.startsWith('.zn/private/')).toBe(true)
    expect(trashPath('abc')).toBe(`${TRASH_DIR}/abc.zn`)
  })

  it('moveToTrash 把条目从 notes 挪到 trash，并记 deletedAt', () => {
    const idx = moveToTrash(seed(), 'a', 999)
    expect(idx.notes.map((n) => n.id)).toEqual(['b'])
    expect(idx.trash).toHaveLength(1)
    expect(idx.trash[0]).toMatchObject({ id: 'a', title: '甲', createdAt: 100, updatedAt: 200, deletedAt: 999 })
  })

  it('moveToTrash 对不存在的 id 是 no-op（不抛错、不造条目）', () => {
    const idx = seed()
    const out = moveToTrash(idx, 'zzz', 1)
    expect(out.notes).toHaveLength(2)
    expect(out.trash).toHaveLength(0)
  })

  it('restoreFromTrash **无损**：原始时间都在（恢复后排序不会跳）', () => {
    const trashed = moveToTrash(seed(), 'a', 999)
    const back = restoreFromTrash(trashed, 'a')
    expect(back.trash).toHaveLength(0)
    const a = findNote(back, 'a')
    expect(a).toEqual({ id: 'a', title: '甲', createdAt: 100, updatedAt: 200 })
    // 恢复后排序仍按 updatedAt（甲在乙后面）
    expect(sortNotes(back.notes).map((n) => n.id)).toEqual(['b', 'a'])
  })

  it('restoreFromTrash 对回收站里没有的 id 是 no-op', () => {
    const idx = moveToTrash(seed(), 'a', 1)
    const out = restoreFromTrash(idx, 'b')
    expect(out.notes.map((n) => n.id)).toEqual(['b'])
    expect(out.trash).toHaveLength(1)
  })

  it('purgeTrashEntry 只删回收站里那一条（notes 不动）', () => {
    const idx = purgeTrashEntry(moveToTrash(seed(), 'a', 1), 'a')
    expect(idx.trash).toHaveLength(0)
    expect(idx.notes.map((n) => n.id)).toEqual(['b'])
    expect(findTrash(idx, 'a')).toBe(null)
  })

  it('sortTrash 最近删的在前', () => {
    let idx = emptyIndex()
    idx = upsertNote(idx, { id: 'a', title: '甲', createdAt: 0, updatedAt: 0 })
    idx = upsertNote(idx, { id: 'b', title: '乙', createdAt: 0, updatedAt: 0 })
    idx = moveToTrash(idx, 'a', 10)
    idx = moveToTrash(idx, 'b', 20)
    expect(sortTrash(idx.trash).map((t) => t.id)).toEqual(['b', 'a'])
    // 不改原数组
    expect(idx.trash.map((t) => t.id)).toEqual(['a', 'b'])
  })
})

/* ───────────────────────── 期 2：搜索 ───────────────────────── */

describe('private-notes 搜索（内存明文）', () => {
  const notes = [
    { id: 'a', title: '会议记录', createdAt: 0, updatedAt: 0 },
    { id: 'b', title: '购物清单', createdAt: 0, updatedAt: 0 },
    { id: 'c', title: '日记', createdAt: 0, updatedAt: 0 },
  ]
  const plain = new Map([
    ['a', '今天开会讨论了预算和排期'],
    ['b', '牛奶 鸡蛋 面包'],
    ['c', '今天心情不错'],
  ])

  it('多关键词 AND：全部命中才算', () => {
    expect(searchNotes(notes, plain, '今天 开会').map((r) => r.id)).toEqual(['a'])
    expect(searchNotes(notes, plain, '今天').map((r) => r.id).sort()).toEqual(['a', 'c'])
    expect(searchNotes(notes, plain, '今天 面包')).toEqual([])
  })

  it('大小写不敏感（英文关键词）', () => {
    const n = [{ id: 'x', title: 'API', createdAt: 0, updatedAt: 0 }]
    const p = new Map([['x', 'Token 存在 localStorage']])
    expect(searchNotes(n, p, 'token')).toHaveLength(1)
    expect(searchNotes(n, p, 'TOKEN')).toHaveLength(1)
  })

  it('标题命中优先（排在正文命中前面）', () => {
    const n = [
      { id: 'bodyhit', title: '别的事', createdAt: 0, updatedAt: 0 },
      { id: 'titlehit', title: '跑步计划', createdAt: 0, updatedAt: 0 },
    ]
    const p = new Map([
      ['bodyhit', '今天跑步五公里'],
      ['titlehit', '明天开始'],
    ])
    expect(searchNotes(n, p, '跑步').map((r) => r.id)).toEqual(['titlehit', 'bodyhit'])
  })

  it('空查询返回空表（不把全库当结果）', () => {
    expect(searchNotes(notes, plain, '')).toEqual([])
    expect(searchNotes(notes, plain, '   ')).toEqual([])
  })

  it('没解出正文的篇（解码失败）不会误命中', () => {
    const p = new Map([['a', '']])
    expect(searchNotes(notes, p, '开会')).toEqual([])
    // 标题仍然能搜
    expect(searchNotes(notes, p, '会议')).toHaveLength(1)
  })

  it('excerptOf：命中处前后各取一段并加省略号', () => {
    const text = '前言'.repeat(20) + '关键词' + '后记'.repeat(20)
    const ex = excerptOf(text, ['关键词'], 5)
    expect(ex).toContain('关键词')
    expect(ex.startsWith('…')).toBe(true)
    expect(ex.endsWith('…')).toBe(true)
  })

  it('excerptOf：找不到关键词时给开头一段（不是空串）', () => {
    expect(excerptOf('一二三四五', ['找不到'])).toBe('一二三四五')
    expect(excerptOf('', ['x'])).toBe('')
  })
})

/* ───────────────────────── 期 2：移出文件名 ───────────────────────── */

describe('private-notes 移出时的文件名', () => {
  it('清洗 Windows 非法字符', () => {
    expect(publicPathFor('a/b:c*d?"e"f<g>h|i')).toBe('a b c d e f g h i.md')
  })

  it('**不能以 . 开头**（以点开头会被内核当隐藏文件跳过 —— 移出去就看不见）', () => {
    expect(publicPathFor('...秘密')).toBe('秘密.md')
    expect(publicPathFor('..')).toBe('私密笔记.md')
  })

  it('空标题给默认名', () => {
    expect(publicPathFor('')).toBe('私密笔记.md')
    expect(publicPathFor('   ')).toBe('私密笔记.md')
  })

  it('重名自动加序号（大小写不敏感）', () => {
    expect(publicPathFor('标题', [])).toBe('标题.md')
    expect(publicPathFor('标题', ['标题.md'])).toBe('标题-2.md')
    expect(publicPathFor('标题', ['标题.md', '标题-2.md'])).toBe('标题-3.md')
    // 已有文件中大小写不同也算重名（Windows 文件系统不区分）
    expect(publicPathFor('Title', ['title.md'])).toBe('Title-2.md')
  })

  it('标题过长会截断（别造出超过文件系统限制的名字）', () => {
    expect(publicPathFor('长'.repeat(200)).length).toBeLessThanOrEqual(63)
  })
})
