/**
 * vitest 全局 setup（2026-11-03 审计 3.9）。
 *
 * 组件测试（文件头 `// @vitest-environment happy-dom`）必须在每个用例后卸载 DOM，
 * 否则前一个用例的节点会漏进后一个（`screen.getByText` 命中两个、`getByRole` 报重）。
 * 原来靠各测试文件自己写 `afterEach(cleanup)`，37 个文件里有 11 个漏写 ⇒ 这里统一兜底，
 * 新写的组件测试不用再记得加。
 *
 * 为什么动态 import：纯逻辑测试跑在 `node` 环境，那里没有 document；
 * 静态 import `@testing-library/react` 会把 happy-dom 相关依赖一起拉进来，
 * 让只测纯函数的用例也付这份代价（还会在某些 CI 上因为缺 DOM 全局而报错）。
 */
import { afterEach } from 'vitest'

afterEach(async () => {
  if (typeof document === 'undefined') return
  const { cleanup } = await import('@testing-library/react')
  cleanup()
})
