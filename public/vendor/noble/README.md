# noble 密码学库（本地副本，勿手改）

> 生成：`node scripts/vendor-noble.mjs`（按相对 import 图精确复制，只带用到的模块）
> 来源：[@noble/ciphers](https://github.com/paulmillr/noble-ciphers) v2.4.0 ·
> [@noble/hashes](https://github.com/paulmillr/noble-hashes) v2.4.0 · 均为 MIT
> 审计状态：noble-ciphers v1.0.0 经 Cure53 审计（范围 "everything"）；
> **noble-hashes 的 argon2 模块不在审计范围内**（见 `docs/安全插件-方案-2026-10-25.md` §3）。

## 文件清单（合计 202,218 B）

| 文件 | 大小 |
|---|---|
| `ciphers/_arx.js` | 17,063 B |
| `ciphers/_poly1305.js` | 12,223 B |
| `ciphers/chacha.js` | 18,422 B |
| `ciphers/utils.js` | 34,005 B |
| `hashes/_blake.js` | 2,841 B |
| `hashes/_md.js` | 9,175 B |
| `hashes/_u64.js` | 4,794 B |
| `hashes/argon2.js` | 25,707 B |
| `hashes/blake2.js` | 22,819 B |
| `hashes/hkdf.js` | 7,019 B |
| `hashes/hmac.js` | 3,118 B |
| `hashes/sha2.js` | 18,997 B |
| `hashes/utils.js` | 26,035 B |

## 重新生成

```bash
pnpm install            # 保证 node_modules/@noble/* 存在
node scripts/vendor-noble.mjs
```

升级 noble 版本后必须重跑，并在 `HANDOFF.md` 记一笔（密码学库换版本 = 值得留痕）。
