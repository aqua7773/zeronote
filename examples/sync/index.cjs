/**
 * 同步（`sync`）—— 入口：引擎 + 面板 + 命令。
 *
 * 一个引擎，多个后端。纯函数与常量在 `lib/core.cjs`，具体协议在 `lib/backends/*.cjs`。
 * 多文件插件用 CommonJS（契约 §3.2）：宿主把 `manifest.files` 里的文件一起读进
 * 一个极简运行时，`require('./lib/core.cjs')` 因此可用 —— 这也是为什么本插件
 * 能有一份引擎而不是像旧四个插件那样各抄一份。
 */
const core = require('./lib/core.cjs')
const { createDavClient } = require('./lib/backends/webdav.cjs')
const {
  createS3Client,
  createS3Storage,
  amzDate,
  amzDay,
  canonicalHeaders,
  canonicalQuery,
  encodeRfc3986,
  encodeS3Path,
  hmacSha256,
  parseListObjects,
  sha256Hex,
  signRequest,
  toHex,
} = require('./lib/backends/s3.cjs')
const {
  createGitClient,
  createGitStorage,
  PROVIDERS,
  b64decode,
  b64decodeBytes,
  b64encode,
  b64encodeBytes,
  encodeGitPath,
  parseContents,
} = require('./lib/backends/git.cjs')
const { createFolderBackend } = require('./lib/backends/folder.cjs')
/** 本地文件夹后端的基线（与 webdav/s3/git 的 `baseline.v1` 分开存：两种语义不能混用） */
const KEY_FOLDER_BASELINE = 'folder.baseline.v1'
/** S3 Secret（Access Key ID 存设置，Secret 存系统凭据库） */
const SECRET_S3_KEY = 'sync.s3.secret'
/** Git 令牌（同样只进系统凭据库） */
const SECRET_GIT_KEY = 'sync.git.token'
const {
  PANEL_ID,
  KEY_SETTINGS,
  KEY_BASELINE,
  KEY_CONFLICTS,
  KEY_DEVICE,
  KEY_TIMING,
  SECRET_KEY,
  CONFLICT_ROOT,
  MAX_FILES_PER_RUN,
  AUTO_MS,
  BACKOFF_MS,
  MAX_CONFLICTS,
  MAX_TIMING,
  SPARK,
  PRIVATE_FILES,
  PRIVATE_ROOT_FILES,
  PRIVATE_DIRS,
  decideTreeAction,
  fingerprint,
  decideSync,
  tryAutoMerge,
  conflictFileName,
  normalizeManifest,
  fingerprintBytes,
  extOf,
  dirOf,
  isAttachment,
  needsAttachmentPull,
  fmtMs,
  pushTiming,
  timingSummary,
  sparkline,
  relayName,
} = core
/* ───────────────────────── 插件本体 ───────────────────────── */

