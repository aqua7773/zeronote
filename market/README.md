# market —— 插件市场索引

> 状态：**active** ｜首版 2026-10-25（rev173.143）｜权威说明：`docs/插件市场-调研-2026-10-25.md`

这个目录是**插件市场的唯一数据源**。应用读 `index.json` 显示「发现」列表。

## 文件

| 文件 | 谁写 | 说明 |
|---|---|---|
| `index.json` | **脚本生成，别手改** | `node scripts/gen-market.mjs --write` 产出；合并官方条目与外部条目 |
| `entries/<id>.json` | `pack-plugin.mjs` 生成，别手改 | 官方插件条目：展示字段 + 下载地址 + **整包 sha256** |
| `packs/<id>-<version>.znp` | `pack-plugin.mjs` 生成，**入库** | 插件包本体。走 raw 分发（见下） |
| `external.json` | 手工维护 | 外部作者条目，PR 改这里；只放展示字段 + `entry` 地址 |

## 官方插件怎么发版

```bash
# 1. 签名并打包（私钥自己保管，不要入库）
#    默认写进 market/packs/ 与 market/entries/，url 指回本仓库的 raw
node scripts/pack-plugin.mjs <id> --key <私钥.pem> --key-id <你的 keyId>

# 2. 重建索引（会校验「包在不在、sha256 对不对」）
node scripts/gen-market.mjs --write

# 3. 提交 market/ 并推送
```

**为什么包入库、不走 Release**（rev173.150，开源当天实测）：`github.com`（Release 下载域名）
在国内经常直连连不上，而 `raw.githubusercontent.com` 通 —— 索引能拉、包下不来，市场就成了
「能看不能装」。包放进仓库走 raw，索引和包同一个域名，一条链路通就全通；13 个包合计约 600 KB。
`gen-market.mjs` 现在会校验「包存在 + sha256 与条目一致」，忘了重建或忘了入库都会红。

## 本仓库的正式签名密钥（2026-10-25 生成 · rev173.144）

| 项 | 值 |
|---|---|
| keyId | **`aqua-2026`** |
| 私钥 | `%USERPROFILE%\.zeronote-keys\aqua-2026.key.pem` — **在仓库外，绝不入库** |
| 公钥 | `{ "keyId": "aqua-2026", "publicKey": "iOIIUrkdKmP0w+pwpgqGiqSsLJYfl9Pa5VeUCBCjh6E=" }` |

这个公钥出现在两处（**rev173.146 起改为内置为主**）：

1. **应用内置**（rev173.146 已完成）：`src-tauri/src/lib.rs` 的 `BUILTIN_TRUSTED_KEYS`
   —— 新装机器 / 换电脑**开箱即信任**，不依赖用户目录里有没有文件。
   改了这份常量就跑 `node scripts/verify-trust.mjs`（会与私钥逐字节对账 + 验 `dist/` 里每个包）。
2. **本机** `<应用数据目录>/.zn/trusted-keys.json` —— 可选。同一个 `keyId` 写在这里会**覆盖**内置值
   （私钥轮换 / 撤销走这条）；其它 `keyId` 是**追加**（外部作者公钥放这里）。
   ⚠️ 一旦内置某个公钥，**谁持有那个私钥，谁就能向所有用户推送任意代码** ——
   这是整套方案里最大的一处权力集中，别让它只活在代码注释里。

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
