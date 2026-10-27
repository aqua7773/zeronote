import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TOOLS } from '../examples/ai/index.js'

/**
 * 工具名的格式约束（rev173.205 的教训）。
 *
 * DeepSeek 的 function name 必须匹配 `^[a-zA-Z0-9_-]+$`，点号会被 400 拒掉
 * （原文：`Invalid 'tools[5].function.name': string does not match pattern`）。
 * rev197–203 全走本地 mock，而 mock 不校验名字格式，于是 12 个带点号的工具名
 * 一直躲到用户给真 Key 才暴露 —— 这里把约束钉成测试。
 *
 * 顺带钉住两件同源的事（改名的漏网之鱼）：
 * · 执行器（`runTool` 里的 if 链）认的名字必须与发给模型的 `TOOLS` 完全一致，
 *   否则模型调 A、执行器只认 B ⇒「未知工具」，对话看起来正常却什么也没做成；
 * · 发给模型的描述文本里不许再出现点号旧名 —— 模型会照着描述传参，等于教错。
 */
const NAME_RE = /^[a-zA-Z0-9_-]+$/
const OLD_DOTTED = /\b(?:note|tag|task|folder)\.(?:create|write|move|trash|add|remove|update|delete|list|run)\b/

const toolNames = TOOLS.map((t) => t.function.name)

/** 从源码里摘出 `runTool` 的函数体（以缩进 4 的闭合括号为界） */
function runToolBody() {
  const src = readFileSync(new URL('../examples/ai/index.js', import.meta.url), 'utf8')
  const start = src.indexOf('async function runTool(')
  expect(start).toBeGreaterThan(-1)
  const end = src.indexOf('\n    }\n', start)
  expect(end).toBeGreaterThan(start)
  return src.slice(start, end)
}

describe('AI 工具名', () => {
  it('全部匹配服务商允许的字符集（^[a-zA-Z0-9_-]+$）', () => {
    const bad = toolNames.filter((n) => !NAME_RE.test(n))
    expect(bad).toEqual([])
  })

  it('工具名唯一', () => {
    expect(new Set(toolNames).size).toBe(toolNames.length)
  })

  it('执行器认识每一个工具，且没有多余分支', () => {
    // 只认裸 `name === '...'`（排除 `s.name === 'string'` 这类属性比较）
    const branches = [...runToolBody().matchAll(/(?<![.\w])name === '([^']+)'/g)].map((m) => m[1])
    expect(branches.length).toBeGreaterThan(0)
    expect([...new Set(branches)].sort()).toEqual([...toolNames].sort())
  })

  it('发给模型的描述文本里没有点号旧名', () => {
    const hits = JSON.stringify(TOOLS).match(OLD_DOTTED) ?? []
    expect(hits).toEqual([])
  })
})