const plugin = {
  apply(api) {
    const platform = api.host.platform === 'android' ? 'android' : 'windows'

    /**
     * 插件设置。
     *
     * `backend` 决定用哪个后端（同一时间只有一个生效 —— 两种后端会抢同一批文件）：
     * · `webdav` —— 插件自己搬（WebDAV / S3 / Git 都是这一类）
     * · `folder` —— 不搬文件，库放同步目录，外部工具搬
     */
    let settings = {
      backend: 'webdav',
      baseUrl: '',
      username: '',
      root: '',
      enabled: false,
      auto: true,
      attachments: 'off',
      /* ── S3（rev173.287 并入）：Secret 不在这里，走系统凭据库 ── */
      endpoint: '',
      region: 'us-east-1',
      bucket: '',
      accessKey: '',
      prefix: '',
      /* ── Git（rev173.288 并入）：令牌也不在这里 ── */
      provider: 'github',
      apiBase: '',
      owner: '',
      repo: '',
      branch: 'main',
      /** Git 的对象前缀（与 S3 的 `prefix` 分开：两个后端可以各自配不同的子目录） */
      repoPrefix: '',
    }
    let baseline = {}
    /**
     * 上一轮远端 manifest 的缓存（rev173.111 · 304 短路径）。
     * `{ files, attachments, etag }`；etag 为空 = 远端没给 ETag ⇒ 下一轮照旧全量拉。
     */
    let manifestCache = null
    /**
     * 本地附件指纹缓存（rev173.117）：`path → { mtime, size, fp }`。
     * 5 秒一轮的自动同步靠它跳过没变过的附件（见 `syncAttachments.localFpOf`）。
     */
    const attFpCache = new Map()
    /**
     * 远端附件的 ETag 缓存（rev173.117）：`远端路径 → etag`。
     * 下载时带 `If-None-Match`，远端没变就 304（省一次完整传输）。
     */
    const attEtag = new Map()
    /**
     * relay ack 检查的轮转游标（rev173.284）：每轮只查一个条目。
     * 每个条目一次 PROPFIND，条目多时（11 张图）全查会把坚果云 600 次/30 分钟打满。
     */
    let ackCursor = 0
    /**
     * 最近若干次同步的耗时（rev173.119）：`{ at, total, manifest, notes, attachments }[]`。
     * 落 store，重启后趋势还在（面板画 sparkline + 平均 / 最慢）。
     */
    let timingHistory = []
    let conflicts = []
    /**
     * 进程内已确认存在「同步点」的路径（rev173.115）。
     * 只放内存：丢了只是下一轮多写一次 base，不影响正确性。
     */
    const baseMarked = new Set()
    let ready = false
    let busy = false
    /** 上一次同步的摘要（面板展示） */
    let lastResult = null
    let formError = null
    /**
     * 表单的镜像值。
     *
     * 宿主的 `input.bind` 只把用户输入写进 **`ViewCtx.state`**，而 `command.run` **拿不到 ctx**
     * ⇒ render 时把 state 抄一份到这里，命令读这份（与 habit 的 `draftView` 同一个做法）。
     */
    let form = {
      baseUrl: '',
      username: '',
      password: '',
      root: '',
      /* ── S3（rev173.287）：与 WebDAV 的表单字段并存，按后端读写 ── */
      endpoint: '',
      region: '',
      bucket: '',
      accessKey: '',
      secret: '',
      prefix: '',
      /* ── Git（rev173.288）── */
      provider: '',
      apiBase: '',
      owner: '',
      repo: '',
      branch: '',
      gitPrefix: '',
      token: '',
    }

    const markDirty = () => {
      void api.store
        .set(KEY_SETTINGS, settings)
        .catch((e) => api.host.log('warn', `同步设置写入失败：${String(e)}`))
    }

    const savedPasswords = new Map()
    /** S3 Secret（Access Key ID 存设置，Secret 存系统凭据库 —— 与 WebDAV 密码同一套规矩） */
    let savedS3Secret = null
    /** Git 令牌（同上） */
    let savedGitToken = null

    async function password() {
      if (savedPasswords.has('p')) return savedPasswords.get('p')
      let p = ''
      try {
        p = (await api.host.secrets.get(SECRET_KEY)) ?? ''
      } catch (e) {
        api.host.log('warn', `读取凭据失败：${String(e)}`)
      }
      savedPasswords.set('p', p)
      return p
    }

    /** 读 S3 Secret（只读一次，之后走缓存；写的时候同步更新缓存） */
    async function s3Secret() {
      if (savedS3Secret !== null) return savedS3Secret
      try {
        savedS3Secret = (await api.host.secrets.get(SECRET_S3_KEY)) ?? ''
      } catch (e) {
        api.host.log('warn', `读取 S3 密钥失败：${String(e)}`)
        savedS3Secret = ''
      }
      return savedS3Secret
    }

    /** 读 Git 令牌（同上） */
    async function gitToken() {
      if (savedGitToken !== null) return savedGitToken
      try {
        savedGitToken = (await api.host.secrets.get(SECRET_GIT_KEY)) ?? ''
      } catch (e) {
        api.host.log('warn', `读取 Git 令牌失败：${String(e)}`)
        savedGitToken = ''
      }
      return savedGitToken
    }

    /**
     * 按当前后端造一个**存储客户端**（rev173.287）。
     *
     * 两个客户端的**方法名与返回形状完全一致**（`get` 返回文本、`readManifest` 返回
     * `{files, attachments, private, privateTree, etag, notModified}` …），所以下面
     * 那份几万字的同步引擎一行都不用改 —— 换后端只换这一处。
     */
    async function makeClient() {
      if (settings.backend === 's3') {
        return createS3Storage({ ...settings, secretKey: await s3Secret(), net: api.net })
      }
      if (settings.backend === 'git') {
        return createGitStorage({
          provider: settings.provider,
          apiBase: settings.apiBase,
          owner: settings.owner,
          repo: settings.repo,
          branch: settings.branch,
          prefix: settings.repoPrefix,
          token: await gitToken(),
          net: api.net,
        })
      }
      return createDavClient({ ...settings, password: await password(), net: api.net })
    }

    /** 当前后端配好了没有（folder 不需要任何远端配置） */
    function hasConfig() {
      if (settings.backend === 'folder') return true
      if (settings.backend === 's3') return !!(settings.endpoint && settings.bucket)
      if (settings.backend === 'git') return !!(settings.owner && settings.repo)
      return !!settings.baseUrl
    }

    const conflictDir = `${CONFLICT_ROOT}/${platform}`
    const takenNames = new Set()

    /**
     * 把本机那一版留成冲突副本（`.zn/conflicts/<平台>/<YYYY-MM-DD HHmm>-<名>.md`）。
     *
     * `localText` 由调用方给 —— **本地文件夹后端必须给**：那边磁盘已经被外部版覆盖，
     * 本机版只剩 `.zn/sync/last/` 里的影子副本。不给时才读盘：WebDAV 后端正是在
     * 「下载覆盖之前」调用，磁盘上那份就是本机版。
     */
    async function keepConflict(path, reason, { localText } = {}) {
      let text = typeof localText === 'string' ? localText : null
      if (text == null) {
        try {
          text = await api.fs.readText(path)
        } catch {
          text = null
        }
      }
      let fileName = null
      if (text != null) {
        fileName = conflictFileName(path, Date.now(), (n) => takenNames.has(n))
        /**
         * 重启 / 另一进程同分钟再冲突（rev173.283）：`takenNames` 只活在本进程，
         * 文件名精确到分钟 ⇒ 第二次会**覆盖**同一分钟内上一次的副本，现场就没了。
         * 落盘前问一次磁盘，已存在就顺延 `-2` / `-3`。
         */
        if (typeof api.fs.exists === 'function') {
          for (let guard = 0; guard < 50; guard += 1) {
            const exists = await api.fs.exists(`${conflictDir}/${fileName}`).catch(() => false)
            if (!exists) break
            takenNames.add(fileName)
            fileName = conflictFileName(path, Date.now(), (n) => takenNames.has(n))
          }
        }
        takenNames.add(fileName)
        try {
          await api.fs.mkdir(conflictDir)
          await api.fs.writeText(`${conflictDir}/${fileName}`, text)
        } catch (e) {
          api.host.log('warn', `冲突副本写入失败：${String(e)}`)
          fileName = null
        }
      }
      /**
       * 同一篇只留**最新一条**（rev173.283 · 真人测试二 #2）。
       *
       * 真机现场：一个文件反复冲突时面板被同一篇刷满（截图里 8 条全是
       * `新笔记-17-50-26.md`），用户根本不知道该处理哪一条。旧副本文件**不删**
       * （还在 `.zn/conflicts/<平台>/` 下，手动能看），只是记录不再重复占位。
       */
      const dupIdx = conflicts.findIndex((c) => c.path === path && c.platform === platform)
      if (dupIdx >= 0) conflicts.splice(dupIdx, 1)
      conflicts.unshift({
        path,
        file: fileName,
        platform,
        at: Date.now(),
        reason,
        lost: text == null,
      })
      if (conflicts.length > MAX_CONFLICTS) conflicts.length = MAX_CONFLICTS
      void api.store.set(KEY_CONFLICTS, conflicts).catch(() => {})
      api.host.notify(
        text == null ? `同步冲突：${path}（本机版未留存）` : `同步冲突：${path} → ${fileName}`,
        'warn',
      )
      api.view.refresh()
    }

    /**
     * 让 history 打一个**同步点**（rev173.115 三方合并的 base）。
     *
     * 时机：每次成功推 / 拉之后，两端内容一致 —— 这就是下次冲突时要用的「共同祖先」。
     * 软依赖：history 被禁用 / 没装 ⇒ 静默跳过（合并退化成「留两份」，不丢数据）。
     *
     * `tag` 按后端分开：两个后端的基线语义不同，同步点不能混用（否则会拿 webdav 时代的
     * 远端版本去当文件夹后端的共同祖先，合出来的东西没人认领）。
     */
    async function markBase(path, text, tag = 'sync:webdav') {
      try {
        const hist = await api.service.consume('history')
        if (hist?.snapshot) await hist.snapshot(path, text, { tag })
      } catch (e) {
        api.host.log('debug', `同步点跳过 ${path}：${String(e)}`)
      }
    }

    /** 基线当前该落在哪个 store 键上（两个后端各一份，互不覆盖） */
    const baselineKey = () => (settings.backend === 'folder' ? KEY_FOLDER_BASELINE : KEY_BASELINE)

    /** 把内存里的基线写盘（失败只记日志：下一轮同步会再对齐一次） */
    async function persistBaseline() {
      try {
        await api.store.set(baselineKey(), baseline)
      } catch (e) {
        api.host.log('warn', `基线写入失败：${String(e)}`)
      }
    }

    /**
     * 本地文件夹后端（rev173.286 从 `examples/sync-folder` 并入）。
     *
     * 状态直通引擎：`baseline` / `conflicts` / `settings` 是同一份内存对象，面板和
     * 冲突处理因此对两个后端天然一致；`pending` 只有这个后端有，它自己存。
     */
    const folder = createFolderBackend({
      api,
      platform,
      state: {
        get baseline() {
          return baseline
        },
        set baseline(v) {
          baseline = v
        },
        get conflicts() {
          return conflicts
        },
        get settings() {
          return settings
        },
      },
      hooks: {
        keepConflict,
        markBase: (path, text) => markBase(path, text, 'sync:folder'),
        refresh: () => api.view.refresh(),
        persistBaseline,
        persistSettings: () => markDirty(),
      },
    })

    /**
     * 冲突时的三方合并：base 取自 history 同步点，mine = 本机，theirs = 远端。
     * 任何一环拿不到都返回 `null`（调用方走原「留两份」）。
     */
    async function autoMerge(client, path, localText) {
      try {
        const [hist, merger] = await Promise.all([
          api.service.consume('history'),
          api.service.consume('kernel.merge'),
        ])
        if (!hist?.findBase || !merger?.mergeLines) return null
        const base = await hist.findBase(path, { tag: 'sync:webdav' })
        if (typeof base !== 'string') return null
        const theirs = await client.get(path)
        if (theirs == null) return null
        return tryAutoMerge({ base, mine: localText, theirs, mergeLines: merger.mergeLines })
      } catch (e) {
        api.host.log('warn', `自动合并失败（${path}）：${String(e)}`)
        return null
      }
    }

    /**
     * 一次完整同步。返回摘要，不抛（错误转成 hint）。
     *
     * `silent`（自动轮询用）：不弹错误 toast、无变化时不刷面板 —— 否则每 5 秒一次重渲染，
     * 用户正在面板里填东西时输入框会被刷掉。
     */
    async function runSync(reason = '手动', { silent = false } = {}) {
      if (busy) return { skipped: true }
      /**
       * 本地文件夹后端的「立即同步一次」= **全库检查一次 + 结算 pending**。
       *
       * 它没有远端可往返 —— 搬运交给 Syncthing / OneDrive 之类，这里只做判定与留副本。
       * 面板上按「检查」口径展示（更新 / 移除 / 冲突），不套 WebDAV 的下载 / 上传计数。
       */
      if (settings.backend === 'folder') {
        const r = await folder.scan(reason)
        folder.settle()
        lastResult = {
          pulled: 0,
          pushed: 0,
          merged: r.merged ?? 0,
          conflicts: r.conflicts ?? 0,
          updated: r.updated ?? 0,
          removed: r.removed ?? 0,
          backend: 'folder',
          hint: r.skipped ? '正在检查中…' : '本地文件夹 · 已检查',
          at: Date.now(),
        }
        return lastResult
      }
      if (!hasConfig()) {
        return { error: settings.backend === 's3' ? '还没配置 S3 端点 / 桶名' : '还没配置 WebDAV 地址' }
      }
      busy = true
      if (!silent) api.view.refresh()
      const t0 = Date.now()
      let tMark = t0
      /**
       * 各阶段耗时（rev173.117）：`{ manifest, notes, attachments, total }`。
       *
       * 为什么要这个：自动同步每 5 秒一轮，用户能感觉到"卡"的时候第一句一定是
       * 「是不是同步拖的」—— 面板上直接给出哪个阶段慢，比猜快。
       */
      const timing = { manifest: 0, notes: 0, attachments: 0, private: 0, privateTree: 0 }
      const lap = () => {
        const now = Date.now()
        const d = now - tMark
        tMark = now
        return d
      }
      const summary = {
        pulled: 0,
        pushed: 0,
        merged: 0,
        conflicts: 0,
        removed: 0,
        hint: '',
        manifest304: false,
      }
      try {
        const client = await makeClient()
        /**
         * manifest：有 etag 就带 `If-None-Match` 走 304 短路径（rev173.111）。
         * 304 ⇒ 用上轮缓存的 files / attachments；200 ⇒ 刷新缓存。
         */
        let remote
        if (manifestCache?.etag) {
          const got = await client.readManifest(manifestCache.etag)
          if (got.notModified) {
            remote = {
              files: manifestCache.files,
              attachments: manifestCache.attachments,
              private: manifestCache.private,
              privateTree: manifestCache.privateTree,
            }
            summary.manifest304 = true
          } else {
            remote = {
              files: got.files,
              attachments: got.attachments,
              private: got.private,
              privateTree: got.privateTree,
            }
            manifestCache = {
              files: got.files,
              attachments: got.attachments,
              private: got.private,
              privateTree: got.privateTree,
              etag: got.etag,
            }
          }
        } else {
          const got = await client.readManifest()
          remote = { files: got.files, attachments: got.attachments, private: got.private }
          manifestCache = {
            files: got.files,
            attachments: got.attachments,
            private: got.private,
            etag: got.etag,
          }
        }
        timing.manifest = lap()
        const notes = await api.fs.listNotes()
        const localPaths = new Set()
        const nextFiles = { ...remote.files }
        /**
         * manifest 需要回写（rev173.287）：`summary.pushed` 只统计「我们推上去的」，
         * 但 412 分支会把**远端**最新版对齐进 `nextFiles` —— 那种情况也必须写回，
         * 否则远端 manifest 一直指着旧指纹，下一轮还会撞 412。
         */
        let manifestDirty = false

        let processed = 0
        for (const n of notes) {
          if (!/\.md$/i.test(n.path)) continue
          if (processed >= MAX_FILES_PER_RUN) break
          processed += 1
          localPaths.add(n.path)
          let localText
          try {
            localText = await api.fs.readText(n.path)
          } catch {
            continue
          }
          const localFp = fingerprint(localText)
          const base = baseline[n.path] ?? null
          const remoteEntry = remote.files[n.path] ?? null
          const verdict = decideSync({ base, localFp, remoteFp: remoteEntry?.fp ?? null })

          if (verdict === 'noop') {
            baseline[n.path] = { fp: localFp, etag: remoteEntry?.etag }
            /**
             * 首轮见到这篇时补一个同步点（rev173.115）：老用户升级后 base 是空的，
             * 第一次真冲突会退化成「留两份」；这里顺手种一个，下一次就能三方合并。
             * `baseMarked` 挡住"每 5 秒一轮重写"。
             */
            if (!baseMarked.has(n.path)) {
              baseMarked.add(n.path)
              await markBase(n.path, localText)
            }
            continue
          }
          if (verdict === 'pull' || verdict === 'pull-new') {
            const text = await client.get(n.path)
            if (text == null) continue
            await api.fs.writeText(n.path, text)
            const fp = fingerprint(text)
            baseline[n.path] = { fp, etag: remoteEntry?.etag }
            baseMarked.add(n.path)
            await markBase(n.path, text)
            summary.pulled += 1
            continue
          }
          if (verdict === 'push' || verdict === 'push-new') {
            const parent = n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : ''
            await client.mkdir(parent)
            /**
             * **S3 / Git 带乐观锁**（rev173.129 / rev173.123 并进统一引擎后保留）：
             * manifest 里记了版本号就带上 —— 远端被「绕过 manifest」改过时服务端回
             * 412（S3）或 409/422（Git），而不是让我们静默覆盖。WebDAV 不带（它的
             * manifest 刷新本来就每轮做，加锁反而会在 5 秒节拍里制造假冲突）。
             */
            const ifMatch =
              settings.backend === 's3' || settings.backend === 'git' ? baseline[n.path]?.etag : undefined
            let res = await client.put(n.path, localText, ifMatch)
            /**
             * `404` = 父集合不存在。除了"目录没建"，**坚果云的根 `/dav/` 本身不可写**
             * （只列得出 `我的坚果云/` 这类子目录）—— 同步目录留空就会撞上。
             * 再建一次再试一次，仍失败就把话说清楚（不是笼统的"上传失败"）。
             */
            if (res.status === 404) {
              await client.mkdir(settings.root || parent).catch(() => {})
              res = await client.put(n.path, localText, undefined)
            }
            if (res.status === 412 || res.precondition) {
              /**
               * **乐观锁失败**：远端在我们读 manifest 之后变了（S3 412 / Git 409-422）。
               *
               * 三步，顺序不能变：
               *   ① 先试三方合并（与 conflict 分支同一套判据）—— 合得上就用**远端最新 etag**
               *      再推一次，两边改动都保住；
               *   ② 合不上才留副本（本机版）+ 取远端最新版对齐；
               *   ③ 无论哪条路，manifest 必须回写 —— 否则远端索引指着旧版本号，下一轮又撞。
               *
               * 旧行为只 `continue` 不取远端、不刷 manifest：本机停在旧版、基线指向旧 fp，
               * 两轮之后两边都「以为自己是新的」—— 真人测试二 #1「两边都显示已同步、
               * 内容却不一样」的成因之一。
               */
              let got = null
              try {
                got =
                  typeof client.getWithEtag === 'function'
                    ? await client.getWithEtag(n.path)
                    : { text: await client.get(n.path), etag: undefined }
              } catch (e) {
                api.host.log('warn', `412 后读远端失败 ${n.path}：${String(e)}`)
              }
              const theirs = got?.text ?? null

              if (theirs != null) {
                const merged = await autoMerge(client, n.path, localText)
                if (merged) {
                  let wrote = false
                  try {
                    await api.fs.writeText(n.path, merged.text)
                    wrote = true
                  } catch (e) {
                    api.host.log('warn', `合并结果落盘失败（${n.path}）：${String(e)}`)
                  }
                  if (wrote) {
                    const res2 = await client.put(n.path, merged.text, got?.etag)
                    if (res2.ok) {
                      const fp = fingerprint(merged.text)
                      baseline[n.path] = { fp, etag: res2.etag ?? undefined }
                      nextFiles[n.path] = { fp, etag: res2.etag ?? undefined, at: Date.now() }
                      manifestDirty = true
                      baseMarked.add(n.path)
                      await markBase(n.path, merged.text)
                      summary.merged += 1
                      continue
                    }
                  }
                }
                // 合不上 ⇒ 本机版留副本，磁盘对齐远端
                await keepConflict(n.path, '远端在同步期间又变了')
                summary.conflicts += 1
                try {
                  await api.fs.writeText(n.path, theirs)
                  const fp = fingerprint(theirs)
                  baseline[n.path] = { fp, etag: got?.etag }
                  nextFiles[n.path] = { fp, etag: got?.etag, at: Date.now() }
                  manifestDirty = true
                  await markBase(n.path, theirs)
                } catch (e) {
                  api.host.log('warn', `412 后对齐远端失败 ${n.path}：${String(e)}`)
                }
              } else {
                // 远端被删了：清基线，下一轮按 push-new 重新上传
                delete baseline[n.path]
                delete nextFiles[n.path]
                manifestDirty = true
              }
              continue
            }
            if (!res.ok) {
              throw new Error(
                res.status === 404
                  ? `上传失败（404）：${n.path} —— 远端父目录不存在；坚果云的 WebDAV 根不可直接写，请在「同步目录」里填一个子目录（如 ZeroNote）`
                  : `上传失败（${res.status}）：${n.path}`,
              )
            }
            baseline[n.path] = { fp: localFp, etag: res.etag ?? undefined }
            nextFiles[n.path] = { fp: localFp, etag: res.etag ?? undefined, at: Date.now() }
            baseMarked.add(n.path)
            await markBase(n.path, localText)
            summary.pushed += 1
            continue
          }
          if (verdict === 'conflict') {
            /**
             * 先试**三方合并**（rev173.115）—— base 来自 history 的同步点。
             * 合上了 ⇒ 本机写合并结果 + 推回远端 ⇒ 两端都是合并结果，这一轮不算冲突。
             * 合不上（有真冲突段 / 没 base / 没 history）⇒ 原流程：本机版留副本、取远端版。
             */
            const merged = await autoMerge(client, n.path, localText)
            if (merged) {
              let wrote = false
              try {
                await api.fs.writeText(n.path, merged.text)
                wrote = true
              } catch (e) {
                api.host.log('warn', `合并结果落盘失败（${n.path}）：${String(e)}`)
              }
              if (wrote) {
                const res2 = await client.put(n.path, merged.text, remoteEntry?.etag)
                if (res2.ok) {
                  const fp = fingerprint(merged.text)
                  baseline[n.path] = { fp, etag: res2.etag ?? undefined }
                  nextFiles[n.path] = { fp, etag: res2.etag ?? undefined, at: Date.now() }
                  baseMarked.add(n.path)
                  await markBase(n.path, merged.text)
                  summary.merged += 1
                  api.host.notify(`已自动合并：${n.path}`, 'info')
                  continue
                }
                /**
                 * 推送失败（412 = 远端又变了 / 网络）：**本机保留合并结果**，别再用远端版
                 * 盖掉它；base 不动，下一轮拿同一份 base 再合一次。
                 */
                summary.hint = `合并结果未能上传（${res2.status}）：${n.path}`
              }
              summary.conflicts += 1
              continue
            }
            await keepConflict(n.path, '双端修改')
            summary.conflicts += 1
            // 取远端版（本机版已经进冲突目录）
            const text = await client.get(n.path)
            if (text != null) {
              await api.fs.writeText(n.path, text)
              const fp = fingerprint(text)
              baseline[n.path] = { fp, etag: remoteEntry?.etag }
              baseMarked.add(n.path)
              await markBase(n.path, text)
              summary.pulled += 1
            }
            continue
          }
          if (verdict === 'remote-deleted') {
            delete baseline[n.path]
            summary.removed += 1
          }
        }

        // 本地没有、远端有的笔记 ⇒ 拉下来
        for (const [path, entry] of Object.entries(remote.files)) {
          if (localPaths.has(path)) continue
          if (!/\.md$/i.test(path)) continue
          const text = await client.get(path)
          if (text == null) continue
          try {
            await api.fs.writeText(path, text)
          } catch (e) {
            summary.hint = `写入失败 ${path}：${String(e)}`
            continue
          }
          baseline[path] = { fp: fingerprint(text), etag: entry.etag }
          baseMarked.add(path)
          await markBase(path, text)
          summary.pulled += 1
        }

        timing.notes = lap()

        // 附件（在 .md 循环之后：`summary.pushed` 里也含附件计数）
        const att = await syncAttachments(client, remote, summary)
        timing.attachments = lap()

        // 私有文件（密码库密文 + 密钥元数据，rev173.164 · 期 1c）
        const priv = await syncPrivate(client, remote, summary)
        timing.private = lap()

        // 私密文件夹目录树（rev173.182 · 期 3）—— 数量可变，逐文件比对
        const privTree = await syncPrivateTree(client, remote, summary)
        timing.privateTree = lap()

        // manifest 回写（本轮有 .md / 附件 / 私有文件变动才写 —— 5 秒一轮，没变化不该反复 PUT）
        if (summary.pushed > 0 || manifestDirty || att.changed || priv.changed || privTree.changed) {
          const w = await client.writeManifest({
            files: nextFiles,
            attachments: att.attachments,
            private: priv.private,
            privateTree: privTree.privateTree,
          })
          // 写盘后远端 etag 变了 ⇒ 缓存跟着换，下一轮照样能走 304
          manifestCache = {
            files: nextFiles,
            attachments: att.attachments,
            private: priv.private,
            privateTree: privTree.privateTree,
            etag: w?.etag ?? null,
          }
        }
        await api.store.set(KEY_BASELINE, baseline)
        summary.hint = summary.hint || `${reason}同步完成${summary.manifest304 ? '（manifest 304）' : ''}`
        // 成功一轮 ⇒ 退避清零（限流是临时的，恢复后立刻回到 5 秒节拍）
        backoffLevel = 0
        backoffUntil = 0
      } catch (e) {
        summary.hint = `同步失败：${String(e)}`
        const msg = String(e)
        /**
         * 两类失败分开处理（rev173.279 · 真人使用测试 #12）：
         *
         * · **认证错**（401 / 403）⇒ 立刻停自动同步。重试只会让封禁更久
         *   （2026-10-24 实测：401 重试十几分钟后桌面 + 手机全被 503 挡了半小时）。
         *   开关显示必须与**实际**一致：`stopAuto()` 只清定时器、不动 `settings.auto`，
         *   不置 false 面板会一直显示「自动 · 前台每 5 秒」—— 用户以为还在同步（真机踩过）。
         *
         * · **限流 / 临时封禁**（429 / 503 / `BlockedTemporarily`）⇒ **指数退避，不永久停**。
         *   旧行为是撞上就停、要用户手动重开；重开后又 5 秒一轮，很快再撞。
         *   现在 15 s → 60 s → 300 s，任何一轮成功立刻复位回 5 s。
         */
        if (/401|403|unauthorized|forbidden/i.test(msg)) {
          backoffLevel = 0
          backoffUntil = 0
          stopAuto()
          if (settings.auto !== false) {
            settings.auto = false
            markDirty()
          }
          summary.hint += '（认证失败，已暂停自动同步；改好账号或密码后在面板上重新开启）'
        } else if (/429|503|blocked|rate.?limit|too many/i.test(msg)) {
          const wait = BACKOFF_MS[Math.min(backoffLevel, BACKOFF_MS.length - 1)]
          backoffLevel = Math.min(backoffLevel + 1, BACKOFF_MS.length)
          backoffUntil = Date.now() + wait
          summary.backoffMs = wait
          summary.hint += `（远端限流，已退避 ${Math.round(wait / 1000)} 秒 —— 成功一轮后自动恢复，不用手动开）`
        }
        if (!silent) api.host.notify(summary.hint, 'error')
        else api.host.log('warn', summary.hint)
      } finally {
        busy = false
        // 失败也记耗时（面板要能看出"卡在哪个阶段"）
        summary.ms = { ...timing, total: Date.now() - t0 }
        const changed = summary.pulled + summary.pushed + summary.merged + summary.conflicts + summary.removed > 0
        /**
         * 耗时历史（rev173.119）：只记**有变化**的轮次与手动同步。
         * 静默的空转轮每 5 秒一条，50 条只够覆盖 4 分钟，而且全是"没活干"的噪声 ——
         * 那样的趋势图看不出任何东西。
         */
        if (changed || !silent) {
          timingHistory = pushTiming(timingHistory, { at: Date.now(), ...summary.ms })
          void api.store.set(KEY_TIMING, timingHistory).catch((e) => api.host.log('warn', `耗时历史写入失败：${String(e)}`))
        }
        lastResult = { ...summary, at: Date.now() }
        /**
         * 自动轮询下「什么都没变」不刷面板（每 5 秒重渲染会把用户正在填的表单刷掉）；
         * **退避那一轮例外** —— 用户必须看见「已退避到 N 秒」，否则面板还写着「自动 · 前台每 5 秒」。
         */
        if (!silent || changed || summary.backoffMs) api.view.refresh()
      }
      return summary
    }

    /* ── 附件同步（rev173.109 · 用户 2026-10-24 要的两种模式） ── */

    /** 设备 id（中转 ack 用；每台设备一个，存 store） */
    async function deviceId() {
      let id = ''
      try {
        id = String((await api.store.get(KEY_DEVICE, '')) || '')
      } catch {
        /* 读不到就当没有 */
      }
      if (!id) {
        id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
        void api.store.set(KEY_DEVICE, id).catch(() => {})
      }
      return id
    }

    /**
     * 附件同步。两种模式（用户 2026-10-24 拍板：「添加一个选项」）：
     *
     * · `full`  —— 附件与文档一样**永久**存在云端（占空间，但任何设备随时能取）
     * · `relay` —— **同步中转**：只在上传方与下载方之间过一道，对端 ack 之后云端副本就删掉
     *              （云端省空间；代价是第三台设备事后取不到这份）
     *
     * `relay` 的协议：
     *   上传：`PUT _zn/relay/<fp><ext>`，`manifest.attachments[path] = { fp, ext, at }`
     *   下载：`GET _zn/relay/<fp><ext>` 写本地 ⇒ `PUT _zn/relay-ack/<fp>`（内容 = 设备 id）
     *   清理：任何一端看到 ack 就删 relay 文件，并在 manifest 里标 `cleaned: true`
     *          —— **条目保留**：别的设备看到 cleaned 就知道「曾经有、别等了」，不会反复重试。
     *
     * @returns {{ attachments: Record<string, object>, changed: boolean }}
     */
    /**
     * **私有文件同步**（rev173.164 · 期 1c）：密码库密文 + 密钥元数据。
     *
     * 为什么单独一段：这两个文件不是 `.md`、又在 `.zn/` 下，`listNotes` 永远看不到它们
     * （附件段也刻意跳 `.zn/`）⇒ 以前密码库**同步不出去**，换设备就是空库。
     *
     * 两者都是**文本**（`secrets.zn` 是 `zn1.<nonce>.<ct>` 的 base64url；`vault.json` 是 JSON），
     * 所以走文本接口，并且能直接复用 `keepConflict`（冲突时把本机版落 `.zn/conflicts/<平台>/`）。
     *
     * 方向判断与笔记同一套 `decideSync` 语义，但**没有三方合并**：
     * 密文合并毫无意义（二进制/密文拼不起来），冲突就是「留两份 + 取远端」。
     *
     * 任何一步失败只写 hint，不抛 —— 密码库传不上去不该让整轮同步（含笔记）停摆。
     *
     * @returns {{ private: Record<string, object>, changed: boolean }}
     */
    async function syncPrivate(client, manifest, summary) {
      const remotePriv = manifest.private || {}
      const nextPriv = { ...remotePriv }
      let changed = false

      for (const rel of PRIVATE_FILES) {
        /**
         * 读本地：**不用 `fs.exists`**，直接读 + 把空串当"没有"。
         * 两个理由：① 少一次 IPC（每 5 秒一轮）② 测试台的 memoryFs 没有 `exists`，
         * 而"文件不存在 ⇒ readText 抛"与"存在但空 ⇒ 返回 ''"两种表现要收敛成同一个 null。
         */
        let localText = null
        try {
          const raw = await api.fs.readText(rel)
          if (raw && raw.trim()) localText = raw
        } catch {
          localText = null
        }
        const localFp = localText == null ? null : fingerprint(localText)
        const entry = remotePriv[rel] ?? null
        const remoteFp = typeof entry?.fp === 'string' ? entry.fp : null
        const base = baseline[rel]?.fp ?? null
        const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''

        // ① 两边一致 ⇒ 只刷新 baseline（`at` 用远端的，别每轮改 manifest）
        if (localFp && remoteFp && localFp === remoteFp) {
          baseline[rel] = { fp: localFp, at: entry?.at ?? 0 }
          continue
        }

        const localChanged = localFp !== base
        const remoteChanged = remoteFp !== base

        /**
         * ② 该拉：本地没有（新设备）· 或者**只有远端变了**。
         *
         * 第二条不能漏 —— 第一版只写了「本地没有」的拉，于是"B 改了、A 同步"
         * 既不拉也不推（localChanged=false 让推送分支也不成立），A 永远停在旧版
         * （单测 `B 改了密码库 ⇒ A 拉回新版` 抓到）。
         */
        if (remoteFp && (!localFp || (remoteChanged && !localChanged))) {
          try {
            const text = await client.get(rel)
            if (text == null) continue
            await client.mkdir(parent).catch(() => {})
            await api.fs.mkdir(parent).catch(() => {})
            await api.fs.writeText(rel, text)
            baseline[rel] = { fp: fingerprint(text), at: entry?.at ?? 0 }
            summary.pulled += 1
          } catch (e) {
            summary.hint = `私有文件下载失败 ${rel}：${String(e)}`
          }
          continue
        }

        // ③ 只有本地变（或远端还没有）⇒ 推
        if (localFp && (!remoteFp || (localChanged && !remoteChanged))) {
          try {
            await client.mkdir(parent).catch(() => {})
            const res = await client.put(rel, localText)
            if (![200, 201, 204, 207].includes(res.status)) {
              summary.hint = `私有文件上传失败 ${rel}（${res.status}）`
              continue
            }
            nextPriv[rel] = { fp: localFp, at: Date.now() }
            baseline[rel] = { fp: localFp, at: nextPriv[rel].at }
            summary.pushed += 1
            changed = true
          } catch (e) {
            summary.hint = `私有文件上传失败 ${rel}：${String(e)}`
          }
          continue
        }

        // ④ 两边都变 ⇒ 冲突：本机版留副本（keepConflict 自己读文本），再取远端版
        if (localFp && remoteFp && localChanged && remoteChanged) {
          try {
            const text = await client.get(rel)
            if (text == null) continue
            await keepConflict(rel, '密码库双端修改')
            await api.fs.writeText(rel, text)
            baseline[rel] = { fp: fingerprint(text), at: entry?.at ?? 0 }
            summary.conflicts += 1
          } catch (e) {
            summary.hint = `私有文件冲突处理失败 ${rel}：${String(e)}`
          }
          continue
        }

        // ⑤ 只剩「本地没有 + 远端也没有」—— 正常态（用户还没建密码库），什么都不做
      }
      return { private: nextPriv, changed }
    }

    /**
     * **私密文件夹目录树同步**（rev173.182 · 私密文件夹期 3）。
     *
     * 与 `syncPrivate` 的区别：那个是**固定清单**（密码库那几个文件），这里是**数量可变**的
     * 目录树（每篇私密笔记一个 `.zn` 密文）。方向判定抽成纯函数 `decideTreeAction`
     * （单测覆盖全部分支），这里只负责按判定执行。
     *
     * 与笔记同步唯一不同的语义：**删除两边都传播**。私密笔记在面板里删除是真删除，
     * 不传播的话同步一轮就会"复活"。
     */
    async function syncPrivateTree(client, manifest, summary) {
      const remoteTree = manifest.privateTree || {}
      const nextTree = { ...remoteTree }
      let changed = false

      /**
       * 本地有哪些（`listFiles` 返回**库内相对路径**，rev173.177 的教训）。
       * `typeof` 兜底：单测里的 memory fs 是逐个方法手写的，没提供 `listFiles` 时按"没有树"
       * 处理（等价于旧行为），而不是整轮同步崩掉。
       */
      const localPaths = new Set()
      if (typeof api.fs.listFiles === 'function') {
        for (const dir of PRIVATE_DIRS) {
          const files = await api.fs.listFiles(dir).catch(() => [])
          for (const rel of files) localPaths.add(rel)
        }
      }
      // 根下的固定文件（`.zn/private/index.zn`）不在那两个目录里，单独补
      for (const rel of PRIVATE_ROOT_FILES) {
        // 空串按"没有"处理（与 `syncPrivate` 同一口径）
        const raw = await api.fs.readText(rel).catch(() => null)
        if (raw && raw.trim()) localPaths.add(rel)
      }

      // 要处理的路径 = 本地 ∪ 远端（任一存在）
      const all = new Set([...localPaths, ...Object.keys(remoteTree)])

      for (const rel of all) {
        let localText = null
        if (localPaths.has(rel)) {
          try {
            const raw = await api.fs.readText(rel)
            if (raw != null) localText = raw
          } catch {
            localText = null
          }
        }
        const localFp = localText == null ? null : fingerprint(localText)
        const entry = remoteTree[rel] ?? null
        const remoteFp = typeof entry?.fp === 'string' ? entry.fp : null
        const base = baseline[rel]?.fp ?? null
        const action = decideTreeAction(localFp, remoteFp, base)
        const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''

        if (action === 'noop') {
          if (localFp && remoteFp) baseline[rel] = { fp: localFp, at: entry?.at ?? 0 }
          continue
        }

        if (action === 'pull') {
          try {
            const text = await client.get(rel)
            if (text == null) continue
            await api.fs.mkdir(parent).catch(() => {})
            await api.fs.writeText(rel, text)
            baseline[rel] = { fp: fingerprint(text), at: entry?.at ?? 0 }
            summary.pulled += 1
          } catch (e) {
            summary.hint = `私密笔记下载失败 ${rel}：${String(e)}`
          }
          continue
        }

        if (action === 'push') {
          try {
            await client.mkdir(parent).catch(() => {})
            const res = await client.put(rel, localText)
            if (![200, 201, 204, 207].includes(res?.status ?? 201)) {
              summary.hint = `私密笔记上传失败 ${rel}（${res?.status}）`
              continue
            }
            nextTree[rel] = { fp: localFp, at: Date.now() }
            baseline[rel] = { fp: localFp, at: nextTree[rel].at }
            summary.pushed += 1
            changed = true
          } catch (e) {
            summary.hint = `私密笔记上传失败 ${rel}：${String(e)}`
          }
          continue
        }

        if (action === 'delete-remote') {
          try {
            await client.remove(rel)
            delete nextTree[rel]
            delete baseline[rel]
            summary.pushed += 1
            changed = true
          } catch (e) {
            summary.hint = `删除远端私密笔记失败 ${rel}：${String(e)}`
          }
          continue
        }

        if (action === 'delete-local') {
          try {
            await api.fs.purgePrivate(rel).catch(() => {})
            delete baseline[rel]
            summary.removed = (summary.removed ?? 0) + 1
          } catch (e) {
            summary.hint = `删除本地私密笔记失败 ${rel}：${String(e)}`
          }
          continue
        }

        // conflict：密文无法合并 ⇒ 留本机副本 + 取远端
        try {
          const text = await client.get(rel)
          if (text == null) continue
          await keepConflict(rel, '私密笔记双端修改')
          await api.fs.writeText(rel, text)
          baseline[rel] = { fp: fingerprint(text), at: entry?.at ?? 0 }
          summary.conflicts += 1
        } catch (e) {
          summary.hint = `私密笔记冲突处理失败 ${rel}：${String(e)}`
        }
      }

      return { privateTree: nextTree, changed }
    }

    async function syncAttachments(client, manifest, summary) {
      const mode = settings.attachments || 'off'
      const remoteAtt = manifest.attachments || {}
      if (mode === 'off') return { attachments: remoteAtt, changed: false }

      const nextAtt = { ...remoteAtt }
      const notes = await api.fs.listNotes()
      const locals = notes.filter((n) => isAttachment(n.path))
      const localByPath = new Map(locals.map((n) => [n.path, n]))
      const me = await deviceId()
      let changed = false

      /**
       * 本地附件的指纹：**`mtime` + `size` 没变就复用上次的结果**（rev173.117）。
       *
       * 自动同步每 5 秒一轮，附件多的时候每轮把所有图片重新读一遍 + 重算散列是纯浪费
       * （100 张图 ≈ 每轮几百 MB 读盘）。`listNotes` 本来就带 `mtime` / `size`，
       * 这两个都没变就没有理由再读内容。缓存只放内存，进程重启多读一次而已。
       *
       * 返回 `{ fp, bytes }`：`bytes` 只在**这次真读了盘**时才有值 —— 调用方直接拿它上传，
       * 免得同一轮为了算指纹和为了上传各读一遍（字节不留在缓存里，图片可能很大）。
       */
      async function localFpOf(meta) {
        const hit = attFpCache.get(meta.path)
        if (hit && hit.mtime === meta.mtime && hit.size === meta.size) return { fp: hit.fp, bytes: null }
        const bytes = await api.fs.readBytes(meta.path)
        const fp = fingerprintBytes(bytes)
        attFpCache.set(meta.path, { mtime: meta.mtime, size: meta.size, fp })
        return { fp, bytes }
      }

      /**
       * 本轮「算指纹时顺带读到的字节」。
       *
       * 先拉后推之后，同一份附件在一轮里要**看两次**（下载循环判方向 + 上传循环取内容）——
       * 不复用的话，本地改过的那张图会被读两遍（100 张图就是两倍 IO）。
       * 只在**这次真读了盘**时才有条目；下载覆盖本地后会删掉，避免拿旧字节又推回去。
       */
      const preloaded = new Map()

      /**
       * 本地 → 远端。**在拉取之后调用**（rev173.126）：顺序反了会先拿本机旧版盖掉远端新版，
       * 两台设备互相覆盖、谁后同步谁赢，另一台永远拿不到新版。
       */
      async function pushLocal() {
      // ① 本地 → 远端
      for (const n of locals) {
        const entry = nextAtt[n.path]
        let fp = ''
        let bytes = null
        try {
          const got = await localFpOf(n)
          fp = got.fp
          bytes = got.bytes ?? preloaded.get(n.path) ?? null
        } catch {
          continue // 读不到就下一轮
        }
        /**
         * 远端已有**同一份内容**就跳过（rev173.284 修「relay 每轮重传」）。
         *
         * 旧写法把 `cleaned` 排除在跳过条件外 —— 本意是「从 relay 切到 full 要补传一份」，
         * 但中转模式清理完的条目**本来就是 cleaned** ⇒ 每轮都重新上传同一批图：
         * 上传 → 下一轮 ack 到了就清理 → 再下一轮又上传 …… 11 张图 ≈ 3.5 MB/轮，
         * 5 秒节拍被拖成 26 秒一轮，请求数直接打满坚果云 600 次/30 分钟（真人测试二 503）。
         *
         * 现在的判据：
         * · fp 相同 ⇒ 这份内容已经同步过了，跳过（relay 副本在不在由下面「ack 清理」那段管）；
         * · **唯一例外**：当前是 `full`、而条目还停在 relay（云端只有中转区那份、而且可能已清理）
         *   ⇒ 补传一次到正式路径（这就是 rev173.109 要修的那个场景，换成更精确的条件）。
         */
        if (entry && entry.fp === fp && !(mode === 'full' && entry.mode !== 'full')) continue
        // 内容不同、且本地不比远端新 ⇒ 远端那份更新，等下载，不要拿旧版覆盖
        if (entry && entry.fp !== fp && Number(n.mtime ?? 0) <= Number(entry.at ?? 0)) continue
        // 指纹缓存命中时上一行没读过字节 ⇒ 上传前补读一次
        if (!bytes) {
          try {
            bytes = await api.fs.readBytes(n.path)
          } catch {
            continue
          }
        }
        const ext = extOf(n.path)
        if (mode === 'full') {
          await client.mkdir(dirOf(n.path))
          const r = await client.putBytes(n.path, bytes)
          if (!r.ok) throw new Error(`上传附件失败（${r.status}）：${n.path}`)
        } else {
          await client.mkdir('_zn/relay')
          const r = await client.putBytes(`_zn/relay/${relayName(fp, ext)}`, bytes)
          if (!r.ok) throw new Error(`上传附件失败（${r.status}）：${n.path}`)
        }
        nextAtt[n.path] = { fp, ext, at: Date.now(), mode }
        changed = true
        summary.pushed += 1
      }
      }

      // ② 远端 → 本地（本地没有这份，**或者远端换过内容**）
      for (const [path, entry] of Object.entries(remoteAtt)) {
        if (!entry || entry.cleaned) continue
        if (!isAttachment(path)) continue
        const local = localByPath.get(path) ?? null
        /**
         * 内容级判定（rev173.117）：以前是 `localPaths.has(path)` —— 只要本地有这个文件名
         * 就永远不再看，远端把同一路径的图换掉时两端会长期不一致。现在比指纹。
         */
        let localFp = null
        if (local) {
          try {
            // `localFpOf` 返回 `{ fp, bytes }`；以前把**对象**当指纹用，与字符串永远不等 ⇒
            // 本地同版也会每轮拉一次（rev173.126 修）
            const got = await localFpOf(local)
            localFp = got.fp
            // 这一轮真要上传的话，直接复用刚读到的字节，别再读一遍盘
            if (got.bytes) preloaded.set(path, got.bytes)
          } catch {
            localFp = null
          }
        }
        if (!needsAttachmentPull(localFp, entry)) continue
        // 版本不同且本地更新 ⇒ 本机改过、留给 pushLocal；否则远端更新 ⇒ 拉
        if (local && Number(local.mtime ?? 0) > Number(entry.at ?? 0)) continue
        // 云端那份放在哪由**上传方的模式**决定（条目里的 `mode`），不是本机设置
        const remoteMode = entry.mode === 'full' || entry.mode === 'relay' ? entry.mode : mode
        const src = remoteMode === 'full' ? path : `_zn/relay/${relayName(entry.fp, entry.ext || extOf(path))}`
        let got = null
        try {
          // 带上次的 ETag：远端没变 ⇒ 304，不用再传一遍字节（rev173.117）
          got = await client.getBytes(src, attEtag.get(src) ?? null)
        } catch (e) {
          api.host.log('warn', `下载附件失败 ${path}：${String(e)}`)
          continue
        }
        if (got?.notModified) {
          /**
           * 304 = 远端这份与我们**上次取到**的一样。本地文件如果就是那份（指纹对得上），
           * 说明是本地被改动过、而远端没动 —— 不覆盖用户的本地文件；否则我们手上没有
           * 可用的字节，只能补一次完整下载。
           */
          if (localFp && localFp === entry.fp) continue
          try {
            got = await client.getBytes(src)
          } catch (e) {
            api.host.log('warn', `下载附件失败 ${path}：${String(e)}`)
            continue
          }
        }
        if (!got?.data) continue
        try {
          await api.fs.writeBytes(path, got.data)
        } catch (e) {
          api.host.log('warn', `写入附件失败 ${path}：${String(e)}`)
          continue
        }
        if (got.etag) attEtag.set(src, got.etag)
        // 刚写完，`listNotes` 的 mtime / size 变了 ⇒ 丢掉旧指纹，下一轮重新算一次
        attFpCache.delete(path)
        // 本地已被远端版覆盖 ⇒ 丢弃「算指纹时读到的旧字节」，否则下一句上传会拿旧内容推回去
        preloaded.delete(path)
        summary.pulled += 1
        if (remoteMode === 'relay') {
          await client.mkdir('_zn/relay-ack')
          await client.putBytes(`_zn/relay-ack/${relayName(entry.fp, '')}`, new TextEncoder().encode(me))
        }
      }

      await pushLocal()

      // ③ relay 清理：有 ack 就删云端副本（任何端都能做，幂等）
      /**
       * **每轮最多查一个条目**（rev173.284 · 真人测试二「又限流 503」）。
       *
       * 每个 relay 条目一次 PROPFIND：11 张图 × 12 轮/分 = 132 次/分 —— 光这一项就能
       * 打满坚果云 600 次/30 分钟的限额（对端没上线时条目会一直停在「未 ack」）。
       * ack 是「对端取走附件」这种低频事件，轮转查的延迟（11 个条目 ≈ 55 秒）没有体感；
       * 但请求量从 132 次/分降到 12 次/分。
       */
      const relayEntries = Object.entries(nextAtt).filter(([, e]) => {
        if (!e || e.cleaned) return false
        // 只有「云端那份确实在 relay 路径上」的条目才有 ack 可等（full 条目永不清理）
        const m = e.mode === 'full' || e.mode === 'relay' ? e.mode : mode
        return m === 'relay'
      })
      if (relayEntries.length > 0) {
        const [ackPath, ackEntry] = relayEntries[ackCursor % relayEntries.length]
        ackCursor += 1
        const acked = await client.exists(`_zn/relay-ack/${relayName(ackEntry.fp, '')}`)
        if (acked) {
          await client.remove(`_zn/relay/${relayName(ackEntry.fp, ackEntry.ext || extOf(ackPath))}`)
          nextAtt[ackPath] = { ...ackEntry, mode: 'relay', cleaned: true }
          changed = true
        }
      }

      return { attachments: nextAtt, changed }
    }

    /* ── 自动同步（「无感」就是这一段） ── */

    let autoTimer = null
    /**
     * 限流退避状态（rev173.279 · #12）：
     * `backoffLevel` = 已连撞几次限额（0 = 正常），`backoffUntil` = 退避到哪个时间点。
     * 退避期间 5 秒的节拍照跑，但**跳过不发请求** —— 保留节拍是为了成功后能自动恢复，
     * 不用用户手动重开。
     */
    let backoffLevel = 0
    let backoffUntil = 0

    /**
     * 开自动同步：前台每 `AUTO_MS` 跑一次。
     *
     * 三条约束（都对应一个真实坑）：
     * · **只在前台跑**：Android 切后台会挂起定时器（方案 §8 第 5 条，用户已接受这个边界），
     *   这里再判一道，免得在桌面端空转打远端；
     * · `busy` 时跳过：手动同步正在跑时不能再起一轮；
     * · 静默模式：没变化不刷面板（每 5 秒重渲染会把用户正在填的表单刷掉）。
     */
    function startAuto() {
      // 本地文件夹后端没有远端可轮询：它的「自动检查」由 folder 后端自己的事件 + 节拍负责
      if (settings.backend === 'folder') return
      if (autoTimer || !hasConfig()) return
      const timer = window.setInterval(() => {
        if (busy || !hasConfig()) return
        // 限流退避期：节拍照走、请求不发（成功后自动恢复，见 runSync 的 catch）
        if (Date.now() < backoffUntil) return
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
        void runSync('自动', { silent: true })
      }, AUTO_MS)
      autoTimer = timer
      api.subscriptions.push({
        __syncAuto: true,
        dispose: () => {
          window.clearInterval(timer)
          if (autoTimer === timer) autoTimer = null
        },
      })
    }

    function stopAuto() {
      const i = api.subscriptions.findIndex((s) => s && s.__syncAuto)
      if (i >= 0) {
        const [sub] = api.subscriptions.splice(i, 1)
        sub.dispose()
      }
      if (autoTimer) {
        window.clearInterval(autoTimer)
        autoTimer = null
      }
    }

    /* ── 面板 ── */

    /**
     * 冲突记录区块（**两个后端共用**）。
     *
     * 冲突副本的位置、结构、处理入口对两个后端完全一样（都在 `.zn/conflicts/<平台>/`），
     * 只有文案不同：文件夹后端没有「云端」可推，它的「另一边」是外部同步工具。
     */
    function conflictSection() {
      if (conflicts.length === 0) return []
      const isFolder = settings.backend === 'folder'
      return [
        { type: 'divider' },
        { type: 'text', value: `冲突记录 · ${conflicts.length} 条`, variant: 'title' },
        {
          type: 'text',
          value: isFolder
            ? '两边都改过的文件：选一边保留即可。选「本机版」会立刻写回，选「外部版」只清掉副本。'
            : '两边都改过的文件：选一边保留即可。选「本机版」会立刻写回并推上云端；选「远端版」只清掉副本。',
          variant: 'caption',
          tone: 'muted',
        },
        {
          type: 'list',
          items: conflicts.slice(0, 8).map((c) => {
            const where = c.file ? `${CONFLICT_ROOT}/${c.platform}/${c.file}` : null
            const base = { file: c.file, platform: c.platform, path: c.path }
            return {
              type: 'stack',
              gap: 'sm',
              children: [
                {
                  type: 'text',
                  value: `${new Date(c.at).toLocaleString()} · ${c.path}`,
                },
                ...(where
                  ? [
                      {
                        type: 'text',
                        value: `${where} · ${c.reason || '双端修改'}`,
                        variant: 'caption',
                        tone: 'muted',
                      },
                      /**
                       * **处理入口**（rev173.283 · 真人测试二 #2）。
                       *
                       * 以前这里只有「打开冲突副本」—— 打开之后没有任何动作能把结果落定，
                       * 用户只能自己去文件管理器里复制粘贴。现在两个方向都能一键收尾：
                       *   · 用本机版：把副本内容写回笔记 → 立刻推一轮（webdav）/ 对齐基线（folder）
                       *   · 保留另一边：当前笔记已经是那一边的版本 → 删副本 + 清记录
                       */
                      {
                        type: 'row',
                        gap: 'sm',
                        wrap: true,
                        children: [
                          {
                            type: 'button',
                            label: '用本机版',
                            onClick: 'sync.resolve-conflict',
                            payload: { ...base, choice: 'local' },
                          },
                          {
                            type: 'button',
                            label: isFolder ? '保留外部版' : '保留远端版',
                            onClick: 'sync.resolve-conflict',
                            payload: { ...base, choice: 'remote' },
                            variant: 'ghost',
                          },
                          {
                            type: 'button',
                            label: '看副本',
                            onClick: 'sync.open-conflict',
                            payload: { file: c.file, platform: c.platform },
                            variant: 'ghost',
                          },
                        ],
                      },
                    ]
                  : [
                      {
                        type: 'text',
                        value: '（本机版没留下来，只能保留另一边）',
                        variant: 'caption',
                        tone: 'muted',
                      },
                    ]),
              ],
            }
          }),
        },
      ]
    }

    /**
     * 后端选择器（面板最上面一块：一个插件，后端可换）。
     *
     * 用**按钮**而不是 select：契约里的 `select` 只认 `state[bind]`，render 拿不到写 state
     * 的权限 ⇒ 初始选中项会永远停在第一项（用户上次选的 folder 显示成 webdav）。
     * 按钮 +「当前」徽章没有这个问题。
     */
    function backendPicker() {
      const isFolder = settings.backend === 'folder'
      const isS3 = settings.backend === 's3'
      const isGit = settings.backend === 'git'
      const label = isFolder ? '本地文件夹' : isS3 ? 'S3' : isGit ? 'Git' : 'WebDAV'
      return {
        type: 'row',
        gap: 'sm',
        wrap: true,
        children: [
          { type: 'badge', text: `当前：${label}`, tone: 'success' },
          {
            type: 'button',
            label: 'WebDAV',
            onClick: 'sync.set-backend',
            payload: { value: 'webdav' },
            variant: !isFolder && !isS3 && !isGit ? 'solid' : 'ghost',
          },
          {
            type: 'button',
            label: 'S3',
            onClick: 'sync.set-backend',
            payload: { value: 's3' },
            variant: isS3 ? 'solid' : 'ghost',
          },
          {
            type: 'button',
            label: 'Git',
            onClick: 'sync.set-backend',
            payload: { value: 'git' },
            variant: isGit ? 'solid' : 'ghost',
          },
          {
            type: 'button',
            label: '本地文件夹',
            onClick: 'sync.set-backend',
            payload: { value: 'folder' },
            variant: isFolder ? 'solid' : 'ghost',
          },
        ],
      }
    }

    /**
     * 本地文件夹后端的面板。
     *
     * 结构 = 一句话说明 + 后端选择 +（`folder.renderSection()` 的统计 / 按钮 / `.zn` 提醒）
     * + 共用冲突区段。刻意**不显示** WebDAV 的地址 / 密码 / 附件表单 —— 那些在这个后端下
     * 一个都不生效，摆着只会让人以为配了就同步。
     */
    function folderPanel() {
      const children = [
        {
          type: 'text',
          value: '同步方式：**本地文件夹**（本插件不搬文件）。库放在同步目录里，搬运交给 Syncthing / OneDrive / 坚果云客户端；插件只负责判定冲突、留副本。',
          variant: 'caption',
          tone: 'muted',
        },
        { type: 'spacer', size: 'sm' },
        backendPicker(),
        { type: 'divider' },
        ...folder.renderSection(),
        ...conflictSection(),
      ]
      return { type: 'stack', gap: 'md', children }
    }

    /**
     * S3 后端的面板。
     *
     * 字段与 WebDAV 不同（没有"目录"，有的是桶 / 区域 / 前缀），所以单开一份；
     * 附件模式、自动开关、冲突区段**与 WebDAV 完全同义** —— 它们属于引擎，不属于协议。
     */
    function s3Panel(ctx) {
      const state = (ctx && ctx.state) || {}
      // 宿主把用户输入写进 state；已保存的值当兜底（与 WebDAV 表单同一个做法，见 render）
      form = {
        endpoint: String(state['sync.s3.endpoint'] || settings.endpoint || ''),
        region: String(state['sync.s3.region'] || settings.region || ''),
        bucket: String(state['sync.s3.bucket'] || settings.bucket || ''),
        accessKey: String(state['sync.s3.accessKey'] || settings.accessKey || ''),
        secret: String(state['sync.s3.secret'] || ''),
        prefix: String(state['sync.s3.prefix'] || settings.prefix || ''),
      }
      const configured = hasConfig()
      const children = [
        {
          type: 'text',
          value: '同步方式：**S3 兼容存储**（插件自己搬）。Secret 存系统凭据库，其余存插件设置。',
          variant: 'caption',
          tone: 'muted',
        },
        { type: 'spacer', size: 'sm' },
        backendPicker(),
        { type: 'divider' },
        { type: 'text', value: configured ? '已配置' : '还没配置', variant: 'title' },
        ...(configured
          ? [
              {
                type: 'text',
                value: `当前：${settings.endpoint} · 桶 ${settings.bucket} · 区域 ${settings.region || 'us-east-1'} · 前缀 ${settings.prefix || '（根）'}`,
                variant: 'caption',
              },
            ]
          : []),
        {
          type: 'field',
          label: 'Endpoint',
          hint: '例：https://s3.ap-east-1.amazonaws.com · http://127.0.0.1:9000（MinIO）',
          children: { type: 'input', bind: 'sync.s3.endpoint', placeholder: 'https://…' },
        },
        {
          type: 'field',
          label: '区域',
          hint: 'AWS 填地域（如 ap-east-1）；MinIO / R2 一般留 us-east-1',
          children: { type: 'input', bind: 'sync.s3.region', placeholder: 'us-east-1' },
        },
        {
          type: 'field',
          label: '桶名',
          children: { type: 'input', bind: 'sync.s3.bucket', placeholder: 'zeronote' },
        },
        {
          type: 'field',
          label: 'Access Key ID',
          children: { type: 'input', bind: 'sync.s3.accessKey', placeholder: 'AKIA…' },
        },
        {
          type: 'field',
          label: 'Secret Access Key',
          hint: '只写在这里；保存后存进系统凭据库',
          children: { type: 'input', bind: 'sync.s3.secret', secret: true, placeholder: '不改就留空' },
        },
        {
          type: 'field',
          label: '对象前缀',
          hint: '可选：把笔记放在桶里某个子目录下',
          children: { type: 'input', bind: 'sync.s3.prefix', placeholder: 'ZeroNote' },
        },
        {
          type: 'field',
          label: '附件（图片 / PDF）',
          hint: '不同步 = 只同步 .md；中转 = 对端收到后云端副本删掉（省空间）；永久 = 与文档一样',
          children: {
            type: 'select',
            bind: 'sync.attachmentsMode',
            options: [
              { value: 'off', label: '不同步（默认）' },
              { value: 'relay', label: '同步中转（云端不常留）' },
              { value: 'full', label: '与文档一样永久同步' },
            ],
            onSubmit: 'sync.set-attachments',
          },
        },
        {
          type: 'row',
          gap: 'sm',
          wrap: true,
          children: [
            { type: 'button', label: '保存设置', onClick: 'sync.save' },
            { type: 'button', label: '测试连接', onClick: 'sync.test', variant: 'ghost' },
            { type: 'button', label: '立即同步', onClick: 'sync.run', disabled: !configured || busy },
            {
              type: 'button',
              label: settings.auto === false ? '开启自动同步' : '关闭自动同步',
              onClick: 'sync.toggle-auto',
              variant: 'ghost',
            },
            { type: 'button', label: '断开连接', onClick: 'sync.disconnect', variant: 'danger' },
          ],
        },
        {
          type: 'row',
          gap: 'sm',
          wrap: true,
          children: [
            {
              type: 'badge',
              text:
                settings.auto === false
                  ? '手动同步'
                  : backoffUntil > Date.now()
                    ? `自动 · 限流退避中（${Math.ceil((backoffUntil - Date.now()) / 1000)} 秒后重试）`
                    : '自动 · 前台每 5 秒',
              tone: settings.auto === false ? 'muted' : backoffUntil > Date.now() ? 'warn' : 'success',
            },
            ...(busy ? [{ type: 'badge', text: '正在同步…', tone: 'warn' }] : []),
          ],
        },
      ]

      if (formError) children.push({ type: 'text', value: formError, tone: 'danger', variant: 'caption' })

      if (lastResult) {
        children.push({ type: 'divider' })
        children.push({
          type: 'row',
          gap: 'sm',
          wrap: true,
          children: [
            { type: 'badge', text: `下载 ${lastResult.pulled}`, tone: 'default' },
            { type: 'badge', text: `上传 ${lastResult.pushed}`, tone: 'default' },
            ...(lastResult.merged > 0 ? [{ type: 'badge', text: `合并 ${lastResult.merged}`, tone: 'success' }] : []),
            {
              type: 'badge',
              text: `冲突 ${lastResult.conflicts}`,
              tone: lastResult.conflicts > 0 ? 'danger' : 'success',
            },
          ],
        })
        children.push({
          type: 'text',
          value: `${new Date(lastResult.at).toLocaleString()} · ${lastResult.hint || ''}`,
          variant: 'caption',
          tone: 'muted',
        })
      }

      children.push(...conflictSection())
      return { type: 'stack', gap: 'md', children }
    }

    /**
     * Git 后端的面板。
     *
     * 走仓库 Contents API（GitHub / Gitea / Gitee）：字段是平台 + 所有者 + 仓库 + 分支，
     * 没有「目录」的概念（前缀只是把笔记放进子目录）。
     */
    function gitPanel(ctx) {
      const state = (ctx && ctx.state) || {}
      form = {
        provider: String(state['sync.git.provider'] || settings.provider || 'github'),
        apiBase: String(state['sync.git.apiBase'] || settings.apiBase || ''),
        owner: String(state['sync.git.owner'] || settings.owner || ''),
        repo: String(state['sync.git.repo'] || settings.repo || ''),
        branch: String(state['sync.git.branch'] || settings.branch || ''),
        gitPrefix: String(state['sync.git.prefix'] || settings.repoPrefix || ''),
        token: String(state['sync.git.token'] || ''),
      }
      const configured = hasConfig()
      const preset = PROVIDERS[settings.provider] ?? PROVIDERS.github
      return {
        type: 'stack',
        gap: 'md',
        children: [
          {
            type: 'text',
            value: '同步方式：**Git 仓库**（插件自己搬）。令牌存系统凭据库，仓库信息存插件设置。',
            variant: 'caption',
            tone: 'muted',
          },
          { type: 'spacer', size: 'sm' },
          backendPicker(),
          { type: 'divider' },
          { type: 'text', value: configured ? '已配置' : '还没配置', variant: 'title' },
          ...(configured
            ? [
                {
                  type: 'text',
                  value: `当前：${preset.label} · ${settings.owner}/${settings.repo} · 分支 ${settings.branch || 'main'} · 前缀 ${settings.repoPrefix || '（根）'}`,
                  variant: 'caption',
                },
              ]
            : []),
          {
            type: 'field',
            label: '平台',
            hint: 'GitHub / Gitea / Gitee —— 三家 API 形状不同，写方法与认证方式由插件按平台选',
            children: {
              type: 'row',
              gap: 'sm',
              wrap: true,
              children: ['github', 'gitea', 'gitee'].map((key) => ({
                type: 'button',
                label: PROVIDERS[key].label,
                onClick: 'sync.set-provider',
                payload: { value: key },
                variant: settings.provider === key ? 'solid' : 'ghost',
              })),
            },
          },
          {
            type: 'field',
            label: 'API 根',
            hint: '留空用平台预设（自建 Gitea / 代理时再填）',
            children: {
              type: 'input',
              bind: 'sync.git.apiBase',
              placeholder: preset.api,
            },
          },
          {
            type: 'field',
            label: '所有者',
            hint: 'GitHub 用户名或组织名',
            children: { type: 'input', bind: 'sync.git.owner', placeholder: 'aqua' },
          },
          {
            type: 'field',
            label: '仓库',
            children: { type: 'input', bind: 'sync.git.repo', placeholder: 'zeronote-vault' },
          },
          {
            type: 'field',
            label: '分支',
            hint: '留空默认 main',
            children: { type: 'input', bind: 'sync.git.branch', placeholder: 'main' },
          },
          {
            type: 'field',
            label: '对象前缀',
            hint: '可选：把笔记放进仓库的子目录',
            children: { type: 'input', bind: 'sync.git.prefix', placeholder: 'notes' },
          },
          {
            type: 'field',
            label: '访问令牌',
            hint: '只写在这里；保存后存进系统凭据库（GitHub 需要 repo 权限）',
            children: { type: 'input', bind: 'sync.git.token', secret: true, placeholder: '不改就留空' },
          },
          {
            type: 'field',
            label: '附件（图片 / PDF）',
            hint: '不同步 = 只同步 .md；中转 = 对端收到后云端副本删掉；永久 = 与文档一样',
            children: {
              type: 'select',
              bind: 'sync.attachmentsMode',
              options: [
                { value: 'off', label: '不同步（默认）' },
                { value: 'relay', label: '同步中转（云端不常留）' },
                { value: 'full', label: '与文档一样永久同步' },
              ],
              onSubmit: 'sync.set-attachments',
            },
          },
          {
            type: 'row',
            gap: 'sm',
            wrap: true,
            children: [
              { type: 'button', label: '保存设置', onClick: 'sync.save' },
              { type: 'button', label: '测试连接', onClick: 'sync.test', variant: 'ghost' },
              { type: 'button', label: '立即同步', onClick: 'sync.run', disabled: !configured || busy },
              {
                type: 'button',
                label: settings.auto === false ? '开启自动同步' : '关闭自动同步',
                onClick: 'sync.toggle-auto',
                variant: 'ghost',
              },
              { type: 'button', label: '断开连接', onClick: 'sync.disconnect', variant: 'danger' },
            ],
          },
          {
            type: 'row',
            gap: 'sm',
            wrap: true,
            children: [
              {
                type: 'badge',
                text:
                  settings.auto === false
                    ? '手动同步'
                    : backoffUntil > Date.now()
                      ? `自动 · 限流退避中（${Math.ceil((backoffUntil - Date.now()) / 1000)} 秒后重试）`
                      : '自动 · 前台每 5 秒',
                tone: settings.auto === false ? 'muted' : backoffUntil > Date.now() ? 'warn' : 'success',
              },
              ...(busy ? [{ type: 'badge', text: '正在同步…', tone: 'warn' }] : []),
            ],
          },
          ...(formError
            ? [{ type: 'text', value: formError, tone: 'danger', variant: 'caption' }]
            : []),
          ...(lastResult
            ? [
                { type: 'divider' },
                {
                  type: 'row',
                  gap: 'sm',
                  wrap: true,
                  children: [
                    { type: 'badge', text: `下载 ${lastResult.pulled}`, tone: 'default' },
                    { type: 'badge', text: `上传 ${lastResult.pushed}`, tone: 'default' },
                    ...(lastResult.merged > 0
                      ? [{ type: 'badge', text: `合并 ${lastResult.merged}`, tone: 'success' }]
                      : []),
                    {
                      type: 'badge',
                      text: `冲突 ${lastResult.conflicts}`,
                      tone: lastResult.conflicts > 0 ? 'danger' : 'success',
                    },
                  ],
                },
                {
                  type: 'text',
                  value: `${new Date(lastResult.at).toLocaleString()} · ${lastResult.hint || ''}`,
                  variant: 'caption',
                  tone: 'muted',
                },
              ]
            : []),
          ...conflictSection(),
        ],
      }
    }

    function render(ctx) {
      // 本地文件夹后端：面板整体换一套（没有地址 / 密码 / 附件表单）
      if (settings.backend === 'folder') return folderPanel()
      if (settings.backend === 's3') return s3Panel(ctx)
      if (settings.backend === 'git') return gitPanel(ctx)
      const state = (ctx && ctx.state) || {}
      // 宿主把用户输入写进 state；已保存的值当兜底（这样重开面板能看到上次配的地址）
      // ⚠️ 用 `||` 不是 `??`：宿主会把 bind 初始化成**空字符串**，`??` 认空串为有值 ⇒ 预填失效
      form = {
        baseUrl: String(state['sync.baseUrl'] || settings.baseUrl || ''),
        username: String(state['sync.username'] || settings.username || ''),
        password: String(state['sync.password'] || ''),
        root: String(state['sync.root'] || settings.root || ''),
      }
      const configured = !!settings.baseUrl
      const children = [
        {
          type: 'text',
          value: '同步方式：**WebDAV**（插件自己搬）。密码存系统凭据库，地址与账号存插件设置。',
          variant: 'caption',
          tone: 'muted',
        },
        { type: 'spacer', size: 'sm' },
        backendPicker(),
        { type: 'divider' },
        { type: 'text', value: configured ? '已配置' : '还没配置', variant: 'title' },
        ...(configured
          ? [
              {
                type: 'text',
                value: `当前：${settings.baseUrl}${settings.root ? ` · 目录 ${settings.root}` : ' · **目录为空**（坚果云等不可写根目录）'} · 账号 ${settings.username || '（空）'}`,
                variant: 'caption',
              },
            ]
          : []),
        {
          type: 'field',
          label: 'WebDAV 地址',
          hint: '例：https://dav.jianguoyun.com/dav/',
          children: {
            type: 'input',
            bind: 'sync.baseUrl',
            placeholder: 'https://…/dav/',
          },
        },
        {
          type: 'field',
          label: '账号',
          children: { type: 'input', bind: 'sync.username', placeholder: '邮箱 / 用户名' },
        },
        {
          type: 'field',
          label: '密码 / 应用密码',
          hint: '只写在这里；保存后存进系统凭据库',
          /* rev173.275 · 真人使用测试 #14：以前是明文 input，保存后密码就摊在屏幕上。
             契约里的 `secret: true` 渲染成密码框（圆点），是对齐 `secrets` 密码库的做法。 */
          children: { type: 'input', bind: 'sync.password', secret: true, placeholder: '不改就留空' },
        },
        {
          type: 'field',
          label: '同步目录',
          hint: '远端放笔记的子目录。**坚果云的 WebDAV 根不可写，必须填**（如 ZeroNote）',
          children: { type: 'input', bind: 'sync.root', placeholder: settings.root || 'ZeroNote' },
        },
        {
          type: 'field',
          label: '附件（图片 / PDF）',
          hint: '不同步 = 只同步 .md；中转 = 对端收到后云端副本删掉（省空间）；永久 = 与文档一样',
          children: {
            type: 'select',
            bind: 'sync.attachmentsMode',
            options: [
              { value: 'off', label: '不同步（默认）' },
              { value: 'relay', label: '同步中转（云端不常留）' },
              { value: 'full', label: '与文档一样永久同步' },
            ],
            onSubmit: 'sync.set-attachments',
          },
        },
        {
          type: 'row',
          gap: 'sm',
          wrap: true,
          children: [
            { type: 'button', label: '保存设置', onClick: 'sync.save' },
            { type: 'button', label: '测试连接', onClick: 'sync.test', variant: 'ghost' },
            { type: 'button', label: '立即同步', onClick: 'sync.run', disabled: !configured || busy },
            {
              type: 'button',
              label: settings.auto === false ? '开启自动同步' : '关闭自动同步',
              onClick: 'sync.toggle-auto',
              variant: 'ghost',
            },
            { type: 'button', label: '断开连接', onClick: 'sync.disconnect', variant: 'danger' },
          ],
        },
        {
          type: 'row',
          gap: 'sm',
          wrap: true,
          children: [
            {
              type: 'badge',
              /**
               * 限流退避中要**说出来**（rev173.279 · #12）：否则面板一直写「自动 · 前台每 5 秒」，
               * 而实际已经拉到 60 秒一轮 —— 用户会以为同步还在高频打远端。
               */
              text:
                settings.auto === false
                  ? '手动同步'
                  : backoffUntil > Date.now()
                    ? `自动 · 限流退避中（${Math.ceil((backoffUntil - Date.now()) / 1000)} 秒后重试）`
                    : '自动 · 前台每 5 秒',
              tone: settings.auto === false ? 'muted' : backoffUntil > Date.now() ? 'warn' : 'success',
            },
            ...(busy ? [{ type: 'badge', text: '正在同步…', tone: 'warn' }] : []),
          ],
        },
      ]

      if (formError) children.push({ type: 'text', value: formError, tone: 'danger', variant: 'caption' })

      if (lastResult) {
        children.push({ type: 'divider' })
        children.push({ type: 'text', value: '上次同步', variant: 'title' })
        children.push({
          type: 'row',
          gap: 'sm',
          wrap: true,
          children: [
            { type: 'badge', text: `下载 ${lastResult.pulled}`, tone: 'default' },
            { type: 'badge', text: `上传 ${lastResult.pushed}`, tone: 'default' },
            // rev173.115：三方合并成功数（有真冲突段时仍进「冲突」）
            ...(lastResult.merged > 0
              ? [{ type: 'badge', text: `合并 ${lastResult.merged}`, tone: 'success' }]
              : []),
            {
              type: 'badge',
              text: `冲突 ${lastResult.conflicts}`,
              tone: lastResult.conflicts > 0 ? 'danger' : 'success',
            },
          ],
        })
        children.push({
          type: 'text',
          value: `${new Date(lastResult.at).toLocaleString()} · ${lastResult.hint || ''}`,
          variant: 'caption',
          tone: 'muted',
        })
        /**
         * 耗时（rev173.117）：总时长 + 三个阶段的拆分。
         * 附件阶段为 0（模式 = 不同步 / 没有附件）时不显示，免得平白多两个 0。
         */
        if (lastResult.ms) {
          const ms = lastResult.ms
          children.push({
            type: 'row',
            gap: 'sm',
            wrap: true,
            children: [
              { type: 'badge', text: `用时 ${fmtMs(ms.total)}`, tone: 'muted' },
              { type: 'badge', text: `manifest ${fmtMs(ms.manifest)}`, tone: 'muted' },
              { type: 'badge', text: `笔记 ${fmtMs(ms.notes)}`, tone: 'muted' },
              ...(ms.attachments > 0
                ? [{ type: 'badge', text: `附件 ${fmtMs(ms.attachments)}`, tone: 'muted' }]
                : []),
            ],
          })
        }
      }

      /**
       * 耗时趋势（rev173.119）：最近若干次的平均 / 最慢 + 一条 sparkline。
       *
       * **刻意放在 `lastResult` 之外**：历史是落 store 的，重启 / 重开面板后
       * `lastResult`（本进程的内存值）是空的 —— 挂在里面就等于"每次开 App 都看不到趋势"。
       * 只有 1 条记录时不画（单点没有"趋势"可言）。
       */
      const trend = timingSummary(timingHistory)
      if (trend && trend.count > 1) {
        if (!lastResult) children.push({ type: 'divider' })
        children.push({
          type: 'text',
          value: `最近 ${trend.count} 次：平均 ${fmtMs(trend.avg)} · 最慢 ${fmtMs(trend.max)}`,
          variant: 'caption',
          tone: 'muted',
        })
        const line = sparkline(timingHistory.map((e) => e.total))
        if (line) children.push({ type: 'code', value: line })
      }

      children.push(...conflictSection())

      return { type: 'stack', gap: 'md', children }
    }

    const register = (id, title, run) => api.command.register({ id, title, run })

    async function openPanel() {
      for (let i = 0; i < 5; i += 1) {
        try {
          await api.command.execute(`core.panel.${PANEL_ID}`)
          return
        } catch {
          if (i === 4) return
          await new Promise((r) => setTimeout(r, 120))
        }
      }
    }

    /** 从表单读值保存（密码空 = 不改） */
    async function saveSettings() {
      if (settings.backend === 's3') return saveS3Settings()
      if (settings.backend === 'git') return saveGitSettings()
      formError = null
      const baseUrl = String(form.baseUrl ?? '').trim()
      if (!baseUrl) {
        formError = '地址不能为空'
        api.view.refresh()
        return
      }
      if (!/^https?:\/\//i.test(baseUrl)) {
        formError = '地址要以 http:// 或 https:// 开头'
        api.view.refresh()
        return
      }
      settings = {
        // 保留既有字段：以前整体覆盖会把 `auto` / `attachments` 冲掉 ——
        // 保存一次设置，附件模式回到「不同步」、自动同步开关也跟着错位（2026-10-24 修）。
        ...settings,
        baseUrl,
        username: String(form.username ?? '').trim(),
        root: String(form.root ?? '').trim().replace(/^\/+|\/+$/g, ''),
        enabled: true,
      }
      const pwd = String(form.password ?? '')
      if (pwd) {
        try {
          await api.host.secrets.set(SECRET_KEY, pwd)
          savedPasswords.set('p', pwd)
        } catch (e) {
          formError = `密码写入系统凭据库失败：${String(e)}`
          api.view.refresh()
          return
        }
      }
      markDirty()
      // 配好了就开自动同步（用户选「无感」；关闭的开关在面板上）
      if (settings.auto !== false) startAuto()
      api.host.notify('同步设置已保存')
      api.view.refresh()
    }

    /**
     * 保存 S3 设置（rev173.287）。
     *
     * Secret 与 WebDAV 密码同一套规矩：**只写在这里**，保存后进系统凭据库，
     * 面板上不再回显（`savedS3Secret` 缓存只用于本进程后续请求）。
     */
    async function saveS3Settings() {
      formError = null
      const endpoint = String(form.endpoint ?? '').trim()
      const bucket = String(form.bucket ?? '').trim()
      const accessKey = String(form.accessKey ?? '').trim()
      if (!endpoint) {
        formError = 'Endpoint 不能为空'
        api.view.refresh()
        return
      }
      if (!/^https?:\/\//i.test(endpoint)) {
        formError = 'Endpoint 要以 http:// 或 https:// 开头'
        api.view.refresh()
        return
      }
      if (!bucket) {
        formError = '桶名不能为空'
        api.view.refresh()
        return
      }
      if (!accessKey) {
        formError = 'Access Key ID 不能为空'
        api.view.refresh()
        return
      }
      settings = {
        ...settings,
        endpoint: endpoint.replace(/\/+$/, ''),
        region: String(form.region ?? '').trim() || 'us-east-1',
        bucket,
        accessKey,
        prefix: String(form.prefix ?? '')
          .trim()
          .replace(/^\/+|\/+$/g, ''),
        enabled: true,
      }
      const sec = String(form.secret ?? '')
      if (sec) {
        try {
          await api.host.secrets.set(SECRET_S3_KEY, sec)
          savedS3Secret = sec
        } catch (e) {
          formError = `Secret 写入系统凭据库失败：${String(e)}`
          api.view.refresh()
          return
        }
      }
      markDirty()
      if (settings.auto !== false) startAuto()
      api.host.notify('S3 设置已保存')
      api.view.refresh()
    }

    /**
     * 保存 Git 设置（rev173.288）。
     *
     * 令牌与 WebDAV 密码 / S3 Secret 同一套规矩：只写在这里，保存后进系统凭据库。
     */
    async function saveGitSettings() {
      formError = null
      const owner = String(form.owner ?? '').trim()
      const repo = String(form.repo ?? '').trim()
      if (!owner || !repo) {
        formError = '所有者与仓库名都不能为空'
        api.view.refresh()
        return
      }
      const provider = PROVIDERS[settings.provider] ? settings.provider : 'github'
      settings = {
        ...settings,
        provider,
        apiBase: String(form.apiBase ?? '').trim().replace(/\/+$/, ''),
        owner,
        repo,
        branch: String(form.branch ?? '').trim() || 'main',
        repoPrefix: String(form.gitPrefix ?? '')
          .trim()
          .replace(/^\/+|\/+$/g, ''),
        enabled: true,
      }
      const token = String(form.token ?? '')
      if (token) {
        try {
          await api.host.secrets.set(SECRET_GIT_KEY, token)
          savedGitToken = token
        } catch (e) {
          formError = `令牌写入系统凭据库失败：${String(e)}`
          api.view.refresh()
          return
        }
      }
      markDirty()
      if (settings.auto !== false) startAuto()
      api.host.notify('Git 设置已保存')
      api.view.refresh()
    }

    api.view.registerPanel({ id: PANEL_ID, title: '同步', location: 'main', render })
    register('sync.open', '同步：打开设置与状态', () => openPanel())
    register('sync.save', '同步：保存 WebDAV 设置', () => {
      if (settings.backend === 'folder') {
        api.host.notify('当前是「本地文件夹」后端：它不需要地址与密码，文件由外部同步工具搬', 'warn')
        return
      }
      return saveSettings()
    })
    register('sync.test', '同步：测试连接', async () => {
      if (settings.backend === 'folder') {
        /**
         * 没有远端可测：能测的只有「外部同步工具有没有碰 `.zn/`」这件真实存在的事。
         *
         * 三种结论分开说（rev173.164 · 期 1c）：
         *  · 密码库有冲突副本 —— 两端都改过密码库，**必须人挑一份**
         *  · `.zn/` 有冲突痕迹 —— 同步工具没排除 `.zn/`，要把它加回排除
         *  · 都没有 —— 顺带把「想同步密码库该怎么放行」讲清楚
         */
        const hits = await folder.refreshZnTrace()
        const s = folder.stats()
        if (s.secretHits.length) {
          api.host.notify(
            `⚠ 密码库有 ${s.secretHits.length} 份同步冲突副本（例如 ${s.secretHits[0]}）—— 两端都改过密码库，请手动挑一份用`,
            'warn',
          )
          return
        }
        api.host.notify(
          hits.length
            ? `⚠ .zn/ 里有 ${hits.length} 个同步冲突副本（例如 ${hits[0]}）—— 同步工具没有排除它`
            : '.zn/ 没发现同步冲突痕迹（仍请确认同步工具的排除列表里有 .zn/）· 要同步密码库：放行 .zn/secrets/ 与 .zn/security/',
          hits.length ? 'warn' : 'info',
        )
        return
      }
      // 先停自动同步：否则 5 秒内那一轮会把「测试结果」从面板上覆盖掉（实测踩到）
      stopAuto()
      let ok = false
      try {
        const client = await makeClient()
        const r = await client.test()
        ok = r.ok
        api.host.notify(r.ok ? `连接正常（${r.status}）` : r.hint, r.ok ? 'info' : 'error')
        lastResult = { pulled: 0, pushed: 0, merged: 0, conflicts: 0, hint: r.hint, at: Date.now() }
      } catch (e) {
        api.host.notify(`连接测试失败：${String(e)}`, 'error')
        lastResult = { pulled: 0, pushed: 0, merged: 0, conflicts: 0, hint: `连接测试失败：${String(e)}`, at: Date.now() }
      } finally {
        // 测试通过才恢复自动同步（失败时保持停着，避免打远端锁号）
        if (ok && settings.baseUrl && settings.auto !== false) startAuto()
        // 失败 = 自动同步已被上面的 stopAuto() 停掉 ⇒ settings.auto 同步置 false，
        // 否则面板仍显示「关闭自动同步」（实际停了），用户不会知道要去手动重开。
        else if (!ok && settings.auto !== false) {
          settings.auto = false
          markDirty()
        }
      }
      api.view.refresh()
    })
    register('sync.run', '同步：立即同步一次', async () => {
      const r = await runSync('手动')
      if (settings.backend === 'folder') {
        api.host.notify(
          r?.skipped
            ? '正在检查中…'
            : `检查完成：更新 ${r?.updated ?? 0} · 移除 ${r?.removed ?? 0} · 冲突 ${r?.conflicts ?? 0}`,
        )
      }
      // 返回摘要：测试与调用方靠它判断「推了几篇 / 有没有冲突」
      return r
    })
    register('sync.set-attachments', '同步：设置附件同步方式', (payload) => {
      if (settings.backend === 'folder') {
        api.host.notify('「本地文件夹」后端不同步附件：图片由外部同步工具搬', 'warn')
        return
      }
      const v = String(payload?.value ?? 'off')
      settings.attachments = ['off', 'relay', 'full'].includes(v) ? v : 'off'
      markDirty()
      const label =
        settings.attachments === 'off'
          ? '不同步（只同步 .md）'
          : settings.attachments === 'relay'
            ? '同步中转（对端收到后云端删掉）'
            : '与文档一样永久同步'
      api.host.notify(`附件同步：${label}`)
      api.view.refresh()
    })
    register('sync.toggle-auto', '同步：开关自动同步', async () => {
      // 后端各有各的「自动」：folder 是事件 + 5 秒结算，webdav 是 5 秒轮询远端
      if (settings.backend === 'folder') return folder.toggleAuto()
      settings.auto = settings.auto === false
      if (settings.auto) startAuto()
      else stopAuto()
      markDirty()
      api.host.notify(
        settings.auto ? '自动同步已开启（前台每 5 秒检查一次）' : '自动同步已关闭（仍可手动同步）',
      )
      api.view.refresh()
    })
    /**
     * 切换后端（rev173.286）。
     *
     * 两件事必须按顺序做，否则状态会串：
     *   ① **先把当前后端的基线落盘**（`persistBaseline` 读的是旧的 `settings.backend`）
     *   ② 再换后端 + 读新后端自己的基线键（两个后端的 fp 语义不同，不能共用一份）
     *
     * 切换不动用户数据：文件、冲突副本、外部工具的配置都保持原样，只是「谁负责搬」变了。
     */
    register('sync.set-backend', '同步：切换同步方式（WebDAV / 本地文件夹）', async (payload) => {
      const next = String(payload?.value ?? '')
      if (next !== 'webdav' && next !== 's3' && next !== 'git' && next !== 'folder') return
      if (settings.backend === next) return
      await persistBaseline()
      folder.detach()
      stopAuto()
      settings.backend = next
      markDirty()
      try {
        const raw = (await api.store.get(baselineKey(), {})) ?? {}
        /**
         * 基线里的 `etag` 是**上一个协议**的（WebDAV 与 S3 的 ETag 不通用）——
         * 换后端时只留内容指纹，条件写会在下一轮重新取 etag，不会误判成冲突。
         */
        baseline = Object.fromEntries(
          Object.entries(raw instanceof Object ? raw : {}).map(([k, v]) => [
            k,
            v && typeof v === 'object' ? { fp: v.fp, at: v.at } : v,
          ]),
        )
        if (next === 'folder') await folder.load()
      } catch (e) {
        api.host.log('warn', `切换后端时读状态失败：${String(e)}`)
      }
      if (next === 'folder') {
        folder.attach()
        api.host.notify(
          '已切到「本地文件夹」：库放在同步目录里，搬运交给 Syncthing / OneDrive / 坚果云；记得在外部工具里排除 .zn/',
        )
      } else if (next === 's3') {
        if (hasConfig() && settings.auto !== false) startAuto()
        api.host.notify('已切到 S3：由插件自己搬文件（Endpoint / 桶 / 密钥在下面配）')
      } else if (next === 'git') {
        if (hasConfig() && settings.auto !== false) startAuto()
        api.host.notify('已切到 Git：由插件自己搬文件（平台 / 所有者 / 仓库 / 令牌在下面配）')
      } else {
        if (settings.baseUrl && settings.auto !== false) startAuto()
        api.host.notify('已切到 WebDAV：由插件自己搬文件（地址与密码在下面配）')
      }
      api.view.refresh()
    })
    register('sync.mark-baseline', '同步：把当前状态设为基线（本地文件夹）', async () => {
      if (settings.backend !== 'folder') {
        api.host.notify('「设为基线」只在本地文件夹后端可用', 'warn')
        return
      }
      await folder.markSynced()
    })
    register('sync.set-provider', '同步：选择 Git 平台（GitHub / Gitea / Gitee）', (payload) => {
      const v = String(payload?.value ?? '')
      if (!PROVIDERS[v]) return
      settings.provider = v
      markDirty()
      api.host.notify(`Git 平台：${PROVIDERS[v].label}（保存后生效）`)
      api.view.refresh()
    })
    register('sync.open-conflict', '同步：打开冲突副本', async (payload) => {
      const file = String(payload?.file ?? '')
      const plat = String(payload?.platform || platform)
      if (!file) {
        api.host.notify('没有可打开的冲突副本', 'warn')
        return
      }
      try {
        await api.command.execute('core.openNote', { path: `${CONFLICT_ROOT}/${plat}/${file}` })
      } catch (e) {
        api.host.notify(`打不开冲突副本：${String(e)}`, 'error')
      }
    })
    /**
     * **收尾一条冲突**（rev173.283 · 真人测试二 #2「只有冲突记录却没有办法处理冲突」）。
     *
     * `choice: 'local'` —— 用本机版：把 `.zn/conflicts/<平台>/<文件>` 的内容写回笔记，
     *   收尾后**立刻推一轮**。推送之所以成立：写回前先把基线对齐到「远端当前内容」，
     *   于是 `decideSync` 看到「本地变了、远端没变」⇒ push（而不是又判一次冲突）。
     *   远端这篇已经不在了 ⇒ 删基线 ⇒ 走 push-new（重新上传）。
     *
     * `choice: 'remote'` —— 保留远端版：冲突发生时本地已经被远端版覆盖过，当前笔记就是
     *   远端版，所以只需要删副本 + 清记录。
     *
     * 两种都幂等：记录已经不在 ⇒ 明确说一句，不重复动文件。
     */
    register('sync.resolve-conflict', '同步：处理一条冲突（保留本机版 / 远端版）', async (payload) => {
      // 文件夹后端没有「推上云端」这一步：写回 = 覆盖磁盘，外部工具下一轮会把新版搬走
      if (settings.backend === 'folder') return folder.resolveConflict(payload)
      const file = String(payload?.file ?? '')
      const plat = String(payload?.platform || platform)
      const path = String(payload?.path ?? '')
      const choice = payload?.choice === 'remote' ? 'remote' : 'local'
      const idx = conflicts.findIndex((c) => c.path === path && c.platform === plat)
      if (idx < 0) {
        api.host.notify('这条冲突已经不在了（可能刚刚处理过）', 'warn')
        api.view.refresh()
        return
      }
      const conflictPath = file ? `${CONFLICT_ROOT}/${plat}/${file}` : null
      const dropRecord = async () => {
        // 按 path 重新定位：这段是异步的，中途可能有新冲突 unshift 进来
        const at = conflicts.findIndex((c) => c.path === path && c.platform === plat)
        if (at >= 0) conflicts.splice(at, 1)
        await api.store.set(KEY_CONFLICTS, conflicts).catch(() => {})
      }
      const dropCopy = async () => {
        if (!conflictPath) return
        try {
          await api.fs.purgePrivate(conflictPath)
        } catch (e) {
          // 删不掉不算失败（下次还能再删）；不能因此把记录留着让用户以为没处理
          api.host.log('warn', `冲突副本删除失败：${String(e)}`)
        }
      }

      if (choice === 'remote') {
        await dropCopy()
        await dropRecord()
        api.host.notify(`已保留远端版：${path}`)
        api.view.refresh()
        return
      }

      if (!conflictPath) {
        api.host.notify('这条冲突没有留下本机副本，无法用本机版覆盖', 'warn')
        api.view.refresh()
        return
      }
      let localText = null
      try {
        localText = await api.fs.readText(conflictPath)
      } catch {
        localText = null
      }
      if (localText == null) {
        api.host.notify('冲突副本读不到（可能已被清理）', 'error')
        api.view.refresh()
        return
      }
      if (!settings.baseUrl) {
        api.host.notify('还没配置 WebDAV，先写回本机，配好后手动同步一次', 'warn')
      }
      // ① 先写回本机（这一步失败就什么都别做，副本还在）
      try {
        await api.fs.writeText(path, localText)
      } catch (e) {
        api.host.notify(`写回本机版失败：${String(e)}`, 'error')
        api.view.refresh()
        return
      }
      let pushed = false
      try {
        const client = await makeClient()
        /**
         * **不走 `runSync` 的方向判定，直接推**。
         *
         * 冲突收尾是"人已经做了决定"的动作，不该再让 `decideSync` 猜一遍：远端 manifest
         * 里这一条可能已经过期（远端删过 / 412 场景），按普通判定会再判成一次冲突，
         * 用户点了两次还是没结果。所以这里强制 PUT + 同步改 manifest 这一条 ——
         * 结果确定：远端 = 本机版，基线与 manifest 一起对齐。
         */
        const res = await client.put(path, localText, undefined)
        if (res.ok) {
          const fp = fingerprint(localText)
          baseline[path] = { fp, etag: res.etag ?? undefined }
          try {
            const remote = (await client.readManifest()) || {}
            const files = { ...(remote.files || {}) }
            files[path] = { fp, etag: res.etag ?? undefined, at: Date.now() }
            await client.writeManifest({
              files,
              attachments: remote.attachments || {},
              private: remote.private || {},
              privateTree: remote.privateTree || {},
            })
          } catch (e) {
            // manifest 没写进去不算失败（下一轮同步会按「本地变、远端没变」补齐）
            api.host.log('warn', `冲突收尾后更新 manifest 失败：${String(e)}`)
          }
          pushed = true
        } else {
          api.host.notify(`写回了本机版，但上传失败（${res.status}），下一轮同步会重试`, 'warn')
        }
      } catch (e) {
        api.host.notify(`写回了本机版，但上传失败：${String(e)}`, 'warn')
      }
      await dropCopy()
      await dropRecord()
      await api.store.set(KEY_BASELINE, baseline).catch(() => {})
      api.host.notify(pushed ? `已用本机版覆盖并推送：${path}` : `已写回本机版：${path}`)
      api.view.refresh()
    })
    register('sync.disconnect', '同步：断开并清除凭据', async () => {
      if (settings.backend === 'folder') {
        /**
         * 文件夹后端「断开」= 清掉基线（下次启用重新建立）。
         * **不动任何文件** —— 笔记、冲突副本、外部工具的配置都不归它管。
         */
        folder.detach()
        baseline = {}
        await persistBaseline()
        api.host.notify('已清除本地文件夹后端的基线（文件本身没动；重新启用会重新建立）')
        api.view.refresh()
        return
      }
      if (settings.backend === 's3') {
        try {
          await api.host.secrets.delete(SECRET_S3_KEY)
        } catch (e) {
          api.host.log('warn', `删除 S3 密钥失败：${String(e)}`)
        }
        savedS3Secret = null
        settings = { ...settings, endpoint: '', bucket: '', accessKey: '', prefix: '', enabled: false }
        baseline = {}
        manifestCache = null
        stopAuto()
        markDirty()
        void api.store.set(KEY_BASELINE, {}).catch(() => {})
        api.host.notify('已断开 S3 并清除密钥')
        api.view.refresh()
        return
      }
      if (settings.backend === 'git') {
        try {
          await api.host.secrets.delete(SECRET_GIT_KEY)
        } catch (e) {
          api.host.log('warn', `删除 Git 令牌失败：${String(e)}`)
        }
        savedGitToken = null
        settings = { ...settings, owner: '', repo: '', enabled: false }
        baseline = {}
        manifestCache = null
        stopAuto()
        markDirty()
        void api.store.set(KEY_BASELINE, {}).catch(() => {})
        api.host.notify('已断开 Git 并清除令牌')
        api.view.refresh()
        return
      }
      try {
        await api.host.secrets.delete(SECRET_KEY)
      } catch (e) {
        api.host.log('warn', `删除凭据失败：${String(e)}`)
      }
      savedPasswords.clear()
      // 保留 backend / auto / attachments：以前整体覆盖会把「当前是哪个后端」冲掉
      settings = { ...settings, baseUrl: '', username: '', root: '', enabled: false }
      baseline = {}
      manifestCache = null
      markDirty()
      void api.store.set(KEY_BASELINE, {}).catch(() => {})
      api.host.notify('已断开 WebDAV 并清除密码')
      api.view.refresh()
    })

    void (async () => {
      try {
        settings = { ...settings, ...((await api.store.get(KEY_SETTINGS, {})) ?? {}) }
        /**
         * 基线**按当前后端取**（rev173.286）：webdav 的 fp 是远端内容、folder 的是磁盘内容，
         * 混用会让第一次判定把「自家刚同步过的文件」当成外部改动 —— 各存一份互不干扰。
         */
        baseline = (await api.store.get(baselineKey(), {})) ?? {}
        conflicts = (await api.store.get(KEY_CONFLICTS, [])) ?? []
        timingHistory = (await api.store.get(KEY_TIMING, [])) ?? []
        if (settings.backend === 'folder') await folder.load()
      } catch (e) {
        api.host.log('warn', `同步设置读取失败：${String(e)}`)
      }
      ready = true
      api.view.refresh()

      if (settings.backend === 'folder') {
        // 文件夹后端：事件 + 5 秒结算。**不判 baseUrl** —— 它根本不需要远端地址
        folder.attach()
      } else if (hasConfig() && settings.auto !== false) {
        // 已配置且没关自动 ⇒ 起来就开始近实时
        startAuto()
      }

      // 切回前台立刻补一次（后台期间定时器被挂起，不能只靠 5 秒节拍）
      const onVisible = () => {
        if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
        // 文件夹后端的补扫由它自己的 visibilitychange 监听负责（见 folder.attach）
        if (settings.backend === 'folder') return
        if (!hasConfig()) return
        void runSync('回到前台', { silent: true })
      }
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
      api.subscriptions.push({
        dispose: () => {
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
        },
      })

      const backendLabel =
        settings.backend === 'folder'
          ? '本地文件夹'
          : settings.backend === 's3'
            ? `S3 ${hasConfig() ? '已配置' : '未配置'}`
            : `WebDAV ${settings.baseUrl ? '已配置' : '未配置'}`
      api.host.log(
        'info',
        `同步插件就绪（${platform} · ${backendLabel}，自动=${settings.auto !== false}，ready=${ready}）`,
      )
    })()
  },
}

module.exports = plugin
/** 纯函数转发（单测里 `const { fingerprint } = plugin` 那样取；引擎内部直接用 core） */
Object.assign(module.exports, core, {
  createDavClient,
  createFolderBackend,
  createS3Client,
  createS3Storage,
  createGitClient,
  createGitStorage,
  PROVIDERS,
  b64encode,
  b64decode,
  b64encodeBytes,
  b64decodeBytes,
  encodeGitPath,
  parseContents,
})
/** S3 的纯函数（单测里按名取：SigV4 用 AWS 官方向量验证，不是自签自验） */
Object.assign(module.exports, {
  amzDate,
  amzDay,
  canonicalHeaders,
  canonicalQuery,
  encodeRfc3986,
  encodeS3Path,
  hmacSha256,
  parseListObjects,
  sha256Hex,
  signRequest,
  toHex,
})
