import { useState } from 'react'
import type { EditorView } from '@codemirror/view'

/**
 * **表格快捷操作**（2026-10-17 用户参考 Typora：对齐按钮 / 调行列 / 表格菜单 + 删除）。
 *
 * atomic 的 table widget 只负责"把 markdown 表格渲染成 DOM + 单元格编辑"，
 * 没有任何表格操作 UI。这里补一层：
 *  · 光标在表格内时，在表格左上角浮出工具条；
 *  · 所有操作都直接改**文档源码**（表格纯文本仍是唯一真相），改完 dispatch 替换整表。
 */

export type TableInfo = {
  /** 表格在文档里的范围 */
  from: number
  to: number
  /** 光标所在行 / 列（相对表格，0 起） */
  row: number
  col: number
  /** 工具条坐标（相对编辑器 DOM） */
  x: number
  y: number
}

type Align = 'left' | 'center' | 'right' | null

/** 把 markdown 表格文本拆成行（不含首尾空行） */
function splitLines(src: string): string[] {
  return src.replace(/\r\n/g, '\n').split('\n')
}

/** 表格的单元格（按 `|` 切，去首尾空） */
function cells(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

function joinCells(cs: string[]): string {
  return `| ${cs.join(' | ')} |`
}

function delimCell(a: Align): string {
  return a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---'
}

function parseAligns(delimLine: string): Align[] {
  return cells(delimLine).map((t) => {
    const left = t.startsWith(':')
    const right = t.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })
}

/** 在 view 上把 [from,to] 换成新文本 */
function replaceTable(view: EditorView, info: TableInfo, lines: string[], keepCursor = true) {
  const insert = lines.join('\n')
  view.dispatch({
    changes: { from: info.from, to: info.to, insert },
    ...(keepCursor ? {} : { selection: { anchor: info.from } }),
  })
}

/** 对齐某一列（0 起） */
function setAlign(view: EditorView, info: TableInfo, col: number, a: Align) {
  const lines = splitLines(view.state.doc.sliceString(info.from, info.to))
  if (lines.length < 2) return
  const aligns = parseAligns(lines[1])
  while (aligns.length <= col) aligns.push(null)
  aligns[col] = a
  lines[1] = joinCells(aligns.map(delimCell))
  replaceTable(view, info, lines)
}

/** 在 cursor 行后面/前面插一行 */
function insertRow(view: EditorView, info: TableInfo, where: 'above' | 'below') {
  const lines = splitLines(view.state.doc.sliceString(info.from, info.to))
  if (lines.length < 2) return
  const colCount = cells(lines[0]).length
  // 表头下方至少是 delimiter 行，所以插行位置从 delimiter 之后算
  const target = Math.max(2, Math.min(lines.length, 2 + info.row - 1 + (where === 'below' ? 1 : 0)))
  lines.splice(target, 0, joinCells(new Array(colCount).fill('')))
  replaceTable(view, info, lines)
}

/** 在 col 列左侧/右侧插一列 */
function insertCol(view: EditorView, info: TableInfo, where: 'left' | 'right') {
  const lines = splitLines(view.state.doc.sliceString(info.from, info.to))
  if (lines.length < 2) return
  const idx = where === 'left' ? info.col : info.col + 1
  const next = lines.map((line) => {
    const cs = cells(line)
    cs.splice(Math.min(idx, cs.length), 0, '')
    return joinCells(cs)
  })
  replaceTable(view, info, next)
}

/** 删除光标所在行（表头行不删） */
function deleteRow(view: EditorView, info: TableInfo) {
  const lines = splitLines(view.state.doc.sliceString(info.from, info.to))
  const idx = 2 + info.row - 1
  if (idx < 2 || idx >= lines.length) return
  lines.splice(idx, 1)
  replaceTable(view, info, lines)
}

/** 删除光标所在列 */
function deleteCol(view: EditorView, info: TableInfo) {
  const lines = splitLines(view.state.doc.sliceString(info.from, info.to))
  if (cells(lines[0]).length <= 1) return
  const next = lines.map((line) => {
    const cs = cells(line)
    if (cs.length > info.col) cs.splice(info.col, 1)
    return joinCells(cs)
  })
  replaceTable(view, info, next)
}

/** 上移 / 下移光标所在行（不动表头与 delimiter 行） */
function moveRow(view: EditorView, info: TableInfo, dir: -1 | 1) {
  const lines = splitLines(view.state.doc.sliceString(info.from, info.to))
  const idx = 2 + info.row - 1
  const target = idx + dir
  if (idx < 2 || target < 2 || target >= lines.length) return
  ;[lines[idx], lines[target]] = [lines[target], lines[idx]]
  replaceTable(view, info, lines)
}

/** 左移 / 右移光标所在列 */
function moveCol(view: EditorView, info: TableInfo, dir: -1 | 1) {
  const lines = splitLines(view.state.doc.sliceString(info.from, info.to))
  const next = lines.map((line) => {
    const cs = cells(line)
    const to = info.col + dir
    if (info.col >= cs.length || to < 0 || to >= cs.length) return line
    ;[cs[info.col], cs[to]] = [cs[to], cs[info.col]]
    return joinCells(cs)
  })
  replaceTable(view, info, next)
}

/**
 * **快捷调整行列数**（2026-10-17 用户澄清：参考图那个网格是调尺寸，不是对齐）——
 * `totalRows` 含表头行（3×3 = 3 列 + 表头 + 2 数据行），现有内容保留、缺的补空。
 */
function resizeTable(view: EditorView, info: TableInfo, totalRows: number, cols: number) {
  const lines = splitLines(view.state.doc.sliceString(info.from, info.to))
  const header = cells(lines[0] ?? '')
  const aligns = cells(lines[1] ?? '')
  const body = lines.slice(2).map(cells)
  const dataRows = Math.max(0, totalRows - 1)
  const next: string[] = [
    joinCells(Array.from({ length: cols }, (_, i) => header[i] ?? '')),
    joinCells(Array.from({ length: cols }, (_, i) => aligns[i] ?? '---')),
  ]
  for (let r = 0; r < dataRows; r++) {
    next.push(joinCells(Array.from({ length: cols }, (_, c) => body[r]?.[c] ?? '')))
  }
  replaceTable(view, info, next)
}

/** 删除整个表格 */
function deleteTable(view: EditorView, info: TableInfo) {
  view.dispatch({ changes: { from: info.from, to: info.to, insert: '' } })
}

/** 复制表格源码到剪贴板 */
async function copyTable(view: EditorView, info: TableInfo) {
  try {
    await navigator.clipboard.writeText(view.state.doc.sliceString(info.from, info.to))
  } catch {
    /* 剪贴板不可用（无权限/HTTP）—— 静默 */
  }
}

/** 表格工具条（浮在表格左上角） */
export function TableToolbar({ view, info }: { view: EditorView | null; info: TableInfo | null }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [sizeOpen, setSizeOpen] = useState(false)
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null)
  if (!view || !info) return null
  const run = (fn: () => void) => () => {
    fn()
    setMenuOpen(false)
  }
  return (
    <div
      className="zn-table-toolbar"
      style={{ left: info.x, top: info.y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        title="调整行列数"
        onClick={() => {
          setSizeOpen((v) => !v)
          setMenuOpen(false)
        }}
      >
        ⊞
      </button>
      <span className="zn-table-sep" />
      <button type="button" title="本列左对齐" onClick={run(() => setAlign(view, info, info.col, 'left'))}>
        左
      </button>
      <button
        type="button"
        title="本列居中"
        onClick={run(() => setAlign(view, info, info.col, 'center'))}
      >
        中
      </button>
      <button type="button" title="本列右对齐" onClick={run(() => setAlign(view, info, info.col, 'right'))}>
        右
      </button>
      <span className="zn-table-sep" />
      <button
        type="button"
        className="zn-table-menu-btn"
        title="表格操作"
        onClick={() => {
          setMenuOpen((v) => !v)
          setSizeOpen(false)
        }}
      >
        ⋮
      </button>
      <button type="button" className="zn-table-menu-btn" title="删除表格" onClick={run(() => deleteTable(view, info))}>
        🗑
      </button>
      {sizeOpen && (
        <div className="zn-table-size-panel">
          <div className="zn-table-size-grid">
            {Array.from({ length: 8 }, (_, r) => (
              <div key={r} className="zn-table-size-row">
                {Array.from({ length: 8 }, (_, c) => (
                  <button
                    key={c}
                    type="button"
                    className={`zn-table-size-cell${
                      hover && r <= hover.r && c <= hover.c ? ' is-hot' : ''
                    }`}
                    onMouseEnter={() => setHover({ r, c })}
                    onMouseLeave={() => setHover(null)}
                    onClick={run(() => {
                      resizeTable(view, info, r + 1, c + 1)
                      setSizeOpen(false)
                    })}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="zn-table-size-label">
            {hover ? `${hover.c + 1} × ${hover.r + 1}` : '拖选行列数'}
          </div>
        </div>
      )}
      {menuOpen && (
        <div className="zn-table-menu">
          <button type="button" onClick={run(() => insertRow(view, info, 'above'))}>
            上方插入行
          </button>
          <button type="button" onClick={run(() => insertRow(view, info, 'below'))}>
            下方插入行
          </button>
          <button type="button" onClick={run(() => insertCol(view, info, 'left'))}>
            左侧插入列
          </button>
          <button type="button" onClick={run(() => insertCol(view, info, 'right'))}>
            右侧插入列
          </button>
          <hr />
          <button type="button" onClick={run(() => deleteRow(view, info))}>
            删除该行
          </button>
          <button type="button" onClick={run(() => deleteCol(view, info))}>
            删除该列
          </button>
          <hr />
          <button type="button" onClick={run(() => moveRow(view, info, -1))}>
            上移该行
          </button>
          <button type="button" onClick={run(() => moveRow(view, info, 1))}>
            下移该行
          </button>
          <button type="button" onClick={run(() => moveCol(view, info, -1))}>
            左移该列
          </button>
          <button type="button" onClick={run(() => moveCol(view, info, 1))}>
            右移该列
          </button>
          <hr />
          <button type="button" onClick={run(() => void copyTable(view, info))}>
            复制表格
          </button>
          <button type="button" onClick={run(() => deleteTable(view, info))}>
            删除表格
          </button>
        </div>
      )}
    </div>
  )
}
