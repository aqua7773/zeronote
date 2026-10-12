/**
 * doc 原语探针 —— **U3a / U3b 的验收夹具**（不是功能插件，验收完可删）。
 *
 * 它存在的理由：`doc.replaceRange`（U3a）与真事件 `doc.on`（U3b）都是"插件才用得到"的能力，
 * 光看代码看不出对不对。这里用**最小可信路径**把它们跑一遍：
 *
 *  ① `docprobe.seed`    → `replaceRange(0, len, BASE)`：全量替换（验区间上界与"只动这一段"）
 *  ② `docprobe.replace` → `replaceRange(i, i+8, 'NEW-PART')`：**中间区间**替换
 *  ③ 事件日志         → 四个事件各记一条，CDP 直接读 `window.__docProbeLog` 断言
 *
 * 判据（CDP 逐条断言，见 `docs/内核契约-v0.1.md` §2.1.3）：
 *  - seed 后正文 === BASE（逐字节）
 *  - replace 后正文 === BASE 把 `OLD-PART` 换成 `NEW-PART` 的结果，**其余一字未动**
 *  - 打开另一篇 → `open`；打字 → 停手 200ms 内 `change`；800ms 后 `save`；关闭 → `close`
 *  - 切笔记时 `change` 必须**先于** `open`（去抖窗口里的挂起事件被兑现，不能乱序）
 *
 * 为什么日志挂 `window`：面板渲染是给人看的（截图证据），
 * 但**自动断言**要能一把读到结构化数据 —— `window.__docProbeLog` 两者都满足。
 */

/** 基准文本：中间那个 `OLD-PART` 就是②要替换的区间，首尾段落用来验证"没波及区间之外" */
const BASE = [
  '# 探针笔记',
  '',
  '开头段落：替换区间之外的内容必须一字不动。',
  '',
  '- 列表项 OLD-PART 尾巴',
  '- 第二项',
  '',
  '结尾段落。',
  '',
].join('\n')

const OLD = 'OLD-PART'
const NEW = 'NEW-PART'

/** @type {import('../../src/kernel/contract').Plugin} */
export default {
  apply(ctx) {
    const { command, doc, host, subscriptions, view } = ctx

    /** 事件日志（结构化，上限 80 条；CDP 读 `window.__docProbeLog`） */
    const log = []
    window.__docProbeLog = log
    let last = '（还没跑过命令）'

    /**
     * 诊断出口：把中间值写进 `window.__docProbeDiag`，CDP 直接读。
     *
     * 起因（2026-10-13 验收撞到）：`doc.active()` 为 null 与 `editorRef.current` 为 null
     * **都是静默 return** —— 面板不会刷新、不会有 change、也不报错。
     * 没有出口就只能猜；有了它就一步定位。
     */
    const diag = (o) => {
      window.__docProbeDiag = { ...(window.__docProbeDiag ?? {}), ...o }
    }

    const refresh = () => {
      try {
        view.refresh('docprobe.panel')
      } catch {
        /* 面板可能已被卸载 —— 刷新失败无所谓 */
      }
    }

    for (const ev of ['open', 'change', 'save', 'close']) {
      subscriptions.push(
        doc.on(ev, (d) => {
          log.push({ ev, path: d.path, len: d.content.length, dirty: d.dirty })
          if (log.length > 80) log.shift()
          refresh()
        }),
      )
    }

    subscriptions.push(
      command.register({
        id: 'docprobe.seed',
        title: '探针：写入基准文本（replaceRange 全量替换）',
        run: () => {
          const a = doc.active()
          const lenBefore = a?.content.length ?? null
          doc.replaceRange(0, a?.content.length ?? 0, BASE)
          const lenAfter = doc.active()?.content.length ?? null
          diag({
            at: 'seed',
            activeIsNull: !a,
            activePath: a?.path ?? null,
            lenBefore,
            lenAfter,
            hasReplaceRange: typeof doc.replaceRange,
            baseLen: BASE.length,
          })
          if (!a) {
            host.notify('先打开一篇笔记', 'warn')
            refresh()
            return
          }
          last = `seed：全量替换为 ${BASE.length} 字符`
          refresh()
        },
      }),
    )

    subscriptions.push(
      command.register({
        id: 'docprobe.replace',
        title: '探针：区间替换 OLD-PART → NEW-PART',
        run: () => {
          const a = doc.active()
          if (!a) {
            host.notify('先打开一篇笔记', 'warn')
            return
          }
          const i = a.content.indexOf(OLD)
          if (i < 0) {
            last = `replace：正文里没有 ${OLD}（先跑 seed）`
            host.notify(last, 'warn')
            return
          }
          doc.replaceRange(i, i + OLD.length, NEW)
          last = `replace：替换 [${i}, ${i + OLD.length}) → ${NEW}`
        },
      }),
    )

    subscriptions.push(
      command.register({
        id: 'docprobe.clear',
        title: '探针：清空事件日志',
        run: () => {
          log.length = 0
          last = '日志已清空'
          refresh()
        },
      }),
    )

    subscriptions.push(
      view.registerPanel({
        id: 'docprobe.panel',
        title: 'doc 探针',
        location: 'editor-toolbar',
        render: () => {
          const n = (ev) => log.filter((e) => e.ev === ev).length
          const tail = log
            .slice(-6)
            .map((e) => `${e.ev.padEnd(6)} ${e.len}B${e.dirty ? ' dirty' : ''}`)
            .join('\n')
          return {
            type: 'stack',
            gap: 'sm',
            children: [
              { type: 'text', value: 'U3a / U3b 验收夹具', variant: 'caption' },
              { type: 'text', value: last },
              { type: 'button', label: '① 写入基准文本', onClick: 'docprobe.seed' },
              { type: 'button', label: '② 替换 OLD-PART', onClick: 'docprobe.replace' },
              { type: 'button', label: '③ 清空日志', onClick: 'docprobe.clear' },
              { type: 'divider' },
              {
                type: 'text',
                value: `事件：open ${n('open')} · change ${n('change')} · save ${n('save')} · close ${n('close')}`,
                variant: 'caption',
              },
              { type: 'code', value: tail || '（还没有事件）', lang: 'text' },
            ],
          }
        },
      }),
    )

    host.log('info', 'doc 探针已就绪（U3a/U3b 验收夹具）')
  },

  dispose() {
    // subscriptions 由宿主统一 dispose；window 上的日志留着给 CDP 断言读
  },
}
