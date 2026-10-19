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
const MAX_TX = 500

/* ───────────────────────── 纯函数（可单测） ───────────────────────── */

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

/** 自动分类：商户映射 → 关键词 → 「其他」 */
export function classify(merchant, text) {
  const m = merchant || ''
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
 * `n` = `{ pkg, app, title, text, time }`（原生缓存的结构）。
 */
export function parseNotification(n) {
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
    category: classify(merchant, text),
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

/* ───────────────────────── 插件本体 ───────────────────────── */

const pad = (n) => String(n).padStart(2, '0')

function fmtTime(ms) {
  const d = new Date(ms)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function monthKey(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

/** Tauri IPC（插件在宿主页面里跑，拿注入的全局入口；桌面/浏览器没有它） */
function ipc() {
  return globalThis.__TAURI_INTERNALS__ || null
}

export default {
  async apply(ctx) {
    const { command, view, host, store, subscriptions } = ctx

    /** 内存镜像：store 是异步的，面板 render 是同步的 */
    let txs = []
    try {
      txs = (await store.get(STORE_KEY, [])) || []
    } catch {
      txs = []
    }
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
        const tx = parseNotification(n)
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

    function render() {
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
                    type: 'badge',
                    text: t.category || '其他',
                    tone: t.type === 'income' ? 'success' : 'default',
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

    subscriptions.push(
      command.register({
        id: 'accounting.sync',
        title: '记账：同步支付通知',
        run: () => sync(),
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
