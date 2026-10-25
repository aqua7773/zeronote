# market —— 插件市场索引

> 状态：**active** ｜首版 2026-10-25（rev173.143）｜权威说明：`docs/插件市场-调研-2026-10-25.md`

这个目录是**插件市场的唯一数据源**。应用读 `index.json` 显示「发现」列表。

## 文件

| 文件 | 谁写 | 说明 |
|---|---|---|
| `index.json` | **脚本生成，别手改** | `node scripts/gen-market.mjs --write` 产出；合并官方条目与外部条目 |
| `entries/<id>.json` | `pack-plugin.mjs` 生成，别手改 | 官方插件条目：展示字段 + 下载地址 + **整包 sha256** |
| `external.json` | 手工维护 | 外部作者条目，PR 改这里；只放展示字段 + `entry` 地址 |

## 官方插件怎么发版

```bash
# 1. 签名并打包（私钥自己保管，不要入库）
node scripts/pack-plugin.mjs <id> --key <私钥.pem> --key-id <你的 keyId>

# 2. 把 dist/<id>-<version>.znp 传到 GitHub Release，tag = plugins-v<version>
#    （pack-plugin 会打印预期地址）

# 3. 重建索引
node scripts/gen-market.mjs --write

# 4. 提交 market/
```

## 本仓库的正式签名密钥（2026-10-25 生成 · rev173.144）

| 项 | 值 |
|---|---|
| keyId | **`aqua-2026`** |
| 私钥 | `%USERPROFILE%\.zeronote-keys\aqua-2026.key.pem` — **在仓库外，绝不入库** |
| 公钥 | `{ "keyId": "aqua-2026", "publicKey": "iOIIUrkdKmP0w+pwpgqGiqSsLJYfl9Pa5VeUCBCjh6E=" }` |

这个公钥必须出现在两个地方：

1. **本机** `<应用数据目录>/.zn/trusted-keys.json` —— 已写入（rev173.144），否则本机加载签名插件会被拒
2. **应用内置**（将来要做）：把公钥**编译进**应用，否则别人装市场包会验签失败。
   ⚠️ 一旦内置，**谁持有私钥，谁就能向所有用户推送任意代码** —— 这是整套方案里最大的一处权力集中，别让它只活在代码注释里

> ⚠️ **私钥泄露 = 任何人可以用你的身份发布插件**。备份到密码管理器；不要放进同步盘、不要贴进聊天。

## 外部作者怎么投稿

1. 在你的仓库根放 `manifest.json` + 插件源码，按契约 §3 写
2. 打包你自己的插件（用本仓库的脚本也行）：
   ```bash
   node scripts/pack-plugin.mjs <你的插件目录> --key <你的私钥.pem> --key-id <你的 keyId> \
     --repo <你的 GitHub owner/repo> --entries <你的仓库>/market
   ```
   它会产出 `.znp` 和一个 `market-entry.json`
3. 把 `.znp` 传到你自己仓库的 Release，`market-entry.json` 放到仓库根（或任意可公开访问的 URL）
4. 给本仓库提 PR，在 `market/external.json` 的 `plugins` 数组里加一行：
   ```json
   { "id": "your-plugin", "name": "你的插件", "author": "你",
     "description": "一句话说明", "entry": "https://raw.githubusercontent.com/you/repo/main/market-entry.json" }
   ```
5. CI 会校验：`entry` 可达、格式对、`id` 不重复

**作者发版不用再改这个仓库** —— 版本信息在你自己的 `market-entry.json` 里，客户端点开详情时才读。

## 安全边界（请先读）

内核**不为插件提供任何安全保证**（`docs/架构原则-2026-10-13.md` §4.1）：插件能读任意笔记文件、能发网络请求、能调用内核命令。

所以市场是**发现渠道 + 身份证明**，不是安全门：

- 签名只解决「这个包是谁发的、发完之后有没有被改过」，**不解决「作者是否善意」**
- 我们**只审格式、不审代码**（假装审过比不审更危险）
- 装之前应用会列出这个插件**自称需要的能力**，但那只是自述

判断一个插件能不能信任，请看它的源码 —— 所以本目录要求每个条目都给出可访问的仓库地址。
