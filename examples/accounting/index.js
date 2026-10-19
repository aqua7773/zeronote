/**
 * ZeroNote 记账插件 v0.1（2026-10-19 rev173.16）
 *
 * 数据流：
 *   原生 NotificationCaptureService（白名单 + 去重 + 缓存）
 *     → 本插件「同步通知」命令调 `plugin:notification-capture|drain`
 *     → parseNotification() 解析金额/收支/商户 → classify() 自动分类
 *     → 跨来源去重（微信 + 银行同金额）→ store 落库
 *
 * 设计：**单文件**（v0.1 的插件经 Blob URL 加载，相对导入解析不了）；
 * 解析/分类写成命名导出，`tests/accounting-parse.test.ts` 直接单测。
 *
 * 平台：手机端是主战场（通知捕获）；桌面可手动记账，`drain` 返回空数组。
 */

const PANEL_ID = 'accounting.ledger'
const STORE_KEY = 'transactions'
/** 用户改分类后学到的「商户 → 分类」（与内置规则分开存，便于以后清空重学） */
const CATEGORY_KEY = 'categoryMap'
/** 用户自定义的分类列表（未设置时用内置 CATEGORIES） */
const CATEGORY_LIST_KEY = 'categories'
const MAX_TX = 500
/** 手动改分类时可选的分类 */
const CATEGORIES = ['餐饮', '交通', '购物', '通讯', '居住', '医疗', '娱乐', '收入', '其他']

/* ───────────────────────── 纯函数（可单测） ───────────────────────── */

const pad = (n) => String(n).padStart(2, '0')

