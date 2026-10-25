/**
 * 密码库插件（`examples/secrets`）纯逻辑单测 —— rev173.163 期 1b
 *
 * 只测不依赖宿主的部分：密码生成 / 搜索语义 / 回收站生命周期 / 容错归一化。
 * UI、落盘、剪贴板、crypto 服务留给 CDP 实测（那些要真 WebView + 真 Argon2）。
 *
 * 覆盖原则（`docs/开发约定.md` §4）：每条正向断言都要配一条**反向用例** ——
 * 最容易写错的是「搜索把密码也搜了」和「回收站到期不清理」，两条都单独立用例。
 */
import { describe, expect, it } from 'vitest'
import {
  ALPHABET,
  PASSWORD_LEN,
  TRASH_TTL_MS,
  activeAccounts,
  addAccount,
  addPlatform,
  daysLeft,
  describeDb,
  emptyDb,
  findAccount,
  generatePassword,
  maskSecret,
  matchesAccount,
  matchesPlatform,
  normalizeDb,
  purgeAccount,
  purgeExpired,
  renamePlatform,
  restoreAccount,
  trashAccount,
  trashList,
  updateAccount,
  visibleTree,
} from '../examples/secrets/index.js'

/** 确定性随机源（LCG）：给测试一个可复现的 `randInt` 注入 */
function makeRand(seed = 12345) {
  let s = seed >>> 0
  return (n: number) => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s % n
  }
}

/** 造一棵最小的库 */
function sampleDb() {
  const db = emptyDb()
  const now = 1_793_000_000_000
  const gh = addPlatform(db, { name: 'GitHub', site: 'github.com', now, id: 'p_gh' })
  addAccount(db, gh.id, {
    account: 'aqua@example.com',
    password: 'Sup3r-Secret-PW',
    note: '工作账号',
    now,
    id: 'a_1',
  })
  addAccount(db, gh.id, { account: 'aqua-bot', password: 'BotPW-999', note: '', now, id: 'a_2' })
  const bank = addPlatform(db, { name: '银行', site: 'bank.example', now, id: 'p_bank' })
  addAccount(db, bank.id, { account: '6222', password: 'BankPW-777', note: '工资卡', now, id: 'a_3' })
  return db
}

describe('密码生成器（需求 §8.6）', () => {
  it('默认 16 位，且只含大小写与数字', () => {
    const pw = generatePassword()
    expect(pw).toHaveLength(PASSWORD_LEN)
    expect(pw).toMatch(/^[A-Za-z0-9]+$/)
  })

  it('排除易混字符 0 / O / 1 / l / I', () => {
    // 生成 200 个，一个都不许出现（单次生成可能恰好不含，所以测样本集合）
    for (let i = 0; i < 200; i++) {
      const pw = generatePassword(24, makeRand(i + 1))
      expect(pw).not.toMatch(/[0O1lI]/)
    }
    // 反向：字符集本身也不含（防止"生成时才过滤"的实现遗漏）
    expect(ALPHABET.lower + ALPHABET.upper + ALPHABET.digit).not.toMatch(/[0O1lI]/)
  })

  it('至少各有一个小写 / 大写 / 数字', () => {
    for (let i = 0; i < 100; i++) {
      const pw = generatePassword(16, makeRand(i + 7))
      expect(pw).toMatch(/[a-z]/)
      expect(pw).toMatch(/[A-Z]/)
      expect(pw).toMatch(/[2-9]/)
    }
  })

  it('洗牌生效：固定随机源下，前三位的次序也不是"小写·大写·数字"', () => {
    // 若不洗牌，恒 0 的 randInt 会给出 [a, A, 2, ...]
    expect(generatePassword(5, () => 0).slice(0, 3)).not.toBe('aA2')
  })

  it('长度参数生效；过短的请求被抬到 5（三类都要容身）', () => {
    expect(generatePassword(32, makeRand(9))).toHaveLength(32)
    expect(generatePassword(1, makeRand(9)).length).toBeGreaterThanOrEqual(5)
  })

  it('同一随机源可复现（注入式随机真的被用上了）', () => {
    expect(generatePassword(16, makeRand(42))).toBe(generatePassword(16, makeRand(42)))
  })
})

