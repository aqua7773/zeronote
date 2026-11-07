/**
 * 同步 · 私有文件动态清单（rev173.418）
 *
 * 需求：**自定义密钥环也要能跨设备同步**（rev173.414 起「自定义环暂不同步」是遗留）。
 * 关键约束：只放行 `.zn/security/vault.<环id>.json`；`grants.json`（授权表）是本机
 * 信任关系，绝不上云（2026-11-07 用户拍板）。
 */
import { describe, expect, it } from 'vitest'

import core from '../examples/sync/lib/core.cjs'

const { privateFilesFor, PRIVATE_FILES } = core as {
  privateFilesFor: (arg?: { local?: string[]; remote?: string[] }) => string[]
  PRIVATE_FILES: string[]
}

describe('sync · 私有文件动态清单', () => {
  it('没有自定义环 ⇒ 就是内置四条（顺序不变）', () => {
    expect(privateFilesFor()).toEqual(PRIVATE_FILES)
    expect(privateFilesFor({ local: [], remote: [] })).toEqual(PRIVATE_FILES)
  })

  it('本地扫到的自定义环被追加在后（按 id 排序）', () => {
    const out = privateFilesFor({ local: ['vault.todo.json', 'vault.work-2.json'] })
    expect(out.slice(0, PRIVATE_FILES.length)).toEqual(PRIVATE_FILES)
    expect(out.slice(PRIVATE_FILES.length)).toEqual([
      '.zn/security/vault.todo.json',
      '.zn/security/vault.work-2.json',
    ])
  })

  it('远端 manifest 独有的也纳入（新设备本地没有时靠它拉下来）', () => {
    const out = privateFilesFor({ remote: ['.zn/security/vault.todo.json'] })
    expect(out).toContain('.zn/security/vault.todo.json')
  })

  it('白名单：grants.json / 任意文件 / 非法环 id 一律不收', () => {
    const out = privateFilesFor({
      local: [
        'grants.json',
        '.zn/security/grants.json',
        'vault.json', // 旧单文件已在内置里，不重复
        'vault.BAD.json', // 大写不在字符集里
        'vault.secrets.txt',
        'vault.secrets.json.bak',
        'device-key.json',
      ],
      remote: ['grants.json', 'vault.notes.json'],
    })
    expect(out).toEqual(PRIVATE_FILES)
  })

  it('本地与远端同一个环 ⇒ 去重；输入可带目录前缀也可只给文件名', () => {
    const out = privateFilesFor({
      local: ['.zn/security/vault.todo.json'],
      remote: ['vault.todo.json'],
    })
    expect(out.filter((p: string) => p === '.zn/security/vault.todo.json')).toHaveLength(1)
  })
})
