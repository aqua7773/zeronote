/**
 * 42 个示例插件的 manifest 全部仍能加载（UI 重布局 B6 验收 · 方案 §6）。
 *
 * 这不是「跑一遍插件代码」—— 那是 CDP 实测的事。这里锁的是**契约层**：
 * manifest 的形状 / 入口文件 / `location` 合法性在 B6（`sidebar` 语义收口）之后没有一条被改坏。
 * 任何一条挂了，装插件时会在扫描阶段静默跳过（“插件列表里少了一个”），所以值得自动化。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const examplesDir = join(root, 'examples')

/** 与 `src/kernel/contract.ts` 的 `PanelLocation` 保持一致（B6 后仍是 6 类） */
const LOCATIONS = ['sidebar', 'main', 'statusbar', 'modal', 'editor-toolbar', 'editor-topbar']

type Manifest = {
  manifestVersion?: number
  id?: string
  name?: string
  version?: string
  apiVersion?: string
  entry?: string
  /** 纯样式插件（主题）用它 —— 与 `entry` 二选一 */
  styles?: string[]
  platforms?: string[]
  capabilities?: string[]
  contributes?: {
    commands?: { id?: string; title?: string }[]
    panels?: { id?: string; title?: string; location?: string }[]
  }
}

const dirs = readdirSync(examplesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(examplesDir, d.name, 'manifest.json')))
  .map((d) => d.name)

const loaded = dirs.map((name) => {
  const raw = readFileSync(join(examplesDir, name, 'manifest.json'), 'utf8')
  return { dir: name, manifest: JSON.parse(raw) as Manifest }
})

describe('examples/*/manifest.json（B6 契约回归）', () => {
  it('示例目录数量与 manifest 数一致（每个插件都有 manifest）', () => {
    const allDirs = readdirSync(examplesDir, { withFileTypes: true }).filter((d) => d.isDirectory())
    expect(loaded.length).toBe(allDirs.length)
    expect(loaded.length).toBeGreaterThanOrEqual(39)
  })

  it('id / name / version / apiVersion / entry 齐全；id 全局唯一', () => {
    const ids = new Set<string>()
    for (const { dir, manifest } of loaded) {
      /* 目录名 == id 不强制：示例目录可以为了可读性改名（`doc-edit-probe` 的 id 是 `docprobe`）。
         真正要紧的是 id 非空且全局唯一 —— 两个插件同 id 会互相覆盖。 */
      expect(manifest.id, `${dir}: id`).toBeTruthy()
      ids.add(manifest.id as string)
      expect(manifest.name, `${dir}: name`).toBeTruthy()
      expect(manifest.version, `${dir}: version`).toMatch(/^\d+\.\d+\.\d+$/)
      expect(manifest.apiVersion, `${dir}: apiVersion`).toMatch(/^\^?\d+\.\d+\.\d+$/)
      /* `entry`（JS）与 `styles`（纯 CSS 主题）二选一：给哪个就校验哪个的文件存在 */
      if (manifest.entry) {
        expect(
          existsSync(join(examplesDir, dir, manifest.entry)),
          `${dir}: 入口文件存在`,
        ).toBe(true)
      }
      for (const css of manifest.styles ?? []) {
        expect(existsSync(join(examplesDir, dir, css)), `${dir}: 样式文件存在（${css}）`).toBe(true)
      }
      expect(Boolean(manifest.entry) || (manifest.styles?.length ?? 0) > 0, `${dir}: entry 或 styles`).toBe(
        true,
      )
    }
    expect(ids.size).toBe(loaded.length)
  })

  it('面板 location 全部落在 6 类合法值里（B6 后仍无新增值）', () => {
    for (const { dir, manifest } of loaded) {
      for (const panel of manifest.contributes?.panels ?? []) {
        expect(panel.id, `${dir}: panel id`).toBeTruthy()
        expect(panel.title, `${dir}: panel title`).toBeTruthy()
        expect(LOCATIONS, `${dir}: ${panel.id} location`).toContain(panel.location)
      }
    }
  })

  it('命令 id 唯一且带标题（同名命令会让后注册的覆盖前一个，静默丢功能）', () => {
    for (const { dir, manifest } of loaded) {
      const ids = (manifest.contributes?.commands ?? []).map((c) => c.id)
      expect(new Set(ids).size, `${dir}: 命令 id 不重复`).toBe(ids.length)
      for (const c of manifest.contributes?.commands ?? []) {
        expect(c.id, `${dir}: command id`).toBeTruthy()
        expect(c.title, `${dir}: ${c.id} title`).toBeTruthy()
      }
    }
  })

  it('import-export 已按 B6 改成 main（完整工具页不是侧栏小部件）', () => {
    const io = loaded.find((x) => x.dir === 'import-export')
    expect(io?.manifest.contributes?.panels?.[0]?.location).toBe('main')
    expect(io?.manifest.capabilities).toContain('view:main')
  })

  it('仍有 sidebar 示例覆盖真载体（hello / raw-ipc-probe）', () => {
    const withSidebar = loaded.filter((x) =>
      (x.manifest.contributes?.panels ?? []).some((p) => p.location === 'sidebar'),
    )
    expect(withSidebar.map((x) => x.dir).sort()).toEqual(['hello-plugin', 'raw-ipc-probe'])
  })

  /**
   * 密码类字段必须 `secret: true`（rev173.275 · 真人使用测试 #14）。
   *
   * 用户实测：WebDAV 保存后密码一直明文摊在输入框里。契约早就支持密码框
   * （`input.secret`，rev173.163 为 `secrets` 加的），只是那时的同步插件没用。
   *
   * rev173.288：四个后端并进 `sync` 一个插件 ⇒ 三处密码 / 密钥 / 令牌都在这份源码里。
   */
  it('同步插件的密码 / 密钥 / 令牌字段用 secret（不明文显示）', () => {
    const src = readFileSync(join(examplesDir, 'sync', 'index.cjs'), 'utf8')
    const cases: [string, string][] = [
      ['sync', "bind: 'sync.password'"],
      ['sync', "bind: 'sync.s3.secret'"],
      ['sync', "bind: 'sync.git.token'"],
    ]
    for (const [id, bind] of cases) {
      const line = src.split('\n').find((l) => l.includes(bind))
      expect(line, `${id} 里找不到字段 ${bind}`).toBeTruthy()
      expect(line, `${id} 的 ${bind} 还是明文 input`).toContain('secret: true')
    }
  })
})
