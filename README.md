# ZeroNote —— 空内核的本地 Markdown 笔记应用

> 一句话：**内核只做四件事**（`.md` 读写 / 编辑 / 本地存储 / 插件宿主），其余功能全是插件，可独立装卸升级。
> 设计文档：`docs\内核契约-v0.1.md` ｜ 交接件：`HANDOFF.md`
> 需求来源：`..\_笔记应用选型\内核需求分析-v0.1.md`

## 技术栈

| 层 | 选型 |
|---|---|
| 壳 | Tauri 2（Rust） |
| 前端 | React 19 + TypeScript + Vite + Tailwind + shadcn/ui |
| 编辑器 | CodeMirror 6（+ decoration 实时预览） |
| 数据 | `.md` + YAML frontmatter；库内相对路径即 ID；原子保存 |
| 插件 | 声明式 UI（宿主渲染）+ 进程内 TS 宿主（v0.1） |
| 许可证 | MIT |

## 目录

```
ZeroNote\
  docs\内核契约-v0.1.md   ← 插件与内核之间唯一的接口（8 原语）
  HANDOFF.md             ← 交接件：目标 / 证据 / 未完成 / 唯一下一步
  （M1 起）src\ src-tauri\ ...
```

## 现状

**需求分析已冻结，契约已起草，代码未开始。** 下一步 = M1 桌面骨架，见 `HANDOFF.md`。