/** 毫秒 → 「YYYY-MM」月份键（统计按自然月分组） */
export function monthKey(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

/** 明显不是账单的通知（验证码、还款提醒、余额播报…）——先杀掉，避免误记 */
const IGNORE = [/验证码/, /已过期/, /已失效/, /已还清/, /还款成功/, /余额/, /账单已出/, /积分/]

const PAY_PHRASES = [
  '付款成功',
  '支付成功',
  '收款到账',
  '转账成功',
  '已支付',
  '已收款',
  '向你转账',
  '向你付款',
  '红包',
  '收款',
  '付款',
  '转账',
  '到账',
  '消费',
  '扣款',
]

const INCOME_WORDS = [
  '到账',
  '收入',
  '收到',
  '收款',
  '转入',
  '进账',
  '红包',
  '退款',
  '已收',
  '已到账',
  '入账',
  '给你转账',
  '转给你',
  '向你付款',
]

const EXPENSE_WORDS = [
  '支付',
  '付款',
  '消费',
  '支出',
  '转出',
  '扣费',
  '已付',
  '扣款',
  '缴费',
  '充值',
  '转账成功',
  '已转账',
]

/** 商户 → 分类（用户 2026-10-19 要「自动分类」；先内置常用商户，后续加学习） */
const MERCHANT_MAP = {
  美团: '餐饮',
  饿了么: '餐饮',
  星巴克: '咖啡',
  瑞幸: '咖啡',
  Manner: '咖啡',
  肯德基: '餐饮',
  麦当劳: '餐饮',
  海底捞: '餐饮',
  滴滴: '交通',
  高德: '交通',
  地铁: '交通',
  公交: '交通',
  加油: '交通',
  中石化: '交通',
  中石油: '交通',
  12306: '交通',
  京东: '购物',
  淘宝: '购物',
  天猫: '购物',
  拼多多: '购物',
  唯品会: '购物',
  盒马: '购物',
  永辉: '购物',
  沃尔玛: '购物',
  中国移动: '通讯',
  中国联通: '通讯',
  中国电信: '通讯',
  话费: '通讯',
  电费: '居住',
  水费: '居住',
  燃气: '居住',
  物业: '居住',
  医院: '医疗',
  药房: '医疗',
  药店: '医疗',
  影院: '娱乐',
  电影: '娱乐',
  腾讯视频: '娱乐',
  爱奇艺: '娱乐',
  工资: '收入',
  奖金: '收入',
  报销: '收入',
}

const KEYWORDS = [
  [/外卖|餐饮|饭店|餐厅|美食|咖啡|奶茶/, '餐饮'],
  [/打车|出行|地铁|公交|加油|机票|火车|高铁|停车/, '交通'],
  [/超市|便利店|购物|商城|京东|淘宝|拼多多|电商/, '购物'],
  [/话费|流量|宽带|中国移动|中国联通|中国电信/, '通讯'],
  [/电费|水费|燃气|物业|房租|家政/, '居住'],
  [/医院|药房|药店|挂号|体检|疫苗/, '医疗'],
  [/电影|影院|游戏|会员|视频/, '娱乐'],
  [/工资|奖金|报销|退款|收款/, '收入'],
]

/** 从一段通知文本里找金额（按优先级，最后才用"带小数的数字"兜底） */
export function extractAmount(text) {
  if (!text) return null
  const patterns = [
    /[¥￥]\s*(\d+(?:\.\d{1,2})?)/,
    /(\d+(?:\.\d{1,2})?)\s*元/,
    /(?:金额|收款|付款|转账|红包|到账|成功)[：:\s]*(\d+(?:\.\d{1,2})?)/,
    /(\d+\.\d{1,2})/,
  ]
  for (const p of patterns) {
    const m = p.exec(text)
    if (!m) continue
    const v = Number(m[1])
    if (Number.isFinite(v) && v > 0) return v
  }
  return null
}

/** 这条通知像不像「一笔交易」 */
export function isPaymentNotice(title, text) {
  const s = `${title || ''} ${text || ''}`
  if (!s.trim()) return false
  if (IGNORE.some((re) => re.test(s))) return false
  const hasPhrase = PAY_PHRASES.some((p) => s.includes(p))
  if (!hasPhrase) return false
  // 有金额，或明确收款/付款/转账/红包 ⇒ 认；只有"红包已领取"这类会被 IGNORE 挡掉
  return extractAmount(s) !== null || /收款|付款|转账|红包/.test(s)
}

/** 收入 / 支出（收入关键词优先，默认支出） */
export function detectType(title, text) {
  const s = `${title || ''}${text || ''}`
  if (INCOME_WORDS.some((w) => s.includes(w))) return 'income'
  if (EXPENSE_WORDS.some((w) => s.includes(w))) return 'expense'
  return 'expense'
}

/** 商户 / 对方名称 —— 匹配不到就用 App 名兜底 */
export function extractMerchant(title, text, app) {
  const s = `${title || ''} ${text || ''}`
  const patterns = [
    /商户[：:]\s*([^，。|\s]{1,20})/,
    /收款方[：:]\s*([^，。|\s]{1,20})/,
    /向(.{1,20}?)付款/,
    /(?:在|于)(.{1,20}?)支付/,
    /(.{1,20}?)订单支付/,
    /给(.{1,20}?)转账/,
    /来自(.{1,20}?)(?:\s|$)/,
  ]
  for (const p of patterns) {
    const m = p.exec(s)
    const v = m && m[1] ? m[1].trim() : ''
    if (v) return v
  }
  const t = (title || '').trim()
  if (t && t.length <= 20 && !/微信|支付宝/.test(t)) return t
  return app || '未知商户'
}

/** 自动分类：用户改过的映射 → 商户表 → 关键词 → 「其他」 */
export function classify(merchant, text, userMap = {}) {
  const m = merchant || ''
  // 学习层：用户在面板里改过一次分类 ⇒ 下次同商户直接命中
  for (const [k, cat] of Object.entries(userMap || {})) {
    if (k && m.includes(k)) return cat
  }
  for (const [k, cat] of Object.entries(MERCHANT_MAP)) {
    if (m.includes(k) || (text || '').includes(k)) return cat
  }
  for (const [re, cat] of KEYWORDS) {
    if (re.test(m) || re.test(text || '')) return cat
  }
  return '其他'
}

/**
 * 通知原文 → 交易记录（不像交易就返回 null）。
 * `n` = `{ pkg, app, title, text, time }`（原生缓存的结构）；
 * `userMap` = 用户改分类后学到的 `商户 → 分类`（可省略）。
 */
export function parseNotification(n, userMap = {}) {
  if (!n || !n.text) return null
  const title = n.title || ''
  const text = n.text || ''
  if (!isPaymentNotice(title, text)) return null
  const amount = extractAmount(text) ?? 0
  const type = detectType(title, text)
  const merchant = extractMerchant(title, text, n.app)
  const time = Number(n.time) || Date.now()
  return {
    id: `tx-${time}-${(n.pkg || 'unknown').split('.').pop()}`,
    amount,
    type,
    merchant,
    category: classify(merchant, text, userMap),
    source: n.app || n.pkg || '通知',
    pkg: n.pkg || '',
    time,
    raw: `${title} | ${text}`.slice(0, 300),
    status: amount > 0 ? 'confirmed' : 'pending',
  }
}

/**
 * 跨来源去重：同金额、同方向、时间窗内（默认 90s）且**来源不同** ⇒ 认为是同一笔
 * （微信支付 + 银行扣款各来一条）。保留先到的那条。
 */
export function dedupeTransactions(list, windowMs = 90000) {
  const out = []
  for (const tx of list) {
    const dup = out.find(
      (x) =>
        x.amount === tx.amount &&
        x.type === tx.type &&
        Math.abs(x.time - tx.time) <= windowMs &&
        x.pkg !== tx.pkg,
    )
    if (!dup) out.push(tx)
  }
  return out
}

/* ───────────────────── 统计（rev173.28）───────────────────── */

/** 某年某月（month 1–12）的**支出**按分类汇总；降序，pct 为占本月支出的比例 */
export function summarizeByCategory(txs, year, month) {
  const key = `${year}-${pad(month)}`
  const list = (txs || []).filter(
    (t) =>
      t &&
      t.type === 'expense' &&
      Number.isFinite(Number(t.amount)) &&
      monthKey(t.time) === key,
  )
  const total = list.reduce((s, t) => s + Number(t.amount), 0)
  const map = new Map()
  for (const t of list) {
    const category = t.category || '其他'
    const row = map.get(category) || { category, amount: 0, count: 0 }
    row.amount += Number(t.amount)
    row.count += 1
    map.set(category, row)
  }
  const rows = [...map.values()].sort((a, b) => b.amount - a.amount)
  return { total, rows: rows.map((r) => ({ ...r, pct: total > 0 ? r.amount / total : 0 })) }
}

/** 近 n 个月（含本月）的支出/收入，按月升序；没有记录的月份补 0 */
export function monthlyTrend(txs, n = 6, now = Date.now()) {
  const base = new Date(now)
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
    const list = (txs || []).filter((t) => t && monthKey(t.time) === key)
    const sum = (type) =>
      list.filter((t) => t.type === type).reduce((s, t) => s + (Number(t.amount) || 0), 0)
    out.push({
      key,
      label: `${d.getMonth() + 1}月`,
      expense: sum('expense'),
      income: sum('income'),
    })
  }
  return out
}

