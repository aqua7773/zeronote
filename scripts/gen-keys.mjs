#!/usr/bin/env node
/**
 * ZeroNote 键位表生成器（2026-10-20）
 *
 * 从两处代码扫描键位声明，生成 docs/键位表.md：
 *   1. `src/App.tsx` —— 内核命令注册（`keybinding: 'Mod+S'`）
 *   2. `src/kernel/markdown-marks.ts` —— 12 条 Markdown 标记命令
 *
 * 键位格式按契约写 `Mod+`（一份声明跨平台），显示时落成 Ctrl / ⌘。
 * 不进命令表的按键（Tab / Esc / 返回键 / 粘贴）在 docs/UI交互规范.md 里维护。
 *
 * 用法：
 *   node scripts/gen-keys.mjs --write
 *   node scripts/gen-keys.mjs --check
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const OUT = 'docs/键位表.md'
const CHECK = process.argv.includes('--check')

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

const appSrc = read('src/App.tsx')
const marksSrc = read('src/kernel/markdown-marks.ts')

const core = [...appSrc.matchAll(/id:\s*'(core\.[^']+)',\s*title:\s*'([^']+)',\s*keybinding:\s*'([^']+)'/g)].map((m) => ({
  id: m[1],
  title: m[2],
  key: m[3],
}))
const marks = [...marksSrc.matchAll(/\{\s*id:\s*'(core\.mark\.[^']+)',\s*name:\s*'([^']+)'[^}]*?keybinding:\s*'([^']+)'/g)].map((m) => ({
  id: m[1],
  title: m[2],
  key: m[3],
}))

const win = (k) => k.replace(/Mod/g, 'Ctrl')
const mac = (k) => k.replace(/Mod/g, '⌘')

const table = (rows) => [
  '| 命令 | 名称 | Windows / Linux | macOS |',
  '|---|---|---|---|',
  ...rows.map((r) => `| \`${r.id}\` | ${r.title} | ${win(r.key)} | ${mac(r.key)} |`),
]

const md = [
  '# 键位表（自动生成）',
  '',
  '> 状态：**generated** ｜来源：`src/App.tsx`（内核命令）+ `src/kernel/markdown-marks.ts`（标记命令）｜生成：`node scripts/gen-keys.mjs --write`（勿手改）',
  '> 键位在契约里一律写 `Mod+`，Windows 显示 `Ctrl`、macOS 显示 `⌘`；不进命令表的按键（`Ctrl+Tab` / `Esc` / 返回键 / 粘贴图片）见 `docs/UI交互规范.md`。',
  '',
  `## 内核命令（${core.length} 条，\`src/App.tsx\`）`,
  '',
  ...table(core),
  '',
  `## Markdown 标记命令（${marks.length} 条，\`src/kernel/markdown-marks.ts\`）`,
  '',
  ...table(marks),
  '',
  '## 说明',
  '',
  '- 这些键位由 `bindCommandKeybindings`（`src/kernel/keybindings.ts`）统一绑定；插件命令只要在 `contributes.commands` 里写 `keybinding` 就自动生效。',
  '- 命令执行统一走命令表 ⇒ 键位、命令面板、右键菜单、手机菜单是**同一条执行链**，不会出现「菜单能点、键位无效」。',
  '',
].join('\n')

if (CHECK) {
  const current = fs.existsSync(path.join(root, OUT)) ? read(OUT) : ''
  if (current !== md) {
    console.error(`❌ 键位表已漂移（生成 ${core.length}+${marks.length} 条）：跑 node scripts/gen-keys.mjs --write`)
    process.exit(1)
  }
  console.log(`✅ 键位表：${core.length} 条内核 + ${marks.length} 条标记，与代码一致`)
  process.exit(0)
}

fs.writeFileSync(path.join(root, OUT), md, 'utf8')
console.log(`✅ 已生成 ${OUT}：${core.length} 条内核 + ${marks.length} 条标记`)