describe('搜索语义（需求 §8.6：只搜平台 / 账号 / 备注，不搜密码）', () => {
  it('平台名命中 ⇒ 显示该平台全部账号', () => {
    const tree = visibleTree(sampleDb(), 'git')
    expect(tree).toHaveLength(1)
    expect(tree[0].platform.name).toBe('GitHub')
    expect(tree[0].accounts).toHaveLength(2)
  })

  it('账号命中 ⇒ 只显示命中的那个账号', () => {
    const tree = visibleTree(sampleDb(), 'bot')
    expect(tree).toHaveLength(1)
    expect(tree[0].accounts.map((a: { account: string }) => a.account)).toEqual(['aqua-bot'])
  })

  it('备注命中', () => {
    const tree = visibleTree(sampleDb(), '工资卡')
    expect(tree).toHaveLength(1)
    expect(tree[0].accounts[0].account).toBe('6222')
  })

  it('**密码不参与搜索** —— 拿密码当关键词必须零结果', () => {
    const db = sampleDb()
    expect(visibleTree(db, 'Sup3r')).toHaveLength(0)
    expect(visibleTree(db, 'BankPW')).toHaveLength(0)
    // 正向对照：同样的字符串出现在账号里就能搜到
    const withAccount = sampleDb()
    addAccount(withAccount, 'p_gh', { account: 'Sup3rUser', password: 'x', id: 'a_x' })
    expect(visibleTree(withAccount, 'Sup3r')).toHaveLength(1)
  })

  it('搜索词前后空格被忽略、大小写不敏感', () => {
    expect(visibleTree(sampleDb(), '  GITHUB  ')).toHaveLength(1)
  })

  it('**没有账号的平台也要显示**（rev173.163 实测：过滤掉会导致"新建平台后列表里什么都没有"）', () => {
    const db = sampleDb()
    addPlatform(db, { name: '空平台', id: 'p_empty' })
    const names = visibleTree(db, '').map((x: { platform: { name: string } }) => x.platform.name)
    expect(names).toContain('空平台')
    expect(visibleTree(db, '').find((x: { platform: { id: string } }) => x.platform.id === 'p_empty').accounts).toEqual(
      [],
    )
  })

  it('搜索时空平台不占位（除非平台名/站点命中）', () => {
    const db = sampleDb()
    addPlatform(db, { name: '空平台', id: 'p_empty' })
    expect(visibleTree(db, 'git').map((x: { platform: { name: string } }) => x.platform.name)).toEqual(['GitHub'])
    expect(visibleTree(db, '空平台').map((x: { platform: { name: string } }) => x.platform.name)).toEqual(['空平台'])
  })

  it('按平台名排序走 zh locale（中文不会排到最后）', () => {
    const db = emptyDb()
    for (const [name, id] of [['工作', 'p1'], ['会议', 'p2'], ['项目', 'p3']] as const) {
      const p = addPlatform(db, { name, id })
      addAccount(db, p.id, { account: 'u', password: 'p', id: `a_${id}` })
    }
    expect(visibleTree(db, '').map((x: { platform: { name: string } }) => x.platform.name)).toEqual([
      '工作',
      '会议',
      '项目',
    ])
  })

  it('matchesPlatform / matchesAccount 对空查询恒真', () => {
    expect(matchesPlatform({ name: 'x' }, '')).toBe(true)
    expect(matchesAccount({ account: 'x' }, '')).toBe(true)
  })
})

describe('回收站生命周期（需求 §8.6：独立回收站，7 天删除）', () => {
  it('软删除后不在活跃列表里，但在回收站里', () => {
    const db = sampleDb()
    const now = 1_793_100_000_000
    trashAccount(db, 'p_gh', 'a_1', now)
    expect(activeAccounts(db.platforms[0]).map((a: { id: string }) => a.id)).not.toContain('a_1')
    expect(trashList(db)).toHaveLength(1)
    expect(trashList(db)[0].account.id).toBe('a_1')
    expect(visibleTree(db, '').find((x: { platform: { id: string } }) => x.platform.id === 'p_gh').accounts).toHaveLength(1)
  })

  it('恢复后回到活跃列表、回收站清空', () => {
    const db = sampleDb()
    trashAccount(db, 'p_gh', 'a_1', 1000)
    restoreAccount(db, 'p_gh', 'a_1', 2000)
    expect(trashList(db)).toHaveLength(0)
    expect(findAccount(db, 'p_gh', 'a_1')?.deletedAt).toBeNull()
  })

  it('到期才清：6 天 23 小时还在，7 天多一点就没了', () => {
    const db = sampleDb()
    const deletedAt = 1_000_000_000_000
    trashAccount(db, 'p_gh', 'a_1', deletedAt)

    const almost = purgeExpired(db, deletedAt + TRASH_TTL_MS - 1000)
    expect(almost).toBe(0)
    expect(trashList(db)).toHaveLength(1)

    const expired = purgeExpired(db, deletedAt + TRASH_TTL_MS + 1000)
    expect(expired).toBe(1)
    expect(trashList(db)).toHaveLength(0)
    // 反向：同一平台下别的账号不能被顺手清掉
    expect(findAccount(db, 'p_gh', 'a_2')).not.toBeNull()
  })

  it('activeAccount 里未删除的账号不会被到期清理误伤', () => {
    const db = sampleDb()
    expect(purgeExpired(db, 9_999_999_999_999)).toBe(0)
    expect(activeAccounts(db.platforms[0])).toHaveLength(2)
  })

  it('彻底删除从库里移除，且返回是否真的删了', () => {
    const db = sampleDb()
    expect(purgeAccount(db, 'p_gh', 'a_1')).toBe(true)
    expect(findAccount(db, 'p_gh', 'a_1')).toBeNull()
    expect(purgeAccount(db, 'p_gh', 'a_1')).toBe(false) // 幂等：再删一次是 false
  })

  it('daysLeft 向上取整：剩 1 小时算 1 天，过期算 0', () => {
    const now = 1_000_000_000_000
    expect(daysLeft(now + 60 * 60 * 1000, now)).toBe(1)
    expect(daysLeft(now + 24 * 60 * 60 * 1000, now)).toBe(1)
    expect(daysLeft(now + 24 * 60 * 60 * 1000 + 1, now)).toBe(2)
    expect(daysLeft(now - 1, now)).toBe(0)
  })
})