/** SVG 柱状图（近 n 月支出）。颜色全走主题变量，自动跟随深浅色 */
export function trendSvg(trend) {
  const W = 320
  const H = 132
  const padL = 6
  const padR = 6
  const padT = 18
  const padB = 24
  const n = Math.max(1, trend.length)
  const max = Math.max(1, ...trend.map((m) => Number(m.expense) || 0))
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const slot = innerW / n
  const barW = Math.min(26, slot * 0.5)
  const bars = trend
    .map((m, i) => {
      const value = Number(m.expense) || 0
      const x = padL + slot * i + (slot - barW) / 2
      const h = value > 0 ? Math.max(2, (value / max) * innerH) : 0
      const y = padT + innerH - h
      const cx = (x + barW / 2).toFixed(1)
      const label = esc(String(m.label))
      const valueText = value > 0 ? esc(fmtShort(value)) : ''
      return (
        `<g>` +
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(
          1,
        )}" height="${h.toFixed(1)}" rx="3" fill="var(--zn-accent)" opacity="${
          value > 0 ? 0.85 : 0.15
        }" />` +
        (valueText
          ? `<text x="${cx}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--zn-fg-muted)">${valueText}</text>`
          : '') +
        `<text x="${cx}" y="${H - 7}" text-anchor="middle" font-size="9" fill="var(--zn-fg-muted)">${label}</text>` +
        `</g>`
      )
    })
    .join('')
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="auto" style="max-width:480px;display:block" role="img" aria-label="近 ${n} 个月支出趋势">${bars}</svg>`
}

/** 金额缩写：12345.6 → 1.2万；1234 → 1.2k；< 1000 取整 */
function fmtShort(v) {
  const n = Number(v) || 0
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

/** HTML 转义 —— 分类名 / 商户名来自通知原文，html 节点是 innerHTML 直投 */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/* ───────────────────── CSV 导出（rev173.29）───────────────────── */

/** 账单 → CSV（RFC 4180；默认带 UTF-8 BOM，Excel 打开中文不乱码） */
export function toCsv(txs, opts = {}) {
  const bom = opts.bom !== false
  const rows = [['时间', '类型', '金额', '商户', '分类', '来源', '状态']]
  for (const t of txs || []) {
    rows.push([
      fmtDateTime(t.time),
      t.type === 'income' ? '收入' : '支出',
      (Number(t.amount) || 0).toFixed(2),
      t.merchant || '',
      t.category || '',
      t.source || '',
      t.status === 'pending' ? '金额待补' : '已确认',
    ])
  }
  const body = rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
  return (bom ? '\uFEFF' : '') + body + '\r\n'
}

/** CSV 单元格转义：含逗号 / 双引号 / 换行时用双引号包起来，内部引号翻倍 */
function csvCell(v) {
  const s = String(v == null ? '' : v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 毫秒 → 「YYYY-MM-DD HH:mm:ss」（导出用，带年份便于对账） */
function fmtDateTime(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 毫秒 → 「YYYYMMDD」（导出文件名） */
function dateStamp(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

/* ───────────────────── CSV 导入（rev173.30）───────────────────── */

/** 拆一行 CSV（RFC 4180：双引号包裹、内部 `""` 转义） */
function splitCsvLine(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

/** 账单时间「2026-10-19 12:36:06」→ 毫秒（本地时区；解析不出返回 0） */
function parseBillTime(s) {
  const m = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(
    String(s || ''),
  )
  if (!m) return 0
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime()
}

/**
 * 解析**微信 / 支付宝**导出的账单 CSV（两家表头都含「交易时间 / 交易对方 / 收/支」）。
 * 返回 `{ ok, source, rows, reason }`；「/」（不计收支）与金额解析失败的行跳过。
 */
export function parseBillCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '')
  const lines = src.split(/\r?\n/)
  const headerIdx = lines.findIndex(
    (l) => /交易时间/.test(l) && /交易对方/.test(l) && /(收\/支|收支)/.test(l),
  )
  if (headerIdx < 0) {
    return {
      ok: false,
      source: '',
      rows: [],
      reason: '不是可识别的账单（表头需含「交易时间 / 交易对方 / 收/支」）',
    }
  }
  const header = splitCsvLine(lines[headerIdx]).map((h) => h.replace(/\s/g, ''))
  const col = (...names) => {
    for (const n of names) {
      const i = header.findIndex((h) => h.includes(n))
      if (i >= 0) return i
    }
    return -1
  }
  const iTime = col('交易时间')
  const iCounter = col('交易对方')
  const iGoods = col('商品')
  const iDir = col('收/支', '收支')
  const iAmount = col('金额')
  const iNo = col('交易单号', '交易订单号')
  if (iTime < 0 || iDir < 0 || iAmount < 0) {
    return { ok: false, source: '', rows: [], reason: '账单缺少必要列（交易时间 / 收/支 / 金额）' }
  }
  const source = /微信支付账单|微信支付|微信昵称/.test(src.slice(0, 4000))
    ? '微信账单'
    : '支付宝账单'
  const rows = []
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('-----')) continue
    const cells = splitCsvLine(line)
    const dir = (cells[iDir] || '').trim()
    if (dir !== '支出' && dir !== '收入') continue
    const amount = Number(String(cells[iAmount] || '').replace(/[¥￥,\s]/g, ''))
    if (!(amount > 0)) continue
    const time = parseBillTime(cells[iTime])
    if (!time) continue
    const merchant = ((cells[iCounter] || '').trim() || (cells[iGoods] || '').trim() || '未知商户')
    const goods = iGoods >= 0 ? cells[iGoods] || '' : ''
    const no = (iNo >= 0 ? cells[iNo] || '' : '').trim()
    rows.push({
      id: `imp-${no || `${time}-${amount}`}`,
      amount,
      type: dir === '收入' ? 'income' : 'expense',
      merchant,
      category: dir === '收入' ? '收入' : classify(merchant, goods),
      source: '导入',
      pkg: 'import',
      time,
      raw: line.slice(0, 300),
      status: 'confirmed',
      ...(no ? { txNo: no } : {}),
    })
  }
  if (!rows.length) {
    return { ok: false, source, rows: [], reason: '账单里没有可导入的收支记录' }
  }
  return { ok: true, source, rows, reason: '' }
}

/** 导入去重：有交易单号按单号；没有则按「时间(分钟) + 金额 + 商户 + 收支」 */
export function mergeImported(txs, imported) {
  const keyOf = (t) =>
    t.txNo
      ? `no:${t.txNo}`
      : `k:${Math.floor(t.time / 60000)}|${t.amount}|${t.merchant}|${t.type}`
  const seen = new Set((txs || []).map(keyOf))
  const list = [...(txs || [])]
  let added = 0
  let skipped = 0
  for (const t of imported || []) {
    const k = keyOf(t)
    if (seen.has(k)) {
      skipped++
      continue
    }
    seen.add(k)
    list.push(t)
    added++
  }
  list.sort((a, b) => a.time - b.time)
  return { added, skipped, list }
}

/* ───────────────────────── 插件本体 ───────────────────────── */

function fmtTime(ms) {
  const d = new Date(ms)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Tauri IPC（插件在宿主页面里跑，拿注入的全局入口；桌面/浏览器没有它） */
function ipc() {
  return globalThis.__TAURI_INTERNALS__ || null
}

export default {
  async apply(ctx) {
    const { command, view, host, store, subscriptions, fs } = ctx

    /** 内存镜像：store 是异步的，面板 render 是同步的 */
    let txs = []
    try {
      txs = (await store.get(STORE_KEY, [])) || []
    } catch {
      txs = []
    }
    /** 用户改分类学到的「商户 → 分类」（classify 的最优先层） */
    let userMap = {}
    try {
      userMap = (await store.get(CATEGORY_KEY, {})) || {}
    } catch {
      userMap = {}
    }
    /** 分类列表（用户可自定义；默认内置 9 个） */
    let categories = CATEGORIES
    try {
      const saved = await store.get(CATEGORY_LIST_KEY, null)
      if (Array.isArray(saved) && saved.length) categories = saved
    } catch {
      categories = CATEGORIES
    }
    /** 正在改分类的交易 id（null = 列表视图） */
    let editingId = null
    /** 面板视图：账单列表 / 统计（rev173.28） */
    let mode = 'list'
    let status = { enabled: false, note: '正在检查通知权限…' }

    const refresh = () => {
      try {
        view.refresh(PANEL_ID)
      } catch {
        /* 面板还没注册时会抛；忽略 */
      }
    }

    async function persist() {
      if (txs.length > MAX_TX) txs = txs.slice(-MAX_TX)
      await store.set(STORE_KEY, txs)
    }

    async function checkPermission() {
      // 桌面没有通知监听：别把「未授权」当成用户没开权限
      if (ctx.host.platform !== 'android') {
        status = { enabled: false, note: '当前平台没有通知捕获（桌面只能手动记账）' }
        refresh()
        return status
      }
      const t = ipc()
      if (!t) {
        status = { enabled: false, note: '当前平台没有通知捕获（桌面只能手动记账）' }
        refresh()
        return status
      }
      try {
        const on = await t.invoke('plugin:notification-capture|is_enabled')
        status = {
          enabled: !!on,
          note: on
            ? '通知使用权已开：支付通知会自动进「待同步」'
            : '通知使用权未开：点「打开授权页」去系统设置勾选本应用',
        }
      } catch (e) {
        status = { enabled: false, note: `权限检查失败：${String(e)}` }
      }
      refresh()
      return status
    }

    async function sync() {
      const t = ipc()
      if (!t) {
        host.notify('通知捕获只在 Android 上可用', 'warn')
        return
      }
      let raw = '[]'
      try {
        raw = await t.invoke('plugin:notification-capture|drain')
      } catch (e) {
        host.notify(`同步失败：${String(e)}`, 'error')
        return
      }
      let notices = []
      try {
        notices = JSON.parse(raw || '[]')
      } catch {
        notices = []
      }
      let added = 0
      for (const n of notices) {
        const tx = parseNotification(n, userMap)
        if (!tx) continue
        if (txs.some((x) => x.id === tx.id)) continue
        txs.push(tx)
        added++
      }
      txs = dedupeTransactions(txs)
      txs.sort((a, b) => a.time - b.time)
      await persist()
      host.notify(added > 0 ? `同步完成：新增 ${added} 条账单` : '同步完成：没有新账单')
      refresh()
    }

    async function openSettings() {
      const t = ipc()
      if (!t) {
        host.notify('只有 Android 有通知使用权设置', 'warn')
        return
      }
      try {
        await t.invoke('plugin:notification-capture|open_settings')
      } catch (e) {
        host.notify(`打开设置失败：${String(e)}`, 'error')
      }
    }

    /**
     * 改一笔的分类，并**记住这个商户**（学习）：下次同商户的通知直接归到该类。
     * 「手动记账 / 未知商户」不学 —— 那不是商户名，学了会污染映射。
     */
    async function pickCategory(id, category) {
      if (!id || !category) return
      const tx = txs.find((t) => t.id === id)
      if (!tx) return
      tx.category = category
      const m = (tx.merchant || '').trim()
      if (m && !['手动记账', '未知商户', '未知'].includes(m)) {
        userMap[m] = category
        try {
          await store.set(CATEGORY_KEY, userMap)
        } catch {
          /* 学习失败不影响本条修改 */
        }
      }
      await persist()
      editingId = null
      refresh()
      host.notify(`已归到「${category}」${m && !['手动记账', '未知商户'].includes(m) ? `；以后「${m}」自动归类` : ''}`)
    }

    /** 新增一个自定义分类（只增不删；删了会留下孤立的分类名，后续做管理页） */
    async function addCategory(payload) {
      const name = String((payload && payload.value) || '').trim()
      if (!name) {
        host.notify('先输入分类名', 'warn')
        return
      }
      if (categories.includes(name)) {
        host.notify('已经有这个分类了', 'warn')
        return
      }
      categories = [...categories, name]
      try {
        await store.set(CATEGORY_LIST_KEY, categories)
      } catch {
        /* 存不下不影响本次使用 */
      }
      refresh()
      host.notify(`已新增分类「${name}」，点它给这笔归类`)
    }

    async function addManual(payload) {
      const raw = payload && payload.value
      const amount = Number(raw)
      if (!(amount > 0)) {
        host.notify('先输入金额（如 23.5）', 'warn')
        return
      }
      const type = payload && payload.type === 'income' ? 'income' : 'expense'
      txs.push({
        id: `tx-${Date.now()}-manual`,
        amount,
        type,
        merchant: '手动记账',
        category: type === 'income' ? '收入' : '其他',
        source: '手动',
        pkg: 'manual',
        time: Date.now(),
        raw: '',
        status: 'confirmed',
      })
      await persist()
      refresh()
      host.notify(`已记一笔${type === 'income' ? '收入' : '支出'}：¥${amount}`)
    }

    /**
     * 导出 CSV：桌面走系统「另存为」；Android 的 SAF 另存为不受支持（host.saveFile 会明确报错）
     * ⇒ 写进库根目录，用户在文件树里能看到、再自行分享。
     */
    async function exportCsv() {
      if (!txs.length) {
        host.notify('还没有账单可导出', 'warn')
        return
      }
      const csv = toCsv(txs)
      const name = `ZeroNote记账-${dateStamp(Date.now())}.csv`
      if (host.platform !== 'android') {
        try {
          const path = await host.saveFile({ defaultName: name, content: csv })
          if (path) host.notify(`已导出 ${txs.length} 条到 ${path}`)
          return
        } catch (e) {
          host.notify(`另存为失败：${String(e)}；改为写入库内`, 'warn')
        }
      }
      try {
        await fs.writeText(name, csv)
        host.notify(`已写入库根目录：${name}（共 ${txs.length} 条）`)
      } catch (e) {
        host.notify(`导出失败：${String(e)}`, 'error')
      }
    }

    /**
     * 导入微信 / 支付宝账单 CSV。
     * 桌面 `pickFile()` 给绝对路径；Android 给 `content://`（先经 uri-reader 复制到缓存）。
     * 编码兜底：先严格 UTF-8，失败再按 GBK（支付宝导出常是 GBK）。
     */
    async function importCsv() {
      let picked = null
      try {
        picked = await host.pickFile()
      } catch (e) {
        host.notify(`选择文件失败：${String(e)}`, 'error')
        return
      }
      if (!picked) return
      try {
        let path = picked
        if (/^content:\/\//i.test(picked)) {
          const r = await host.readContentUri(picked)
          path = r.path
        }
        const res = await fetch(host.assetUrlAbs(path))
        const buf = await res.arrayBuffer()
        let text = ''
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
        } catch {
          text = new TextDecoder('gbk').decode(buf)
        }
        const parsed = parseBillCsv(text)
        if (!parsed.ok) {
          host.notify(parsed.reason, 'warn')
          return
        }
        const { added, skipped, list } = mergeImported(txs, parsed.rows)
        if (!added) {
          host.notify(`没有新账单（重复 ${skipped} 条）`, 'warn')
          return
        }
        txs = list
        await persist()
        refresh()
        host.notify(`导入 ${added} 条（${parsed.source}），跳过重复 ${skipped} 条`)
      } catch (e) {
        host.notify(`导入失败：${String(e)}`, 'error')
      }
    }

    function render() {
      if (mode === 'stats') return renderStats()

      // 改分类视图：只显示这笔 + 分类按钮列表
      if (editingId) {
        const tx = txs.find((t) => t.id === editingId)
        if (tx) {
          return {
            type: 'stack',
            gap: 'md',
            children: [
              {
                type: 'row',
                align: 'center',
                wrap: true,
                gap: 'sm',
                children: [
                  { type: 'button', label: '返回', onClick: 'accounting.cancelEdit', variant: 'ghost' },
                  {
                    type: 'text',
                    value: `给「${tx.merchant} ¥${tx.amount.toFixed(2)}」选分类`,
                    variant: 'title',
                  },
                ],
              },
              {
                type: 'list',
                items: categories.map((c) => ({
                  key: c,
                  node: {
                    type: 'button',
                    label: c,
                    onClick: 'accounting.pickCategory',
                    payload: { id: tx.id, category: c },
                  },
                })),
              },
              {
                type: 'row',
                align: 'center',
                wrap: true,
                gap: 'sm',
                children: [
                  { type: 'input', bind: 'acc-newcat', placeholder: '自定义分类，如「宠物」' },
                  {
                    type: 'button',
                    label: '新增分类',
                    onClick: 'accounting.addCategory',
                    send: 'acc-newcat',
                  },
                ],
              },
            ],
          }
        }
        editingId = null
      }

      const key = monthKey(Date.now())
      const inMonth = txs.filter((t) => monthKey(t.time) === key)
      const spend = inMonth
        .filter((t) => t.type === 'expense')
        .reduce((s, t) => s + t.amount, 0)
      const income = inMonth
        .filter((t) => t.type === 'income')
        .reduce((s, t) => s + t.amount, 0)
      const recent = txs.slice(-20).reverse()

      return {
        type: 'stack',
        gap: 'md',
        children: [
          {
            type: 'row',
            align: 'center',
            wrap: true,
            gap: 'sm',
            children: [
              { type: 'text', value: '记账', variant: 'title' },
              { type: 'button', label: '同步通知', onClick: 'accounting.sync' },
              { type: 'button', label: '统计', onClick: 'accounting.stats', variant: 'ghost' },
              { type: 'button', label: '导出 CSV', onClick: 'accounting.exportCsv', variant: 'ghost' },
              { type: 'button', label: '导入 CSV', onClick: 'accounting.importCsv', variant: 'ghost' },
              { type: 'button', label: '检查权限', onClick: 'accounting.check', variant: 'ghost' },
              { type: 'button', label: '打开授权页', onClick: 'accounting.openSettings', variant: 'ghost' },
            ],
          },
          {
            type: 'text',
            value: `本月支出 ¥${spend.toFixed(2)} · 收入 ¥${income.toFixed(2)} · 结余 ¥${(income - spend).toFixed(2)}`,
          },
          {
            type: 'text',
            value: status.note,
            variant: 'caption',
            tone: status.enabled ? 'success' : 'warn',
          },
          { type: 'divider' },
          {
            type: 'list',
            empty: '还没有账单。点「同步通知」拉取支付通知，或在下面手动记一笔。',
            items: recent.map((t) => ({
              key: t.id,
              node: {
                type: 'row',
                align: 'center',
                wrap: true,
                gap: 'sm',
                children: [
                  {
                    type: 'text',
                    value: `${fmtTime(t.time)} · ${t.merchant} ¥${t.amount.toFixed(2)}`,
                  },
                  {
                    type: 'button',
                    label:
                      t.category === '其他'
                        ? t.type === 'income'
                          ? '收入'
                          : '其他 · 待分类'
                        : t.category || '其他',
                    onClick: 'accounting.editCategory',
                    payload: { id: t.id },
                    variant: 'ghost',
                  },
                  ...(t.status === 'pending'
                    ? [{ type: 'badge', text: '金额待补', tone: 'warn' }]
                    : []),
                ],
              },
            })),
          },
          { type: 'divider' },
          { type: 'text', value: '手动记一笔', variant: 'caption', tone: 'muted' },
          {
            type: 'row',
            align: 'center',
            wrap: true,
            gap: 'sm',
            children: [
              { type: 'input', bind: 'acc-amount', placeholder: '金额，如 23.5' },
              {
                type: 'button',
                label: '记支出',
                onClick: 'accounting.addExpense',
                send: 'acc-amount',
              },
              {
                type: 'button',
                label: '记收入',
                onClick: 'accounting.addIncome',
                send: 'acc-amount',
                variant: 'ghost',
              },
            ],
          },
        ],
      }
    }

    /** 统计视图（rev173.28）：本月分类占比 + 近 6 个月支出柱状图 */
    function renderStats() {
      const now = new Date()
      const key = monthKey(Date.now())
      const inMonth = txs.filter((t) => monthKey(t.time) === key)
      const spend = inMonth
        .filter((t) => t.type === 'expense')
        .reduce((s, t) => s + t.amount, 0)
      const income = inMonth
        .filter((t) => t.type === 'income')
        .reduce((s, t) => s + t.amount, 0)
      const sum = summarizeByCategory(txs, now.getFullYear(), now.getMonth() + 1)
      const trend = monthlyTrend(txs, 6)

      return {
        type: 'stack',
        gap: 'md',
        children: [
          {
            type: 'row',
            align: 'center',
            wrap: true,
            gap: 'sm',
            children: [
              {
                type: 'button',
                label: '返回账单',
                onClick: 'accounting.backToList',
                variant: 'ghost',
              },
              { type: 'text', value: '统计', variant: 'title' },
            ],
          },
          {
            type: 'text',
            value: `本月支出 ¥${spend.toFixed(2)} · 收入 ¥${income.toFixed(2)} · 结余 ¥${(
              income - spend
            ).toFixed(2)}`,
          },
          ...(sum.rows.length
            ? [
                { type: 'text', value: '支出分类占比', variant: 'caption', tone: 'muted' },
                ...sum.rows.map((r) => {
                  const pct = Math.round(r.pct * 100)
                  return {
                    type: 'progress',
                    value: r.amount,
                    max: sum.total || 1,
                    label: `${r.category} ¥${r.amount.toFixed(2)} · ${
                      pct === 0 && r.amount > 0 ? '<1' : pct
                    }% · ${r.count} 笔`,
                  }
                }),
              ]
            : [{ type: 'text', value: '本月还没有支出记录', tone: 'muted' }]),
          { type: 'divider' },
          { type: 'text', value: '近 6 个月支出', variant: 'caption', tone: 'muted' },
          { type: 'html', value: trendSvg(trend) },
        ],
      }
    }

    subscriptions.push(
      command.register({
        id: 'accounting.sync',
        title: '记账：同步支付通知',
        run: () => sync(),
      }),
      command.register({
        id: 'accounting.stats',
        title: '记账：统计',
        run: () => {
          mode = 'stats'
          refresh()
        },
      }),
      command.register({
        id: 'accounting.exportCsv',
        title: '记账：导出 CSV',
        run: () => exportCsv(),
      }),
      command.register({
        id: 'accounting.importCsv',
        title: '记账：导入 CSV（微信/支付宝账单）',
        run: () => importCsv(),
      }),
      command.register({
        id: 'accounting.backToList',
        title: '记账：返回账单列表',
        run: () => {
          mode = 'list'
          refresh()
        },
      }),
      command.register({
        id: 'accounting.check',
        title: '记账：检查通知权限',
        run: () => checkPermission(),
      }),
      command.register({
        id: 'accounting.openSettings',
        title: '记账：打开通知使用权设置',
        run: () => openSettings(),
      }),
      command.register({
        id: 'accounting.addExpense',
        title: '记账：记一笔支出（用金额输入框）',
        run: (p) => addManual({ value: p && p.value, type: 'expense' }),
      }),
      command.register({
        id: 'accounting.addIncome',
        title: '记账：记一笔收入（用金额输入框）',
        run: (p) => addManual({ value: p && p.value, type: 'income' }),
      }),
      command.register({
        id: 'accounting.editCategory',
        title: '记账：改这笔的分类',
        run: (p) => {
          editingId = (p && p.id) || null
          refresh()
        },
      }),
      command.register({
        id: 'accounting.pickCategory',
        title: '记账：选定分类',
        run: (p) => pickCategory(p && p.id, p && p.category),
      }),
      command.register({
        id: 'accounting.cancelEdit',
        title: '记账：取消改分类',
        run: () => {
          editingId = null
          refresh()
        },
      }),
      command.register({
        id: 'accounting.addCategory',
        title: '记账：新增自定义分类',
        run: (p) => addCategory(p),
      }),
      view.registerPanel({
        id: PANEL_ID,
        title: '记账',
        location: 'main',
        render,
      }),
    )

    // 启动即检查一次权限（不阻塞插件加载）
    void checkPermission()
  },
}
