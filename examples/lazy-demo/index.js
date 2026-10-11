/**
 * **懒激活**示例 —— 启动时这个插件的代码一行都不会跑。
 *
 * 机制（契约 §3 的 `activationEvents`）：
 *   ① 宿主读 manifest ⇒ 把 `contributes.commands` **静态登记**进命令表
 *      ⇒ 命令面板**不用加载插件**就能列出「懒加载示例：打个招呼」
 *   ② 用户真的点了那条命令 ⇒ 宿主发现没有实现 ⇒ 激活本插件 ⇒ 走 `apply()`
 *   ③ `apply()` 里用 **`bind`**（不是 `register`）补上实现 ⇒ 命令执行
 *
 * 所以这个文件里的 `host.log` 是一句**可验证的断言**：
 *   · 命令面板打开时日志里**没有**它 ⇒ 证明没被加载
 *   · 点过命令之后日志里出现它 ⇒ 证明是被那条命令激活的
 *
 * 注意：**用 `register` 就会踩到 id 冲突**（元数据已经被静态声明占了），
 * 懒激活插件必须用 `bind`。
 */
export default {
  apply(api) {
    api.host.log('info', '[lazy-demo] apply() 被调用 —— 插件刚刚因为命令被执行而激活')

    api.subscriptions.push(
      api.command.bind('lazy-demo.ping', () => {
        api.host.notify('懒加载示例：这个插件是被你点的那条命令激活的 ✅')
      }),
    )

    // 顺带演示：懒激活插件也能正常提供 service（激活后才会被执行）
    api.service.provide('lazy-demo.pong', () => ({ at: Date.now() }))
  },
}
