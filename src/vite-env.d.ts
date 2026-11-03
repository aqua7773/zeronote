/// <reference types="vite/client" />

/** 应用版本号 —— 由 vite.config.ts 从 package.json 注入（rev173.37） */
declare const __APP_VERSION__: string

/**
 * 启动兜底标记（rev173.349）：`main.tsx` 在 `createRoot().render()` 之后置为 true，
 * `index.html` 里的内联脚本据此判断「模块真的执行了」。白屏类型 A（模块加载失败 /
 * 返回 500）时这个标记永远不会出现，内联脚本会自动重载一次，再失败就显示错误卡片。
 */
interface Window {
  __znBooted?: boolean
  /** 内联兜底脚本暴露的接口（测试 / 人工排查用） */
  __znBootGuard?: {
    fail: (reason: string) => void
    settled: () => boolean
  }
}