describe('增删改与容错归一化', () => {
  it('空库 / 坏数据都不抛错', () => {
    expect(normalizeDb(null).platforms).toEqual([])
    expect(normalizeDb('不是对象').platforms).toEqual([])
    expect(normalizeDb({ platforms: '不是数组' }).platforms).toEqual([])
    expect(normalizeDb({ platforms: [null, 42, { name: 'ok' }] }).platforms).toHaveLength(1)
  })

  it('缺字段补默认值，不丢已有账号', () => {
    const db = normalizeDb({
      platforms: [
        {
          id: 'p1',
          name: 'X',
          accounts: [{ account: 'u', password: 'p' }, { account: 'v' }],
        },
      ],
    })
    expect(db.platforms[0].site).toBe('')
    expect(db.platforms[0].accounts).toHaveLength(2)
    expect(db.platforms[0].accounts[0].note).toBe('')
    expect(db.platforms[0].accounts[0].deletedAt).toBeNull()
    // 缺 id 的账号会被补一个非空 id（否则回收站/编辑全都指向 null）
    expect(typeof db.platforms[0].accounts[1].id).toBe('string')
    expect(db.platforms[0].accounts[1].id.length).toBeGreaterThan(0)
  })

  it('改名只动指定平台，站点可单独更新', () => {
    const db = sampleDb()
    renamePlatform(db, 'p_gh', { name: 'GitHub（公司）', site: 'ghe.corp' })
    expect(db.platforms.find((p: { id: string }) => p.id === 'p_gh').name).toBe('GitHub（公司）')
    expect(db.platforms.find((p: { id: string }) => p.id === 'p_gh').site).toBe('ghe.corp')
    expect(db.platforms.find((p: { id: string }) => p.id === 'p_bank').name).toBe('银行')
  })

  it('updateAccount 只更新给定字段，未给的保持原样', () => {
    const db = sampleDb()
    updateAccount(db, 'p_gh', 'a_1', { password: '新密码' }, 5000)
    const acc = findAccount(db, 'p_gh', 'a_1')
    expect(acc?.password).toBe('新密码')
    expect(acc?.account).toBe('aqua@example.com')
    expect(acc?.note).toBe('工作账号')
    expect(acc?.updatedAt).toBe(5000)
  })

  it('对不存在的平台/账号操作返回 null / false，不抛错', () => {
    const db = sampleDb()
    expect(addAccount(db, '不存在', { account: 'x' })).toBeNull()
    expect(updateAccount(db, 'p_gh', '不存在', { account: 'x' })).toBeNull()
    expect(trashAccount(db, 'p_gh', '不存在')).toBeNull()
    expect(purgeAccount(db, '不存在', 'a_1')).toBe(false)
  })

  it('describeDb 分开数活跃账号与回收站', () => {
    const db = sampleDb()
    trashAccount(db, 'p_gh', 'a_1', 1000)
    expect(describeDb(db)).toEqual({ platforms: 2, accounts: 2, trash: 1 })
  })

  it('maskSecret 不泄露真实长度', () => {
    expect(maskSecret()).toBe(maskSecret())
    expect(maskSecret()).toHaveLength(8)
    expect(maskSecret()).not.toMatch(/[A-Za-z0-9]/)
  })
})
