// ZeroNote 内核（Rust 侧）
//
// 对应 `docs\内核契约-v0.1.md` §1.1 —— fs 原语。
// 三条硬保证：
//   ① 所有写入原子（临时文件 + rename）
//   ② 只接受「库内相对路径」，拒绝目录穿越
//   ③ 删除进 `.zn/trash/`，不是物理删除
//
// 这里**只实现文件能力**，不认识任何具体功能（标签 / 同步 / AI 都不在这）。

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{Emitter, Manager};

/// 库内私有目录：不进文件树、不进 git
const PRIVATE_DIR: &str = ".zn";

/// 多库容器：库根下放**其它笔记库**的地方（`<库根>/.vaults/<库名>/`）。
/// 用 `.` 开头是有意的 —— `collect()` 会跳过所有 `.` 开头的名字，
/// 于是容器里的库不会串进默认库的文件树，也不需要额外维护黑名单。
const VAULTS_DIR: &str = ".vaults";

/// 遍历时跳过的目录名
const SKIP_DIRS: [&str; 4] = [".zn", ".git", "node_modules", ".obsidian"];

/// 内核只负责**列出来**的只读文档格式（打开交给插件，见 `App.tsx` 的 `core.openDocument`）。
///
/// 2026-10-13 加：此前 `collect()` 硬过滤只收 `.md`/`.markdown`，
/// 于是库里的 PDF / EPUB **在文件树里根本不存在** —— 插件连"能发现它"的机会都没有。
const DOC_EXTS: [&str; 8] = ["pdf", "epub", "mobi", "azw3", "azw", "fb2", "cbz", "txt"];

/// 文件名（大小写不敏感）是否为内核认识的**只读文档**格式。
/// 注意 `.md`/`.markdown` 不在此列 —— 它们是笔记（`is_markdown`），走编辑器。
fn is_readonly_doc(name: &str) -> bool {
  let lower = name.to_lowercase();
  DOC_EXTS.iter().any(|e| lower.ends_with(&format!(".{e}")))
}

/// 文件名（大小写不敏感）是否为**图片附件**（`insert_image` 复制进来的那些）。
///
/// 2026-10-18 rev173.3：图片此前完全不进 `list_notes` ⇒ 文件树里看不到，
/// 用户「附件的入口也没做」。收进树后由前端归到「附件」虚拟分组，点开走图片预览。
fn is_image(name: &str) -> bool {
  name
    .rsplit_once('.')
    .map(|(_, e)| IMAGE_EXTS.iter().any(|x| e.eq_ignore_ascii_case(x)))
    .unwrap_or(false)
}

#[derive(Serialize)]
pub struct NoteMeta {
  /// 库内相对路径，统一用 `/`
  path: String,
  /// **独立笔记 ID**（2026-10-18 rev118）：与路径解耦，改名/移动不变。
  /// 存在 `<库>/.zn/ids.json`（`{ 相对路径: id }`），由内核维护；外部程序移动文件会丢，
  /// 下次 `list_notes` 补一个新的（引用按 ID 找不到时前端回退到按名字匹配）。
  id: String,
  title: String,
  /// 毫秒时间戳
  mtime: u64,
  size: u64,
  frontmatter: serde_json::Value,
  /// `note` = Markdown 笔记（内核可读可写，走编辑器）；
  /// `doc`  = 只读文档（pdf/epub/…，内核只列出来，打开交给插件）。
  /// 前端据此分流，见 `App.tsx` 的 `core.openDocument`。
  kind: String,
}

/// 库内相对路径 → 绝对路径（拒绝绝对路径、`..`、盘符等）
fn resolve(vault: &str, rel: &str) -> Result<PathBuf, String> {
  let rel = rel.trim().replace('\\', "/");
  if rel.is_empty() {
    return Err("路径为空".to_string());
  }
  for c in Path::new(&rel).components() {
    if !matches!(c, Component::Normal(_)) {
      return Err(format!("非法路径（只接受库内相对路径）：{rel}"));
    }
  }
  Ok(Path::new(vault).join(rel))
}

/// 私有目录（`.zn`）的**落点**。
///
/// 默认就是库自己（`<库>/.zn`），与历史行为一致。
/// **特例**：库位于 `<根>/.vaults/<名字>/` 时，私有目录落在**库根**（`<根>/.zn`）——
/// 多库是应用内的概念，插件与 store 应当跨库共用，否则每切一个库插件就"全没了"。
/// 桌面端用户自选的库路径不含 `.vaults`，走默认分支、行为不变。
///
/// ⚠️ **回收站不在此列**：`delete_note` 仍写库内的 `.zn/trash/`。理由有二 ——
/// ① 删的是库内的笔记，回收站跟着库更合理；② `resolve()` 只接受库内相对路径，
/// 库根方向的 `../.zn/...` 会被它直接拒掉，撤销删除会失效。
fn private_root(vault: &str) -> PathBuf {
  let p = Path::new(vault);
  if let Some(parent) = p.parent() {
    if parent.file_name().map(|n| n.to_string_lossy() == VAULTS_DIR).unwrap_or(false) {
      if let Some(root) = parent.parent() {
        return root.to_path_buf();
      }
    }
  }
  p.to_path_buf()
}

/// 极简 frontmatter 解析：只认文件开头 `---` 块里的顶层 `key: value` 标量。
/// v0.2 换成真正的 YAML 解析（本函数不引入额外依赖，够 M1 用）。
fn parse_frontmatter(text: &str) -> serde_json::Value {
  let mut map = serde_json::Map::new();
  let mut lines = text.lines();
  if lines.next().map(|l| l.trim_end()) != Some("---") {
    return serde_json::Value::Object(map);
  }
  for line in lines {
    let t = line.trim_end();
    if t == "---" {
      break;
    }
    if let Some((k, v)) = t.split_once(':') {
      let k = k.trim();
      let v = v.trim().trim_matches('"').trim_matches('\'');
      if !k.is_empty() && !v.is_empty() {
        map.insert(k.to_string(), serde_json::Value::String(v.to_string()));
      }
    }
  }
  serde_json::Value::Object(map)
}

/// **显示名**（侧栏列表 / 搜索命中的标题）—— 三级回退里的前两级：
///   ① frontmatter 的 `title`
///   ② 正文**第一条非空行**（剥掉 `#` / `>` / `-` / `1.` / `[ ]` 这些行首标记）
///   ③ 返回 `None` ⇒ 由调用方回退到**文件名**
///
/// 为什么不再直接用文件名：新建笔记默认叫 `untitled-20261011-222936.md`，
/// 但用户眼里的名字是正文那一行 `# 新笔记` —— 侧栏里列一串 `untitled-<时间戳>` 等于没有名字。
///
/// **有意接受的副作用**：多篇内容相同的笔记会在侧栏显示**同一个名字**（用户 2026-10-12 认可）。
/// 不影响按文件名找：`index-api.ts` 的 `searchable` 会把文件名并进匹配串，两种搜法都能命中。
fn display_title(fm: &serde_json::Value, text: &str) -> Option<String> {
  if let Some(t) = fm.get("title").and_then(|v| v.as_str()) {
    let t = t.trim();
    if !t.is_empty() {
      return Some(clip_chars(t, 80));
    }
  }
  for line in body_after_frontmatter(text).lines() {
    if line.trim().is_empty() {
      continue;
    }
    let t = strip_line_prefix(line);
    if !t.is_empty() {
      return Some(clip_chars(t, 80));
    }
  }
  None
}

/// 跳过文件开头的 frontmatter 块（`---` … `---`），只留正文
fn body_after_frontmatter(text: &str) -> &str {
  if !text.starts_with("---") {
    return text;
  }
  // `---` 是 ASCII ⇒ 3 字节是安全的切点
  match text[3..].find("\n---") {
    Some(i) => &text[3 + i + 4..],
    None => text,
  }
}

/// 剥掉一行的 Markdown 行首标记（标题 / 引用 / 列表 / 待办）
fn strip_line_prefix(line: &str) -> &str {
  let t = line
    .trim()
    .trim_start_matches(|c: char| matches!(c, '#' | '>' | '-' | '*' | '+'))
    .trim_start();
  for p in ["[ ] ", "[x] ", "[X] "] {
    if let Some(rest) = t.strip_prefix(p) {
      return rest.trim();
    }
  }
  // 有序列表 `12. `
  if let Some((head, rest)) = t.split_once(". ") {
    if !head.is_empty() && head.chars().all(|c| c.is_ascii_digit()) {
      return rest.trim();
    }
  }
  t
}

/// 按**字符**截断（按字节切会切碎中文并 panic）
fn clip_chars(s: &str, max: usize) -> String {
  if s.chars().count() <= max {
    return s.to_string();
  }
  s.chars().take(max).collect::<String>() + "…"
}

fn collect(root: &Path, dir: &Path, out: &mut Vec<NoteMeta>) -> Result<(), String> {
  let entries = fs::read_dir(dir).map_err(|e| format!("读取目录失败 {}：{e}", dir.display()))?;
  for entry in entries {
    let entry = entry.map_err(|e| e.to_string())?;
    let name = entry.file_name().to_string_lossy().to_string();
    if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
      continue;
    }
    let path = entry.path();
    let ft = entry.file_type().map_err(|e| e.to_string())?;
    if ft.is_dir() {
      collect(root, &path, out)?;
      continue;
    }
    // 笔记（.md）与**只读文档**（pdf/epub/…）都进文件树；其它一律跳过。
    // 2026-10-18 rev173.3：图片附件也进（kind = image，前端归到「附件」分组）。
    let is_note = is_markdown(&name);
    let is_doc = is_readonly_doc(&name);
    let is_img = is_image(&name);
    if !is_note && !is_doc && !is_img {
      continue;
    }
    let meta = match entry.metadata() {
      Ok(m) => m,
      Err(_) => continue,
    };
    let mtime = meta
      .modified()
      .ok()
      .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
      .map(|d| d.as_millis() as u64)
      .unwrap_or(0);
    let rel = path
      .strip_prefix(root)
      .map_err(|e| e.to_string())?
      .to_string_lossy()
      .replace('\\', "/");
    // 只读文档 / 图片**不读文本、不解析 frontmatter**：二进制读成 String 没有意义
    //（`read_to_string` 会失败），而"三级回退标题"是 Markdown 专属语义。
    // 显示名 = 去掉扩展名的文件名（类型由前端挂的 `.pdf` / `.png` 徽章显示）。
    let (frontmatter, title) = if is_note {
      let text = fs::read_to_string(&path).unwrap_or_default();
      let fm = parse_frontmatter(&text);
      let fallback = name
        .trim_end_matches(".markdown")
        .trim_end_matches(".md")
        .to_string();
      let title = display_title(&fm, &text).unwrap_or(fallback);
      (fm, title)
    } else {
      // 文档显示名 = **去掉扩展名的文件名**（类型由前端挂的 `.pdf` 徽章显示，见 FileTree：
      // 若这里带上扩展名，树里就会出现 `手册.pdf .pdf` 这种重复）。
      let stem = name
        .rsplit_once('.')
        .map(|(a, _)| a.to_string())
        .unwrap_or_else(|| name.clone());
      (serde_json::Value::Null, stem)
    };
    out.push(NoteMeta {
      path: rel,
      // 独立 ID 在 `list_notes` 收集完之后统一填（见那里：缺失的补一个并落盘）
      id: String::new(),
      title,
      mtime,
      size: meta.len(),
      frontmatter,
      kind: if is_note {
        "note"
      } else if is_img {
        // rev173.3：图片附件（文件树里归到「附件」分组，点开是图片预览）
        "image"
      } else {
        "doc"
      }
      .to_string(),
    });
  }
  Ok(())
}

/// 递归收集库内**所有目录**的库内相对路径，跳过 `.` 开头与 `SKIP_DIRS`。
///
/// 为什么需要它：`list_notes` 只上报 `.md` 文件，前端是**从文件路径反推**目录树的
/// ⇒ **空文件夹在文件树里根本不会出现**，"新建文件夹"会像没反应（静默失效）。
/// 文件树要能显示空目录，就必须有这条"目录清单"。
fn collect_dirs(root: &Path, dir: &Path, out: &mut Vec<String>) -> Result<(), String> {
  let entries = fs::read_dir(dir).map_err(|e| format!("读取目录失败 {}：{e}", dir.display()))?;
  for entry in entries {
    let entry = entry.map_err(|e| e.to_string())?;
    let name = entry.file_name().to_string_lossy().to_string();
    if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
      continue;
    }
    let path = entry.path();
    if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
      continue;
    }
    let rel = path
      .strip_prefix(root)
      .map_err(|e| e.to_string())?
      .to_string_lossy()
      .replace('\\', "/");
    out.push(rel);
    collect_dirs(root, &path, out)?;
  }
  Ok(())
}

/// 库内**目录清单**（库内相对路径、`/` 分隔、已排序）—— 空目录也在内。
#[tauri::command]
fn list_dirs(vault: String) -> Result<Vec<String>, String> {
  let root = PathBuf::from(&vault);
  if !root.is_dir() {
    return Err(format!("库目录不存在：{vault}"));
  }
  let mut out = Vec::new();
  collect_dirs(&root, &root, &mut out)?;
  out.sort();
  Ok(out)
}

/// 原子写：同目录临时文件 → sync → rename 覆盖。
///
/// **先写临时文件、再换名**：任何一步失败，原文件都还在。
/// 覆盖已存在目标时 `fs::rename` 在 Windows 上**本来就会替换**（std 对应
/// `MoveFileExW` + `MOVEFILE_REPLACE_EXISTING`，见 `std::fs::rename` 文档）；
/// 只有目标被别的进程占住等情况下 rename 才失败 —— 此时走 `.zn-bak` 三步：
/// 旧文件 → `.zn-bak`，新文件 → 原位，成功后再删 `.zn-bak`。
/// 中途任何一步失败都能把旧文件还原回去，**不会出现"旧内容已删、新内容未就位"的窗口**
/// （P1-3 · 2026-10-18；旧实现的注释「Windows 的 rename 不覆盖已存在文件」是错的）。
fn atomic_write(abs: &Path, content: &str) -> Result<(), String> {
  let dir = abs.parent().ok_or_else(|| "无法确定父目录".to_string())?;
  fs::create_dir_all(dir).map_err(|e| format!("创建目录失败：{e}"))?;
  let tmp = abs.with_extension("zn-tmp");
  {
    let mut f = fs::File::create(&tmp).map_err(|e| format!("创建临时文件失败：{e}"))?;
    f.write_all(content.as_bytes())
      .map_err(|e| format!("写入临时文件失败：{e}"))?;
    f.sync_all().map_err(|e| format!("落盘失败：{e}"))?;
  }
  match fs::rename(&tmp, abs) {
    Ok(()) => Ok(()),
    Err(_) => {
      // 覆盖失败（多为目标被占用）：旧文件先挪到 .bak，新文件上位后再删 .bak
      let bak = abs.with_extension("zn-bak");
      let had_old = fs::rename(abs, &bak).is_ok();
      match fs::rename(&tmp, abs) {
        Ok(()) => {
          if had_old {
            let _ = fs::remove_file(&bak);
          }
          Ok(())
        }
        Err(e) => {
          // 新文件没上位 ⇒ 把旧的还原（还原失败不掩盖真正的错误）
          if had_old {
            let _ = fs::rename(&bak, abs);
          }
          let _ = fs::remove_file(&tmp);
          Err(format!("替换原文件失败：{e}"))
        }
      }
    }
  }
}

/* ───────────── 独立笔记 ID（2026-10-18 rev118） ───────────── */

/// ID 表：`<库>/.zn/ids.json`，`{ 库内相对路径: id }`。
///
/// 放 `.zn` 而不是写进正文 frontmatter —— **不动用户的 md 内容**是硬约束。
/// 代价：外部程序移动文件后键会失效，下次 `list_notes` 补一个新 ID（渲染层仍能按名字找到）。
fn ids_file(root: &Path) -> PathBuf {
  root.join(PRIVATE_DIR).join("ids.json")
}

fn load_ids(root: &Path) -> BTreeMap<String, String> {
  match fs::read_to_string(ids_file(root)) {
    Ok(t) => serde_json::from_str(&t).unwrap_or_default(),
    Err(_) => BTreeMap::new(),
  }
}

fn save_ids(root: &Path, ids: &BTreeMap<String, String>) -> Result<(), String> {
  let json = serde_json::to_string_pretty(ids).map_err(|e| format!("序列化 ID 表失败：{e}"))?;
  atomic_write(&ids_file(root), &json)
}

/// 生成 ID：毫秒 + 纳秒低位 + 进程号混在一起（不引 uuid 依赖）；碰撞概率可忽略。
fn new_note_id() -> String {
  let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
  let mix = (d.subsec_nanos() as u64) ^ ((std::process::id() as u64) << 20) ^ (d.as_millis() as u64);
  format!("n{mix:012x}")
}

/// 文件名 stem（去掉 `.md` / `.markdown`）
fn stem_of(rel: &str) -> String {
  let name = rel.rsplit('/').next().unwrap_or(rel);
  name.trim_end_matches(".markdown")
    .trim_end_matches(".md")
    .to_string()
}

/// `rename` 之后重写全库引用：`[[旧名]]` / `[[旧名|显示]]` / `[[旧标题]]` / `](旧路径)`。
///
/// 返回改动的文件数；跳过 `.zn` 等私有目录、`.md` 之外的文件、以及 >4MB 的文件。
/// 只做**字面文本替换**（正则替换会误伤代码块/链接里的同名字符串是更糟的取舍）。
fn rewrite_links(
  root: &Path,
  old_rel: &str,
  new_rel: &str,
  old_title: Option<&str>,
) -> Result<usize, String> {
  let old_stem = stem_of(old_rel);
  let new_stem = stem_of(new_rel);
  let mut changed = 0usize;
  let mut stack = vec![root.to_path_buf()];
  while let Some(dir) = stack.pop() {
    let entries = match fs::read_dir(&dir) {
      Ok(e) => e,
      Err(_) => continue,
    };
    for entry in entries {
      let Ok(entry) = entry else { continue };
      let name = entry.file_name().to_string_lossy().to_string();
      if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
        continue;
      }
      let path = entry.path();
      let Ok(ft) = entry.file_type() else { continue };
      if ft.is_dir() {
        stack.push(path);
        continue;
      }
      if !is_markdown(&name) {
        continue;
      }
      let rel = path
        .strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
      if rel == new_rel {
        continue; // 被改名的那篇本身
      }
      let too_big = entry
        .metadata()
        .map(|m| m.len() > 4 * 1024 * 1024)
        .unwrap_or(true);
      if too_big {
        continue;
      }
      let Ok(text) = fs::read_to_string(&path) else {
        continue;
      };
      let mut next = text.clone();
      if !old_stem.is_empty() && old_stem != new_stem {
        next = next.replace(&format!("[[{old_stem}]]"), &format!("[[{new_stem}]]"));
        next = next.replace(&format!("[[{old_stem}|"), &format!("[[{new_stem}|"));
      }
      if let Some(t) = old_title {
        if !t.is_empty() && t != old_stem && t != new_stem {
          next = next.replace(&format!("[[{t}]]"), &format!("[[{new_stem}]]"));
          next = next.replace(&format!("[[{t}|"), &format!("[[{new_stem}|"));
        }
      }
      if old_rel != new_rel {
        next = next.replace(&format!("]({old_rel})"), &format!("]({new_rel})"));
      }
      if next != text {
        atomic_write(&path, &next)?;
        changed += 1;
      }
    }
  }
  Ok(changed)
}

/* ───────────── 命令 ───────────── */

#[tauri::command]
fn list_notes(vault: String, dir: Option<String>) -> Result<Vec<NoteMeta>, String> {
  let root = PathBuf::from(&vault);
  if !root.is_dir() {
    return Err(format!("库目录不存在：{vault}"));
  }
  let start = match dir {
    Some(d) if !d.trim().is_empty() => resolve(&vault, &d)?,
    _ => root.clone(),
  };
  let mut out = Vec::new();
  collect(&root, &start, &mut out)?;
  out.sort_by(|a, b| a.path.cmp(&b.path));
  // 独立 ID（rev118）：缺失的补一个；整张表**只写了有新项时**才落盘。
  let mut ids = load_ids(&root);
  let mut dirty = false;
  for m in out.iter_mut() {
    match ids.get(&m.path) {
      Some(id) => m.id = id.clone(),
      None => {
        let id = new_note_id();
        ids.insert(m.path.clone(), id.clone());
        m.id = id;
        dirty = true;
      }
    }
  }
  if dirty {
    if let Err(e) = save_ids(&root, &ids) {
      log::warn!("保存 ID 表失败：{e}");
    }
  }
  Ok(out)
}

#[tauri::command]
fn read_note(vault: String, path: String) -> Result<String, String> {
  let abs = resolve(&vault, &path)?;
  fs::read_to_string(&abs).map_err(|e| format!("读取 {path} 失败：{e}"))
}

#[tauri::command]
fn write_note(vault: String, path: String, content: String) -> Result<(), String> {
  let abs = resolve(&vault, &path)?;
  atomic_write(&abs, &content)
}

#[tauri::command]
fn create_note(vault: String, path: String, content: String) -> Result<(), String> {
  let abs = resolve(&vault, &path)?;
  if abs.exists() {
    return Err(format!("文件已存在，不覆盖：{path}"));
  }
  atomic_write(&abs, &content)
}

#[tauri::command]
fn rename_note(vault: String, from: String, to: String) -> Result<(), String> {
  let from_norm = from.trim().replace('\\', "/");
  let to_norm = to.trim().replace('\\', "/");
  let src = resolve(&vault, &from_norm)?;
  let dst = resolve(&vault, &to_norm)?;
  if dst.exists() {
    return Err(format!("目标已存在，不覆盖：{to_norm}"));
  }
  if let Some(dir) = dst.parent() {
    fs::create_dir_all(dir).map_err(|e| format!("创建目录失败：{e}"))?;
  }
  // 旧标题：`[[标题]]` 形式的引用也要跟着改（rename 之前读）
  let old_title = fs::read_to_string(&src).ok().map(|t| {
    let fm = parse_frontmatter(&t);
    display_title(&fm, &t).unwrap_or_default()
  });
  fs::rename(&src, &dst).map_err(|e| format!("重命名失败：{e}"))?;
  // ① ID 跟着文件走（rev118）
  let root = PathBuf::from(&vault);
  let mut ids = load_ids(&root);
  if let Some(id) = ids.remove(&from_norm) {
    ids.insert(to_norm.clone(), id);
    if let Err(e) = save_ids(&root, &ids) {
      log::warn!("迁移 ID 表失败：{e}");
    }
  }
  // ② 全库引用重写（失败不回滚改名，只留日志 —— 笔记本身已经安全落位）
  match rewrite_links(&root, &from_norm, &to_norm, old_title.as_deref()) {
    Ok(0) => {}
    Ok(n) => log::info!("rename: 重写了 {n} 篇笔记里的引用"),
    Err(e) => log::warn!("rename: 引用重写失败（文件已改名）：{e}"),
  }
  Ok(())
}

/// 把 `src` 目录的内容**逐项**搬到 `dst`（`dst` 不存在则创建）。
///
/// 为什么需要它（2026-10-17 实测）：Windows 上 `fs::rename` 把**非空目录**移进另一个
/// **已存在的目录**里会返回 `ACCESS_DENIED`（os error 5）。同一个目录用 `pwsh` 的
/// `MoveFileExW` 能移、本进程 `fs::rename` 不能；而**空目录**和**文件**都正常 ——
/// 所以「删文件夹」只能对空文件夹生效，装了内容的文件夹永远删不掉。
///
/// 逐项搬运把操作降级成两条**已验证可用**的原语：文件 `fs::rename` + 目录 `create_dir_all`。
/// 中途失败**不丢数据**：已搬的部分留在 `dst`（回收站里），源里剩下的原样不动 ——
/// 调用方会把错误报给用户，用户可以在回收站里看到已搬走的那部分。
fn move_tree(src: &Path, dst: &Path) -> Result<(), String> {
  fs::create_dir_all(dst).map_err(|e| format!("创建回收站子目录失败 {}：{e}", dst.display()))?;
  let entries = fs::read_dir(src).map_err(|e| format!("读取目录失败 {}：{e}", src.display()))?;
  let mut failure: Option<String> = None;
  for entry in entries {
    let entry = match entry {
      Ok(e) => e,
      Err(e) => {
        failure = Some(e.to_string());
        break;
      }
    };
    let child_src = entry.path();
    let child_dst = dst.join(entry.file_name());
    let moved = if child_src.is_dir() {
      move_tree(&child_src, &child_dst)
    } else {
      fs::rename(&child_src, &child_dst)
        .map_err(|e| format!("移入回收站失败（{}）：{e}", child_src.display()))
    };
    if let Err(e) = moved {
      failure = Some(e);
      break;
    }
  }
  match failure {
    Some(e) => Err(e),
    None => Ok(()),
  }
}

/// 删除 = 移入 `.zn/trash/<时间戳>/<原相对路径>`（可恢复）。
/// 返回回收站里的**库内相对路径**，供调用方做「撤销」（把它 rename 回原位）。
///
/// 为什么按**原相对路径**存，而不是只存文件名：只存名字的话，恢复时只知道
/// "它叫什么"、不知道"它原来在哪" ⇒ `a/b/笔记.md` 只能恢复成库根的 `笔记.md`。
/// 按原路径存，`restore_trash` 才能把它放回**原处**。
/// 旧格式（扁平的 `<时间戳>--<名>`）**仍可列出与恢复**，只是落点只能是库根。
#[tauri::command]
fn delete_note(vault: String, path: String) -> Result<String, String> {
  let abs = resolve(&vault, &path)?;
  if !abs.exists() {
    return Err(format!("要删除的东西不存在：{path}"));
  }
  let trash = Path::new(&vault).join(PRIVATE_DIR).join("trash");
  let stamp = std::time::SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_millis())
    .unwrap_or(0)
    .to_string();
  let name = abs
    .file_name()
    .map(|s| s.to_string_lossy().to_string())
    .unwrap_or_else(|| "note.md".to_string());
  let dest_dir = trash.join(&stamp);
  fs::create_dir_all(&dest_dir).map_err(|e| format!("创建回收站失败：{e}"))?;
  // 原相对路径**单独记一份**，内容是**一层** `<stamp>/<文件名>`：
  // 若按原路径 mirrored 成多层，`read_dir` 的"第一个条目"就不再等于原路径了（踩过）。
  fs::write(dest_dir.join(ORIGIN_FILE), &path)
    .map_err(|e| format!("写入回收站元信息失败：{e}"))?;
  let dest = dest_dir.join(&name);
  // 文件 / 空目录：一次 rename 就够（Windows 上这两条一直可用）。
  // 非空目录：fast path 失败后**降级逐项搬运** —— 见 `move_tree` 的说明。
  if abs.is_dir() {
    if fs::rename(&abs, &dest).is_err() {
      move_tree(&abs, &dest)?;
      // 源里此时只剩空目录树；逐项删掉（空目录删除已验证可用）
      fs::remove_dir_all(&abs).map_err(|e| format!("移入回收站后清理原目录失败：{e}"))?;
    }
  } else {
    fs::rename(&abs, &dest).map_err(|e| format!("移入回收站失败：{e}"))?;
  }
  Ok(format!("{PRIVATE_DIR}/trash/{stamp}/{name}"))
}

/// 回收站条目（给 UI 列表用）
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
  /// 稳定标识：新格式 = 时间戳目录名；旧格式 = `<时间戳>--<名>` 整个文件名
  id: String,
  /// 展示名（新格式 = 原路径最后一段；旧格式 = `--` 之后那段）
  name: String,
  /// 原库内相对路径。**旧格式没这个信息** ⇒ `None`（恢复只能落库根）
  original_path: Option<String>,
  /// 删除时间（毫秒时间戳，取自 id 前段）
  deleted_at: u64,
  is_dir: bool,
  /// 字节数（目录递归求和，仅供列表显示）
  size: u64,
}

/// 回收站条目里记录**原相对路径**的元文件名（`.` 开头 ⇒ 与内容天然区分开）
const ORIGIN_FILE: &str = ".origin";

/// 读回某个回收站条目记下的原相对路径
fn trash_origin(stamp_dir: &Path) -> Option<String> {
  let s = fs::read_to_string(stamp_dir.join(ORIGIN_FILE)).ok()?;
  let t = s.trim().to_string();
  if t.is_empty() { None } else { Some(t) }
}

/// 回收站条目里**真正的内容**（跳过 `.origin` 这类点开头的元文件）
fn trash_payload(stamp_dir: &Path) -> Option<PathBuf> {
  fs::read_dir(stamp_dir)
    .ok()?
    .flatten()
    .map(|e| e.path())
    .find(|p| {
      p.file_name()
        .map(|n| !n.to_string_lossy().starts_with('.'))
        .unwrap_or(false)
    })
}

/// 递归求一个路径的字节数（目录把子树加起来）
fn path_size(p: &Path) -> u64 {
  let Ok(meta) = fs::symlink_metadata(p) else {
    return 0;
  };
  if meta.is_file() {
    return meta.len();
  }
  let mut total = 0;
  if let Ok(entries) = fs::read_dir(p) {
    for e in entries.flatten() {
      total += path_size(&e.path());
    }
  }
  total
}

/// 回收站列表（**新旧两种格式都认**），最近的排最前。
#[tauri::command]
fn list_trash(vault: String) -> Result<Vec<TrashEntry>, String> {
  let trash = Path::new(&vault).join(PRIVATE_DIR).join("trash");
  if !trash.is_dir() {
    return Ok(Vec::new());
  }
  let mut out = Vec::new();
  let entries = fs::read_dir(&trash).map_err(|e| format!("读取回收站失败：{e}"))?;
  for entry in entries.flatten() {
    let id = entry.file_name().to_string_lossy().to_string();
    let path = entry.path();
    let legacy = id.split_once("--").map(|(a, b)| (a.to_string(), b.to_string()));
    let (stamp, legacy_name) = match &legacy {
      Some((a, b)) => (a.clone(), Some(b.clone())),
      None => (id.clone(), None),
    };
    let deleted_at: u64 = stamp.parse().unwrap_or(0);
    // 新格式：`trash/<stamp>/` = `.origin`（原路径）＋ **一层**内容
    let (name, original_path, content) = if legacy_name.is_none() && path.is_dir() {
      let origin = trash_origin(&path);
      match trash_payload(&path) {
        Some(payload) => {
          let name = payload
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
          (name, origin, payload)
        }
        None => {
          // 只剩 `.origin` 的空壳（撤销删除之后留下的）⇒ 顺手清掉，回收站不留垃圾
          if origin.is_some() {
            let _ = fs::remove_dir_all(&path);
          }
          continue;
        }
      }
    } else if let Some(n) = legacy_name {
      (n, None, path.clone())
    } else {
      (id.clone(), None, path.clone())
    };
    out.push(TrashEntry {
      id,
      name,
      original_path,
      deleted_at,
      is_dir: content.is_dir(),
      size: path_size(&content),
    });
  }
  out.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
  Ok(out)
}

/// 从回收站恢复一项，返回恢复到的库内相对路径。
/// · 新格式 ⇒ 放回**原路径**（父目录自动补上）；原位置已有东西 ⇒ 拒绝，不覆盖
/// · 旧格式 ⇒ 只能放回**库根**（原路径没记下来）
#[tauri::command]
fn restore_trash(vault: String, id: String) -> Result<String, String> {
  if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
    return Err(format!("非法的回收站条目 id：{id}"));
  }
  let src = Path::new(&vault).join(PRIVATE_DIR).join("trash").join(&id);
  if !src.exists() {
    return Err(format!("回收站里没有这一项：{id}"));
  }
  let root = PathBuf::from(&vault);
  let Some((_, name)) = id.split_once("--") else {
    // 新格式：`.origin` 记着原路径，内容是**一层**
    let rel = trash_origin(&src).ok_or_else(|| format!("回收站条目缺少原路径记录：{id}"))?;
    let payload = trash_payload(&src).ok_or_else(|| format!("回收站条目是空的：{id}"))?;
    let dst = root.join(&rel);
    if dst.exists() {
      return Err(format!("原位置已有同名项，先处理它再恢复：{rel}"));
    }
    if let Some(parent) = dst.parent() {
      fs::create_dir_all(parent).map_err(|e| format!("恢复失败（建父目录）：{e}"))?;
    }
    // 与 `delete_note` 同一个 Windows 坑（见 `move_tree`）：非空目录的 rename 可能
    // ACCESS_DENIED —— 回收站里存的正是**整棵目录树**，所以恢复同样要能降级逐项搬回。
    if payload.is_dir() {
      if fs::rename(&payload, &dst).is_err() {
        move_tree(&payload, &dst)?;
        fs::remove_dir_all(&payload).map_err(|e| format!("恢复后清理回收站失败：{e}"))?;
      }
    } else {
      fs::rename(&payload, &dst).map_err(|e| format!("恢复失败（{rel}）：{e}"))?;
    }
    // 整个 stamp 目录（含 `.origin`）一起清掉，回收站里不留碎片
    let _ = fs::remove_dir_all(&src);
    return Ok(rel);
  };
  // 旧格式：id 本身就带着原名，只能回库根
  let dst = root.join(name);
  if dst.exists() {
    return Err(format!("库里已有同名项，先改名再恢复：{name}"));
  }
  fs::rename(&src, &dst).map_err(|e| format!("恢复失败（{name}）：{e}"))?;
  Ok(name.to_string())
}

/// 从回收站**真删除**一项 —— 不可撤销（UI 必须二次确认）
#[tauri::command]
fn purge_trash(vault: String, id: String) -> Result<(), String> {
  if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
    return Err(format!("非法的回收站条目 id：{id}"));
  }
  let target = Path::new(&vault).join(PRIVATE_DIR).join("trash").join(&id);
  if !target.exists() {
    return Err(format!("回收站里没有这一项：{id}"));
  }
  if target.is_dir() {
    fs::remove_dir_all(&target).map_err(|e| format!("删除失败：{e}"))
  } else {
    fs::remove_file(&target).map_err(|e| format!("删除失败：{e}"))
  }
}

/// 清空回收站，返回清掉的条目数（不动 `.zn/trash` 目录本身）
#[tauri::command]
fn empty_trash(vault: String) -> Result<u64, String> {
  let trash = Path::new(&vault).join(PRIVATE_DIR).join("trash");
  if !trash.is_dir() {
    return Ok(0);
  }
  let mut n = 0u64;
  for entry in fs::read_dir(&trash)
    .map_err(|e| format!("读取回收站失败：{e}"))?
    .flatten()
  {
    let p = entry.path();
    let done = if p.is_dir() {
      fs::remove_dir_all(&p)
    } else {
      fs::remove_file(&p)
    };
    if done.is_ok() {
      n += 1;
    }
  }
  Ok(n)
}

#[tauri::command]
fn note_exists(vault: String, path: String) -> Result<bool, String> {
  Ok(resolve(&vault, &path)?.exists())
}

/// 新建目录（多级父目录一起建）—— `notes/2026/10` 这种一次到位。
/// 目录已存在不算错（幂等），但**同名的文件**要拒绝。
#[tauri::command]
fn create_dir(vault: String, path: String) -> Result<(), String> {
  let abs = resolve(&vault, &path)?;
  if abs.exists() && !abs.is_dir() {
    return Err(format!("同名文件已存在：{path}"));
  }
  fs::create_dir_all(&abs).map_err(|e| format!("创建目录失败（{path}）：{e}"))
}

/// 移动 / 重命名 **文件或整个目录树**。
///
/// 与 `rename_note` 的分工：那个只搬文件、且语义是"改个名"；这个是**文件夹管理的核心操作**，
/// 所以要能搬目录。规则：
///  · 目标是**已存在的目录** ⇒ 视为"移入该目录"（与 `mv` 一致，插件写起来最省心）
///  · 其他情况 ⇒ 直接当新路径；已存在则拒绝（不静默覆盖）
///  · **禁止把目录移进自己的子孙** —— 那会造出无限递归，而 `fs::rename` 在那种输入下
///    各平台行为不一致（有的报 EINVAL，有的真移进自己里面）
#[tauri::command]
fn move_entry(vault: String, from: String, to: String) -> Result<(), String> {
  let src = resolve(&vault, &from)?;
  if !src.exists() {
    return Err(format!("源不存在：{from}"));
  }
  let mut dst = resolve(&vault, &to)?;
  if src == dst {
    return Err("源与目标相同".to_string());
  }
  if dst.is_dir() {
    let name = src
      .file_name()
      .ok_or_else(|| format!("无法取得名称：{from}"))?;
    dst = dst.join(name);
  }
  if dst.exists() {
    return Err(format!("目标已存在，不覆盖：{to}"));
  }
  if src.is_dir() && dst.starts_with(&src) {
    return Err("不能把目录移到它自己的子目录里".to_string());
  }
  if let Some(parent) = dst.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("创建目标目录失败：{e}"))?;
  }
  // 非空目录的 rename 在 Windows 上可能 ACCESS_DENIED（见 `move_tree` 的说明）——
  // 与 `delete_note` 同一套降级：逐项搬过去，再把源空壳删掉。
  if src.is_dir() {
    if fs::rename(&src, &dst).is_err() {
      move_tree(&src, &dst)?;
      fs::remove_dir_all(&src).map_err(|e| format!("移动后清理原目录失败：{e}"))?;
      return Ok(());
    }
    return Ok(());
  }
  fs::rename(&src, &dst).map_err(|e| format!("移动失败（{from} → {to}）：{e}"))
}

/// 递归复制（文件 → 单文件；目录 → 建目录后逐项递归）。
/// **跳过 `.` 开头与 `SKIP_DIRS`** —— `.zn` 是库的私有目录（插件、回收站），
/// 复制它等于把私货散出去。
fn copy_path(src: &Path, dst: &Path) -> Result<(), String> {
  if src.is_dir() {
    fs::create_dir_all(dst).map_err(|e| format!("创建目录失败 {}：{e}", dst.display()))?;
    let entries = fs::read_dir(src).map_err(|e| format!("读取目录失败 {}：{e}", src.display()))?;
    for entry in entries {
      let entry = entry.map_err(|e| e.to_string())?;
      let name = entry.file_name().to_string_lossy().to_string();
      if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
        continue;
      }
      copy_path(&entry.path(), &dst.join(&name))?;
    }
    Ok(())
  } else {
    fs::copy(src, dst)
      .map(|_| ())
      .map_err(|e| format!("复制文件失败（{}）：{e}", src.display()))
  }
}

/// 复制文件 / **整个目录树**。语义与 `move_entry` 对齐，方便前端一套逻辑写两种粘贴：
///  · `to` 是**已存在的目录** ⇒ 复制进该目录（用原名）
///  · 其他情况 ⇒ 当新路径；已存在则拒绝（不静默覆盖）
///  · **禁止把目录复制进自己的子孙** —— 那会边复制边读取，越滚越大
#[tauri::command]
fn copy_entry(vault: String, from: String, to: String) -> Result<(), String> {
  let src = resolve(&vault, &from)?;
  if !src.exists() {
    return Err(format!("源不存在：{from}"));
  }
  let mut dst = resolve(&vault, &to)?;
  if src == dst {
    return Err("源与目标相同".to_string());
  }
  if dst.is_dir() {
    let name = src
      .file_name()
      .ok_or_else(|| format!("无法取得名称：{from}"))?;
    dst = dst.join(name);
  }
  if dst.exists() {
    return Err(format!("目标已存在，不覆盖：{to}"));
  }
  if src.is_dir() && dst.starts_with(&src) {
    return Err("不能把目录复制到它自己的子目录里".to_string());
  }
  if let Some(parent) = dst.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("创建目标目录失败：{e}"))?;
  }
  copy_path(&src, &dst)
}

/// 「插入图片」接受的扩展名（小写；与前端 `src/lib/insert-image.ts` 的 IMAGE_EXTS 同一份）。
const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"];

/// 不允许复制进库的扩展名（可执行 / 脚本）—— 附件区不该有能直接双击运行的东西。
const BLOCKED_EXTS: &[&str] = &[
  "exe", "dll", "bat", "cmd", "com", "scr", "msi", "ps1", "vbs", "js", "jar", "apk",
];

/// 把**库外**的图片复制进笔记所在目录，返回库内相对路径（如 `sub/image-x.png`）。
///
/// 为什么不用 `copy_entry`：它只接受库内相对路径，搬不进外面的文件；
/// `write_absolute_b64` 又要求前端先把整个文件读成 base64（大图很慢）。
/// 这里一步到位 —— 源可以是桌面文件路径，也可以是 Android `content://` 经
/// `read_content_uri` 复制出的缓存路径（副本保留原始文件名，扩展名不丢）。
///
/// 命名：`<stem>.<ext>`，重名依次 `<stem>-1.<ext>`、`<stem>-2.<ext>`……**不覆盖**任何已有文件。
/// `stem` 由前端生成（`image-20261018-203055`），这里再过一遍白名单：
/// 只留 ASCII 字母数字与 `-`，限 64 字符，防止它变成路径或超长名。
#[tauri::command]
fn import_attachment(
  vault: String,
  note_path: String,
  src: String,
  stem: String,
) -> Result<String, String> {
  let note_abs = resolve(&vault, &note_path)?;
  let dir = note_abs
    .parent()
    .ok_or_else(|| "笔记路径无效（没有所在目录）".to_string())?;
  let src_path = PathBuf::from(&src);
  if !src_path.is_file() {
    return Err(format!("找不到图片：{src}"));
  }
  let ext = src_path
    .extension()
    .and_then(|e| e.to_str())
    .map(|e| e.to_ascii_lowercase())
    .unwrap_or_default();
  // rev173.3：图片之外也允许任意**普通文件**（「插入附件」用）；
  // 只挡可执行 / 脚本 —— 附件目录里出现能双击运行的东西只可能是误操作。
  if ext.is_empty() {
    return Err(format!("文件没有扩展名，无法判断类型：{src}"));
  }
  if BLOCKED_EXTS.contains(&ext.as_str()) {
    return Err(format!("不允许插入可执行 / 脚本文件（.{ext}）：{src}"));
  }
  // stem 白名单：保留 Unicode 字母数字（中文文件名要能留住）、`-`、`_`；空格转 `-`。
  // 路径分隔符与其它符号一律丢掉 —— 不能让 stem 变成路径。
  let clean: String = stem
    .chars()
    .map(|c| if c == ' ' { '-' } else { c })
    .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
    .take(64)
    .collect();
  let base = if clean.is_empty() {
    "file".to_string()
  } else {
    clean
  };
  // 库内相对目录（`note_path` 已由 resolve 保证只含 Normal 组件，不会带 `..`）
  let note_rel = note_path.trim().replace('\\', "/");
  let dir_rel = note_rel.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
  for n in 0..1000u32 {
    let name = if n == 0 {
      format!("{base}.{ext}")
    } else {
      format!("{base}-{n}.{ext}")
    };
    let dst = dir.join(&name);
    if dst.exists() {
      continue;
    }
    fs::copy(&src_path, &dst).map_err(|e| format!("复制图片失败：{e}"))?;
    return Ok(if dir_rel.is_empty() {
      name
    } else {
      format!("{dir_rel}/{name}")
    });
  }
  Err("同名文件过多，放弃".to_string())
}

/// 校验「导出落盘」的目标路径，并给出**能看懂**的错误。
///
/// ⚠️ **Android 平台差异（真机实测）**：Android 的「另存为」走 SAF，`save()` 返回的是
/// `content://…` **内容 URI**，不是文件路径 —— `std::fs` 处理不了它。
/// 不特判的话用户只会看到"必须是绝对路径"这种误导信息，而真实原因是平台机制不同。
/// （桌面端返回的是真实路径，所以这条通道在桌面上是可用的。）
fn export_target(path: &str) -> Result<PathBuf, String> {
  if path.starts_with("content://") {
    return Err(
      "Android 的「另存为」返回的是 SAF 内容 URI（content://…），当前实现只支持真实文件路径。\
       这个平台差异记在契约 §2.4 的 host.saveFile 说明里；Android 上请改为写进库内再分享。"
        .to_string(),
    );
  }
  let p = PathBuf::from(path);
  if !p.is_absolute() {
    return Err(format!("导出路径必须是绝对路径：{path}"));
  }
  Ok(p)
}

/// 把内容写到**库外的绝对路径**（导出落盘用）。
///
/// 这是**故意的提权入口**：库内写入一律走 `resolve` 白名单，而"导出"天生要写到用户
/// 随手选的位置（桌面、U 盘…），没法预先圈定范围。为把它关到尽量小：
///  · 只接受**绝对路径**（`export_target` 里校验，并特判 Android 的 SAF URI）；
///  · 不建父目录（目标目录必须已存在，写错地方就报错而不是悄悄造出一串目录）；
///  · 覆盖与否交给系统"另存为"对话框，它自己会问用户。
#[tauri::command]
fn write_absolute(path: String, content: String) -> Result<(), String> {
  let p = export_target(&path)?;
  fs::write(&p, content).map_err(|e| format!("写入失败（{path}）：{e}"))
}

/// 极简 base64 解码（标准字母表，跳过空白与 `=`）。
///
/// 为什么不引 `base64` crate：整个项目只有"导出二进制"这一条路用它，
/// 为一次调用加一个依赖不划算（内核能薄就薄）。算法本身很短，且这里对
/// 非法字符会直接报错，不会静默产出错误数据。
fn b64_decode(s: &str) -> Result<Vec<u8>, String> {
  const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let mut rev = [255u8; 256];
  for (i, &c) in TABLE.iter().enumerate() {
    rev[c as usize] = i as u8;
  }
  let mut out = Vec::with_capacity(s.len() / 4 * 3);
  let mut acc: u32 = 0;
  let mut bits: u32 = 0;
  for &c in s.as_bytes() {
    if c == b'=' || c.is_ascii_whitespace() {
      continue;
    }
    let v = rev[c as usize];
    if v == 255 {
      return Err(format!("非法的 base64 字符：{}", c as char));
    }
    acc = (acc << 6) | v as u32;
    bits += 6;
    if bits >= 8 {
      bits -= 8;
      out.push((acc >> bits) as u8);
    }
  }
  Ok(out)
}

/// 把**二进制**内容写到库外绝对路径（导出图片 / zip 用）。
///
/// 走 base64 而不是 `Vec<u8>` 参数：Tauri 会把 `Vec<u8>` 序列化成 JSON **数字数组**，
/// 一个 1 MB 的 zip 就变成上百万元素，序列化开销与消息体积都离谱；base64 只大 33%。
#[tauri::command]
fn write_absolute_b64(path: String, base64: String) -> Result<(), String> {
  let p = export_target(&path)?;
  let bytes = b64_decode(&base64)?;
  fs::write(&p, bytes).map_err(|e| format!("写入失败（{path}）：{e}"))
}

/// 库目录是否**仍然存在**（只读，什么都不建）。
///
/// 用途：侧栏「切换笔记库」里的**过期记录**清理 —— 库被删掉 / 换了盘之后，
/// 那条记录会一直留在最近列表里，点它只会得到 `list_notes` 的「库目录不存在」，
/// 而列表里**没有任何能清掉它的入口**。前端拿这个命令先探测一遍。
///
/// 与 `ensure_vault` 的分工要看清楚：那个会**创建**目录，所以探测**绝不能**改调它 ——
/// 否则"库没了"会被静默变成"库还在，只是空的"。
#[tauri::command]
fn vault_exists(vault: String) -> bool {
  Path::new(&vault).is_dir()
}

/// 确保库目录（含私有目录）存在。
/// Android 首次启动时应用私有目录里还没有 `vault`，不建的话 `list_notes` 会直接报「库目录不存在」。
#[tauri::command]
fn ensure_vault(vault: String) -> Result<(), String> {
  fs::create_dir_all(Path::new(&vault)).map_err(|e| format!("创建库目录失败：{e}"))?;
  // 私有目录建在 private_root 上：多库共用库根的 `.zn`，
  // 所以新建的库目录里**不该**再冒出一个空的 `.zn`（否则插件会在两个地方各看一套）。
  let private = private_root(&vault).join(PRIVATE_DIR);
  fs::create_dir_all(&private).map_err(|e| format!("创建私有目录失败：{e}"))?;
  Ok(())
}

/// 列出库根下「其它笔记库」的名字（即 `<库根>/.vaults/` 的子目录，已排序）。
///
/// 为什么需要它：移动端**没有目录选择器**（Tauri 在 Android 上直接返回
/// `FolderPickerNotImplemented`），所以多库改为应用内管理 ——
/// 默认库 = 库根本身，其它库住在 `.vaults/<名字>/`。
/// 容器还不存在时返回空表（不是错误 —— 只是还没建过第二个库）。
#[tauri::command]
fn list_vaults(root: String) -> Result<Vec<String>, String> {
  let dir = Path::new(&root).join(VAULTS_DIR);
  if !dir.is_dir() {
    return Ok(Vec::new());
  }
  let mut names = Vec::new();
  for entry in fs::read_dir(&dir).map_err(|e| format!("读取库容器失败：{e}"))? {
    let entry = entry.map_err(|e| e.to_string())?;
    // `path().is_dir()`（**跟随链接**）而不是 `file_type().is_dir()`：
    // 用户可能把库目录做成 junction / 符号链接，而 `file_type()` 对链接返回 symlink 类型、
    // `is_dir()` 是 false ⇒ 库会被整个漏掉。（`collect()` 递归扫描那里**故意不跟随**，防链接成环。）
    if entry.path().is_dir() {
      let name = entry.file_name().to_string_lossy().to_string();
      // 与 collect() 同一套规矩：`.` 开头的跳过，别把私有目录当成库列出来
      if !name.starts_with('.') {
        names.push(name);
      }
    }
  }
  names.sort();
  Ok(names)
}

/* ───────────── 插件相关命令（M2）───────────── */
//
// 插件住在 `<私有根>/.zn/plugins/<pluginId>/`：manifest.json + 入口脚本 + store.json。
// 私有根见 `private_root()` —— 默认就是库自己；库在 `.vaults/` 里时是**库根**（跨库共用）。
// 与 fs 原语一样：只接受安全相对路径，写入原子。

/// 插件 id 白名单（只允许字母数字与 `-` `_` `.`）—— 越不出 `.zn/plugins/`。
fn valid_plugin_id(plugin_id: &str) -> bool {
  !plugin_id.is_empty()
    && plugin_id
      .chars()
      .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn plugin_dir(vault: &str, plugin_id: &str) -> Result<PathBuf, String> {
  if !valid_plugin_id(plugin_id) {
    return Err(format!("非法插件 id（只允许字母数字与 - _ .）：{plugin_id}"));
  }
  Ok(private_root(vault).join(PRIVATE_DIR).join("plugins").join(plugin_id))
}

fn plugin_file(vault: &str, plugin_id: &str, rel: &str) -> Result<PathBuf, String> {
  let dir = plugin_dir(vault, plugin_id)?;
  let rel = rel.trim().replace('\\', "/");
  if rel.is_empty() {
    return Err("插件内路径为空".to_string());
  }
  for c in Path::new(&rel).components() {
    if !matches!(c, Component::Normal(_)) {
      return Err(format!("非法插件内路径：{rel}"));
    }
  }
  Ok(dir.join(rel))
}

#[tauri::command]
fn list_plugins(vault: String) -> Result<Vec<String>, String> {
  let dir = private_root(&vault).join(PRIVATE_DIR).join("plugins");
  if !dir.is_dir() {
    return Ok(Vec::new());
  }
  let mut out = Vec::new();
  for entry in fs::read_dir(&dir).map_err(|e| format!("读取插件目录失败：{e}"))? {
    let entry = entry.map_err(|e| e.to_string())?;
    // 跟随链接：插件目录常被做成 junction 指向源码目录（开发时改完即生效，不必反复拷），
    // 而 `file_type()` 对 junction 返回 symlink、`is_dir()` 是 false ⇒ 插件会被整个漏掉。
    // 这一层不递归，所以跟随链接没有成环风险。
    if entry.path().is_dir() {
      out.push(entry.file_name().to_string_lossy().to_string());
    }
  }
  out.sort();
  Ok(out)
}

/// 把一个插件目录**整目录**从一处复制到另一处（rev173.6 清理迁移用：库内 → 全局根）。
///
/// 为什么要它：按 manifest 声明文件逐个搬不够 —— 插件会自己
/// `fs.readText('.zn/plugins/<id>/vendor/…')` 读**未声明**的资源
/// （`outline-map` 的 MindElixir 三件套）。整目录复制才是完整搬家。
///
/// 目标侧**已存在的文件不覆盖**，返回本次实际复制的文件数
/// （全局根的内置 / 新版本优先，库内旧副本只补缺口）。
#[tauri::command]
fn copy_plugin_dir(
  from_vault: String,
  to_vault: String,
  plugin_id: String,
) -> Result<u32, String> {
  let src = plugin_dir(&from_vault, &plugin_id)?;
  let dst = plugin_dir(&to_vault, &plugin_id)?;
  if !src.is_dir() {
    return Err(format!("源插件目录不存在：{plugin_id}"));
  }
  fn walk(src: &Path, dst: &Path, copied: &mut u32) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("创建目标目录失败：{e}"))?;
    for entry in fs::read_dir(src).map_err(|e| format!("读取源目录失败：{e}"))? {
      let entry = entry.map_err(|e| e.to_string())?;
      let from = entry.path();
      let to = dst.join(entry.file_name());
      if from.is_dir() {
        walk(&from, &to, copied)?;
      } else {
        if to.exists() {
          continue;
        }
        fs::copy(&from, &to).map_err(|e| format!("复制插件文件失败：{e}"))?;
        *copied += 1;
      }
    }
    Ok(())
  }
  let mut copied = 0u32;
  walk(&src, &dst, &mut copied)?;
  Ok(copied)
}

/// 删除一个插件（连同它的目录：manifest / 入口 / store.json）。
///
/// 与笔记删除**不同**：这里直接删、不进回收站 —— 插件是"把目录拷回来就能重装"的东西，
/// 而回收站那套 `<时间戳>--<文件名>` 命名是为 `.md` 设计的，塞目录进去反而没人看得懂。
///
/// 安全边界两道：
/// ① `plugin_dir()` 的白名单（只允许字母数字与 `-` `_` `.`），越不出插件目录；
/// ② 删之前再确认目标**确实在** `<私有根>/.zn/plugins/` 之下，且不等于该目录本身
///    （`starts_with` 是路径组件级比较，不是字符串前缀，`..` 之类绕不过去）。
/// 一个 `.znp` 插件包（单文件 JSON）：
/// `{ "znp": 1, "manifest": { …manifest.json 的内容… }, "files": { "index.js": "…", "outline.css": "…" } }`
///
/// 为什么不打包成 zip：Rust 侧没有 zip 依赖；而插件包 99% 是文本 ——
/// JSON 包**零依赖、可读可 diff**，缺点只是二进制资源要 base64（目前没有插件带二进制）。
/// 包内路径全部走 `plugin_file()` 的白名单校验 ⇒ `..` 越不出去。
#[derive(serde::Deserialize)]
struct ZnPack {
  #[serde(default)]
  znp: Option<u32>,
  manifest: serde_json::Value,
  #[serde(default)]
  files: serde_json::Map<String, serde_json::Value>,
}

fn read_znp_file(path: &str) -> Result<ZnPack, String> {
  let raw = fs::read_to_string(path).map_err(|e| format!("读取插件包失败：{e}"))?;
  let pack: ZnPack =
    serde_json::from_str(&raw).map_err(|e| format!("插件包不是合法 JSON：{e}"))?;
  if let Some(v) = pack.znp {
    if v != 1 {
      return Err(format!("不支持的插件包版本：{v}（当前支持 1）"));
    }
  }
  let id = pack
    .manifest
    .get("id")
    .and_then(|v| v.as_str())
    .unwrap_or("");
  if id.is_empty() {
    return Err("插件包缺少 manifest.id".to_string());
  }
  if pack.manifest.get("entry").is_some() && pack.files.is_empty() {
    return Err("插件包声明了 entry 但 files 是空的".to_string());
  }
  Ok(pack)
}

/// 只读预览：安装确认框拿它显示名称 / 版本 / 能力 / 是否带 sha256。
#[tauri::command]
fn read_znp(path: String) -> Result<serde_json::Value, String> {
  let pack = read_znp_file(&path)?;
  let files: Vec<String> = pack.files.keys().cloned().collect();
  Ok(serde_json::json!({ "manifest": pack.manifest, "files": files }))
}

/// 安装 `.znp` 到 `<私有根>/.zn/plugins/<id>/`（覆盖写同名文件；不删旧文件）。
#[tauri::command]
fn install_znp(vault: String, path: String) -> Result<String, String> {
  let pack = read_znp_file(&path)?;
  let id = pack
    .manifest
    .get("id")
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string();
  let dir = plugin_dir(&vault, &id)?;
  fs::create_dir_all(&dir).map_err(|e| format!("创建插件目录失败：{e}"))?;
  let manifest_text = serde_json::to_string_pretty(&pack.manifest)
    .map_err(|e| format!("序列化 manifest 失败：{e}"))?;
  atomic_write(&dir.join("manifest.json"), &manifest_text)?;
  for (rel, val) in pack.files.iter() {
    let text = val
      .as_str()
      .ok_or_else(|| format!("插件包里的 {rel} 不是字符串（二进制资源暂不支持）"))?;
    let target = plugin_file(&vault, &id, rel)?;
    atomic_write(&target, text)?;
  }
  Ok(id)
}

#[tauri::command]
fn delete_plugin(vault: String, plugin_id: String) -> Result<(), String> {
  let dir = plugin_dir(&vault, &plugin_id)?;
  let root = private_root(&vault).join(PRIVATE_DIR).join("plugins");
  if dir == root || !dir.starts_with(&root) {
    return Err("拒绝删除：目标不在插件目录内".to_string());
  }
  if !dir.is_dir() {
    return Err(format!("插件不存在：{plugin_id}"));
  }
  fs::remove_dir_all(&dir).map_err(|e| format!("删除插件失败（{plugin_id}）：{e}"))?;
  Ok(())
}

/// 用**系统默认程序**打开一个外链（只允许 http/https）。
///
/// 为什么需要：编辑器里的链接点击走 `window.open`，而 Tauri 的 WebView **不接管**它
/// ⇒ 点上去静默无反应（2026-10-17 用户报「链接无法跳转打开浏览器」）。
///
/// 安全边界：这是「打开外部程序」的入口 ——
/// ① 只放行 `http://` / `https://`，其它协议（`file:` / `javascript:` / 自定义 scheme）一律拒绝；
/// ② **不经过 shell 解析**：Windows 用 `explorer`、macOS 用 `open`、Linux 用 `xdg-open`，
///    参数原样传给系统，不会出现 `&` / `|` 被解释成命令拼接的机会。
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
  let u = url.trim().to_string();
  if !(u.starts_with("http://") || u.starts_with("https://")) {
    return Err(format!("只允许打开 http/https 链接：{u}"));
  }
  #[cfg(target_os = "windows")]
  {
    std::process::Command::new("explorer")
      .arg(&u)
      .spawn()
      .map_err(|e| format!("打开链接失败：{e}"))?;
  }
  #[cfg(target_os = "macos")]
  {
    std::process::Command::new("open")
      .arg(&u)
      .spawn()
      .map_err(|e| format!("打开链接失败：{e}"))?;
  }
  #[cfg(target_os = "linux")]
  {
    std::process::Command::new("xdg-open")
      .arg(&u)
      .spawn()
      .map_err(|e| format!("打开链接失败：{e}"))?;
  }
  #[cfg(any(target_os = "android", target_os = "ios"))]
  {
    return Err("移动端暂不支持打开外部链接".to_string());
  }
  Ok(())
}

#[tauri::command]
fn read_plugin_file(vault: String, plugin_id: String, rel: String) -> Result<String, String> {
  let path = plugin_file(&vault, &plugin_id, &rel)?;
  fs::read_to_string(&path).map_err(|e| format!("读取插件文件失败 {}：{e}", path.display()))
}

/// **写入插件文件**（2026-10-17 内置插件预装用）。
///
/// 为什么需要：安卓上插件目录在应用私有空间，用户没法像桌面那样自己拷；
/// APK 要能把几个插件**随包预装**进去。前端把插件源码（`?raw` 导入）通过这条命令
/// 写进 `<私有根>/.zn/plugins/<id>/`，用户之后要装别的插件再自己往目录里加。
///
/// 走 `plugin_file` 而不是直接 `dir.join(rel)`：路径校验（防 `..` / 绝对路径）收在同一处。
#[tauri::command]
fn write_plugin_file(
  vault: String,
  plugin_id: String,
  rel: String,
  content: String,
) -> Result<(), String> {
  let path = plugin_file(&vault, &plugin_id, &rel)?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("创建插件目录失败：{e}"))?;
  }
  fs::write(&path, content).map_err(|e| format!("写插件文件失败 {}：{e}", path.display()))
}

#[tauri::command]
fn plugin_store_read(vault: String, plugin_id: String) -> Result<serde_json::Value, String> {
  let path = plugin_dir(&vault, &plugin_id)?.join("store.json");
  if !path.exists() {
    return Ok(serde_json::json!({}));
  }
  let text = fs::read_to_string(&path).map_err(|e| format!("读取插件存储失败：{e}"))?;
  if text.trim().is_empty() {
    return Ok(serde_json::json!({}));
  }
  serde_json::from_str(&text).map_err(|e| format!("插件存储不是合法 JSON：{e}"))
}

#[tauri::command]
fn plugin_store_write(
  vault: String,
  plugin_id: String,
  data: serde_json::Value,
) -> Result<(), String> {
  let path = plugin_dir(&vault, &plugin_id)?.join("store.json");
  let text = serde_json::to_string_pretty(&data).map_err(|e| format!("序列化失败：{e}"))?;
  atomic_write(&path, &text)
}

/* ───── 授权记录（capability 授权通道）—— 2026-10-13 已整体删除 ───── */
//
// 曾经：`net` / `proc` 走"默认拒 + 设置页授权"，记录落 `<私有根>/.zn/permissions.json`，
// `read_permissions` / `set_permission` 两条命令读写它，`loadPlugin()` 查不到就拒载。
//
// 2026-10-13 用户重定原则 4（内核不做权限判定、不承诺隔离）后，前端先停止读它（rev48），
// 本轮把**命令与记录整体删除**。为什么删：它兑现的从来不是隔离（三条绕过路径见
// `examples/raw-ipc-probe/`），而是"知情与承诺" —— 而同样的知情用设置页一行只读展示
// （`manifest.capabilities` 自述）就够了；留着只会让人以为这里还有一道门。
// 原文见 git 历史与 `docs/内核契约-v0.1.md` §4.1。

/* ───────────── 文件关联（双击 .md 用 ZeroNote 打开）───────────── */
//
// 三条系统入口最后都汇进同一个容器 `OpenedUrls`：
//  · Windows —— 命令行参数（首次启动）+ `tauri-plugin-single-instance` 回调（已在运行时再双击）
//    ⚠️ Windows 上**没有** `RunEvent::Opened`：tauri 2.12 的 `src/app.rs:263` 用
//    `#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]` 把它编译掉了。
//  · macOS / iOS / Android —— `RunEvent::Opened { urls }`（官方《File Associations on Mobile》）。
//
// 容器里存的是**平台路径**（`file://…` 在 Rust 侧就转好了），前端因此只需处理一种形态。

/// 系统 / 命令行递进来的待打开文件（FIFO；`opened_urls` **取走即清空**）。
#[derive(Default)]
struct OpenedUrls(Mutex<Vec<String>>);

/// 只认 `.md` / `.markdown`。扩展名不符时**静默忽略** —— 用户没要求打开、也没有错，
/// 弹一句"不支持的文件类型"只会打扰人（设计决定，见任务卡）。
fn is_markdown(path: &str) -> bool {
  let lower = path.to_lowercase();
  lower.ends_with(".md") || lower.ends_with(".markdown")
}

/// `file://…` → 平台路径（Windows 的 `file:///C:/a.md` → `C:\a.md`，并顺带处理百分号编码）。
/// 非 file scheme（Android 的「打开方式」可能给 `content://…`）原样返回 ——
/// `std::fs` 读不了内容 URI，但**必须如实交出去**：前端才能给出说明，而不是静默无反应。
fn url_to_path(url: &str) -> String {
  let raw = url.trim();
  match tauri::Url::parse(raw) {
    Ok(u) if u.scheme() == "file" => u
      .to_file_path()
      .map(|p| p.to_string_lossy().into_owned())
      .unwrap_or_else(|_| raw.to_string()),
    _ => raw.to_string(),
  }
}

/// 从一串候选（命令行参数或系统递来的 URI）里挑出**真正要打开**的路径。
///
/// 挡掉三样：空串、非 markdown、磁盘上不存在 —— 最后一条顺手把 `argv[0]`
/// （exe 自己的路径）之类的噪声一起挡了，不需要额外判断下标。
///
/// **例外**：内容 URI（`content://…`，Android SAF）不是文件路径，`is_file()` 判断不了它，
/// 所以按 scheme 特判后原样放行，把"到底能不能读"留给上层判 —— 现在读不了也得看得见。
fn pick_open_targets<I: IntoIterator<Item = String>>(raws: I) -> Vec<String> {
  let mut out: Vec<String> = Vec::new();
  for raw in raws {
    if raw.trim().is_empty() {
      continue;
    }
    let path = url_to_path(&raw);
    let is_content_uri = path.starts_with("content:")
      || path.starts_with("http:")
      || path.starts_with("https:");
    if is_content_uri {
      log::info!("ZeroNote 收到非文件 URI（当前读不了，仍如实上报）：{raw}");
      if !out.contains(&path) {
        out.push(path);
      }
      continue;
    }
    // 笔记（`.md`）与**只读文档**（pdf / epub / …）都放行 —— 后者交给插件
    // （`core.openDocument`）渲染。2026-10-14 加：此前只放行 `.md`，于是
    // 系统「打开方式」里选中 ZeroNote 开 PDF，会在这一行被**静默丢掉**。
    if !is_markdown(&path) && !is_readonly_doc(&path) {
      continue;
    }
    if fs::metadata(&path).map(|m| m.is_file()).unwrap_or(false) && !out.contains(&path) {
      out.push(path);
    }
  }
  out
}

/// 把一批路径**存进状态并广播事件**。
///
/// 两件事都做是有原因的：前端还没挂载时事件会丢（启动即带参数的情形），
/// 那时靠挂载后 `opened_urls` 拉取；前端已挂载时事件即时到达，不必等下一次拉取。
fn forward_open_targets(app: &tauri::AppHandle, raws: &[String]) {
  let targets = pick_open_targets(raws.to_vec());
  if targets.is_empty() {
    return;
  }
  if let Some(state) = app.try_state::<OpenedUrls>() {
    if let Ok(mut list) = state.0.lock() {
      for t in &targets {
        log::info!("ZeroNote 待打开：{t}");
        list.push(t.clone());
      }
    }
  }
  for t in targets {
    let _ = app.emit("zn:open-file", t);
  }
}

/// 取走攒下的待打开文件（启动参数 / 第二个实例转发 / 系统事件）。
/// **取走即清空**：否则前端每次刷新都会把同一个文件重开一遍。
#[tauri::command]
fn opened_urls(state: tauri::State<OpenedUrls>) -> Vec<String> {
  match state.0.lock() {
    Ok(mut list) => std::mem::take(&mut *list),
    Err(_) => Vec::new(),
  }
}

/* ───── 卡死兜底：前端心跳 ＋ 原生看门狗（2026-10-13 rev70）─────
 *
 * **为什么必须在原生侧**：插件是**进程内 JS**，`while(true)` 占死的是 WebView 的 JS 主线程
 * ⇒ 前端自己的 `setInterval`／任何"看门狗"都不再执行 —— "前端检测自己卡死"逻辑上不成立。
 * 所以判超时的一方放在 Rust 的**独立线程**上（它不受 WebView 主线程影响）。
 *
 * 三段设计的取舍、防误判与验收判据见 `docs/卡死兜底方案-2026-10-13.md`。
 *
 * 开关（默认开/默认值；dev 脚本里显式设 off）：
 *   · `ZN_WATCHDOG=off`             → 完全不启动看门狗线程
 *   · `ZN_WATCHDOG_DRYRUN=1`        → 只留痕、不退出（先观察会不会误判）
 *   · `ZN_WATCHDOG_TIMEOUT_MS=5000` → 超时阈值
 */

const WATCHDOG_TICK_MS: u64 = 1000;
const WATCHDOG_DEFAULT_TIMEOUT_MS: u64 = 5000;

/// 最后一次心跳的 epoch 毫秒。**0 = 还没收到过**（此时不判超时 —— 页面可能还在挂载）
static LAST_BEAT: AtomicU64 = AtomicU64::new(0);
/// 计时是否暂停（页面不可见 / 应用切后台 / 正在 reload）。**初始为暂停**，等前端第一次 resume。
static BEAT_PAUSED: AtomicBool = AtomicBool::new(true);
/// 当前库路径（心跳顺带送来）—— 卡死时要往 `<库>/.zn/watchdog.log` 留痕
static BEAT_VAULT: Mutex<Option<String>> = Mutex::new(None);

fn now_ms() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_millis() as u64)
    .unwrap_or(0)
}

/// 看门狗的**唯一判据**（抽成纯函数是为了能单测 —— 线程与 `process::exit` 都没法在单测里跑）。
fn watchdog_should_fire(last_beat: u64, now: u64, timeout_ms: u64, paused: bool) -> bool {
  if paused || last_beat == 0 {
    return false;
  }
  now.saturating_sub(last_beat) > timeout_ms
}

/// 阈值（`ZN_WATCHDOG_TIMEOUT_MS` 可覆盖）。抽出来是为了让看门狗线程与
/// `zn_watchdog_status` 用**同一份**口径（两处各读一次 env 迟早会不一致）。
fn watchdog_timeout_ms() -> u64 {
  std::env::var("ZN_WATCHDOG_TIMEOUT_MS")
    .ok()
    .and_then(|v| v.parse::<u64>().ok())
    .unwrap_or(WATCHDOG_DEFAULT_TIMEOUT_MS)
}

/// 前端心跳（页面可见时每秒一次）。顺带把库路径送来，供卡死时留痕。
#[tauri::command]
fn zn_heartbeat(vault: Option<String>) {
  if let Some(v) = vault {
    if let Ok(mut slot) = BEAT_VAULT.lock() {
      *slot = Some(v);
    }
  }
  LAST_BEAT.store(now_ms(), Ordering::Relaxed);
}

/// 暂停计时（`visibilitychange → hidden`、切后台、reload 前）。
/// **暂停期间不判超时** —— 手机切后台时 WebView 会被系统暂停、心跳自然停，
/// 不暂停就会被当成"卡死"误杀。
#[tauri::command]
fn zn_watchdog_pause() {
  BEAT_PAUSED.store(true, Ordering::Relaxed);
}

/// 恢复计时。**必须把 `LAST_BEAT` 重置为当前时刻** —— 否则暂停期间那段时间会被算进间隔，
/// 一恢复就立刻超时（这是最容易写错的一步）。
#[tauri::command]
fn zn_watchdog_resume() {
  LAST_BEAT.store(now_ms(), Ordering::Relaxed);
  BEAT_PAUSED.store(false, Ordering::Relaxed);
}

/// 诊断读数：看门狗眼里的状态。用来判断"到底有没有在计时、会不会误判"
/// （验收判据 §7 的 4/5 条靠它取数，而不是靠猜）。
#[tauri::command]
fn zn_watchdog_status() -> serde_json::Value {
  let last = LAST_BEAT.load(Ordering::Relaxed);
  let now = now_ms();
  serde_json::json!({
    "paused": BEAT_PAUSED.load(Ordering::Relaxed),
    "lastBeatAgoMs": if last == 0 { serde_json::Value::Null } else { serde_json::json!(now.saturating_sub(last)) },
    "timeoutMs": watchdog_timeout_ms(),
    "vault": BEAT_VAULT.lock().ok().and_then(|v| v.clone()),
    "disabled": std::env::var("ZN_WATCHDOG").map(|v| v.eq_ignore_ascii_case("off")).unwrap_or(false),
  })
}

/// 卡死留痕：往 `<库>/.zn/watchdog.log` 追加一行。**必须 Rust 写** —— 卡死时前端已执行不了。
/// 还不知道库路径（没选库）就跳过；调用方仍会打 `log::error!`（dev 有 log 插件会落文件）。
fn note_watchdog(gap_ms: u64, timeout_ms: u64) {
  let vault = BEAT_VAULT.lock().ok().and_then(|v| v.clone());
  let Some(vault) = vault else {
    return;
  };
  let dir = Path::new(&vault).join(PRIVATE_DIR);
  if fs::create_dir_all(&dir).is_err() {
    return;
  }
  let line = format!(
    "[{}] 前端无响应 {}ms（阈值 {}ms）⇒ 看门狗判定卡死\n",
    now_ms(),
    gap_ms,
    timeout_ms
  );
  if let Ok(mut f) = fs::OpenOptions::new()
    .create(true)
    .append(true)
    .open(dir.join("watchdog.log"))
  {
    let _ = f.write_all(line.as_bytes());
  }
}

/// 关闭 WebView2 的**浏览器加速键**（rev173.42 · 2026-10-19）。
///
/// 为什么必须做：WebView2 默认把 Ctrl+F 变成它**自带的查找栏**（窗口右上角、页面样式之外，
/// 位置无法自定义），而且会先于页面 keydown 吃掉按键 —— 于是 atomic 编辑器的查找面板
/// （`cm-atomic-search-input`，渲染在编辑器顶部）永远打不开，用户看到的"搜索框位置奇怪"
/// 就是这条内置查找栏。Tauri 2.12.3 **没有**把 wry 的 `with_browser_accelerator_keys`
/// 暴露到配置/Builder 上（已核 tauri-2.12.3 `src/webview` 无此 API），只能走
/// `with_webview` + `ICoreWebView2Settings3`。
///
/// 副作用（可接受）：Ctrl+R / F5 / Ctrl+P（打印）等浏览器快捷键一并失效 ——
/// 对桌面笔记应用是好事（避免误刷新丢编辑状态）；dev 仍靠 vite HMR，不依赖 F5。
#[cfg(windows)]
fn disable_browser_accelerator_keys(webview: &tauri::WebviewWindow) {
  use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
  use windows_core::Interface;

  let result = webview.with_webview(|wv| unsafe {
    let controller = wv.controller();
    let Ok(core) = controller.CoreWebView2() else {
      return;
    };
    let Ok(settings) = core.Settings() else { return };
    // Settings → Settings3 是同一 COM 对象的 QueryInterface（3 是 2 的子接口）
    let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() else {
      return;
    };
    if let Err(e) = settings3.SetAreBrowserAcceleratorKeysEnabled(false) {
      log::warn!("[webview2] 关闭浏览器加速键失败：{e}");
      return;
    }
    // 读回确认（静默失效比报错危险）
    let mut enabled = windows_core::BOOL(1);
    if settings3
      .AreBrowserAcceleratorKeysEnabled(&mut enabled)
      .is_ok()
    {
      log::info!(
        "[webview2] 浏览器加速键已关闭（读回 enabled={}）—— Ctrl+F 交给编辑器查找面板",
        enabled.as_bool()
      );
    }
  });
  if let Err(e) = result {
    log::warn!("[webview2] with_webview 调用失败：{e}");
  }
}

/// 起看门狗线程（`run()` 的 `setup` 里调用）。
fn spawn_watchdog() {
  if std::env::var("ZN_WATCHDOG")
    .map(|v| v.eq_ignore_ascii_case("off"))
    .unwrap_or(false)
  {
    log::info!("[watchdog] ZN_WATCHDOG=off ⇒ 不启动");
    return;
  }
  let dry = std::env::var("ZN_WATCHDOG_DRYRUN")
    .map(|v| v == "1")
    .unwrap_or(false);
  let timeout_ms = watchdog_timeout_ms();

  std::thread::spawn(move || {
    log::info!("[watchdog] 启动：阈值 {timeout_ms}ms · dryrun={dry}");
    // 只在"判定成立的那一刻"留痕一次；心跳回来（gap 回到阈值内）后允许再次判定。
    let mut reported = false;
    loop {
      std::thread::sleep(std::time::Duration::from_millis(WATCHDOG_TICK_MS));
      let paused = BEAT_PAUSED.load(Ordering::Relaxed);
      let last = LAST_BEAT.load(Ordering::Relaxed);
      let now = now_ms();
      if !watchdog_should_fire(last, now, timeout_ms, paused) {
        reported = false;
        continue;
      }
      if reported {
        continue;
      }
      reported = true;
      let gap = now.saturating_sub(last);
      log::error!("[watchdog] 前端无响应 {gap}ms（阈值 {timeout_ms}ms）");
      note_watchdog(gap, timeout_ms);
      if dry {
        log::warn!("[watchdog] DRYRUN：只留痕，不退出");
        continue;
      }
      // ⚠️ 用 `std::process::exit` 而**不是** `app.exit()`：后者要走 Tauri 的退出流程
      //（可能依赖主线程参与清理），而主线程此刻**已经死了** —— 等它等于一起卡住。
      // `std::process::exit` 只依赖当前这个线程，是卡死时唯一可靠的一条路。
      // 退出码 101 = Rust 的 panic 惯例码，便于事后从日志分辨"这是看门狗杀的"。
      std::process::exit(101);
    }
  });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // ⚠️ single-instance 必须是**第一个**注册的插件（官方要求）：它要在其它插件初始化之前
  // 就抢到单实例锁，否则第二个进程会先跑完一遍初始化才退出。
  // 这也是它必须 cfg 掉的原因 —— 该 crate 在 Android/iOS 上整体为空（见 Cargo.toml）。
  #[allow(unused_mut)]
  let mut builder = tauri::Builder::default();
  #[cfg(desktop)]
  {
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      // 第二个实例：把命令行参数转发给已在运行的窗口（Windows「双击 .md」走的就是这里）
      forward_open_targets(app, &argv);
    }));
  }

  builder
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_statusbar::init())
    .plugin(tauri_plugin_notification_capture::init())
    .plugin(tauri_plugin_uri_reader::init())
    .plugin(tauri_plugin_androidperm::init())
    .setup(|app| {
      app.manage(OpenedUrls::default());
      if cfg!(debug_assertions) {
        /*
         * ⚠️ **dev 日志只进 stdout，不写 `%LOCALAPPDATA%\com.aqua.zeronote\logs`**（rev173.11）。
         *
         * 起因（2026-10-18）：项目目录被标成 **Low 完整性级别**（Low IL），zeronote.exe 继承后
         * 写不了 `%LOCALAPPDATA%`（Medium）—— 表现是 `failed to initialize plugin log: 拒绝访问
         * (os error 5)` / `WebView2 0x8000FFFF`。IL 已用 `icacls src-tauri /setintegritylevel
         * (OI)(CI)Medium` 修好（见 HANDOFF rev173.11 §5）；日志仍只走 stdout，理由：
         * dev 看终端 / `.self-logs/desktop-dev.log` 就够（本来也是 stdout 重定向），
         * 少一个要维护的目录。要恢复文件日志：删掉 `.clear_targets()` 那行。
         */
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .clear_targets()
            .target(tauri_plugin_log::Target::new(
              tauri_plugin_log::TargetKind::Stdout,
            ))
            .build(),
        )?;
      }
      #[cfg(desktop)]
      {
        // 首次启动就带着文件（Windows 双击 .md，或从终端敲 `zeronote.exe a.md`）：
        // 此刻前端还没加载，事件发出去会丢 —— 先存进状态，等前端挂载后来 `opened_urls` 取。
        let targets = pick_open_targets(std::env::args().skip(1));
        if let Ok(mut list) = app.state::<OpenedUrls>().0.lock() {
          for t in targets {
            log::info!("ZeroNote 启动参数待打开：{t}");
            list.push(t);
          }
        }
      }
      spawn_watchdog();
      // 主窗口：关掉 WebView2 自带的浏览器快捷键（Ctrl+F 原生查找栏等）—— rev173.42
      #[cfg(windows)]
      if let Some(webview) = app.get_webview_window("main") {
        disable_browser_accelerator_keys(&webview);
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      list_notes,
      list_dirs,
      read_note,
      write_note,
      create_note,
      rename_note,
      delete_note,
      list_trash,
      restore_trash,
      purge_trash,
      empty_trash,
      note_exists,
      create_dir,
      move_entry,
      copy_entry,
      import_attachment,
      write_absolute,
      write_absolute_b64,
      list_plugins,
      read_plugin_file,
      write_plugin_file,
      plugin_store_read,
      plugin_store_write,
      vault_exists,
      ensure_vault,
      list_vaults,
      delete_plugin,
      copy_plugin_dir,
      read_znp,
      install_znp,
      open_external,
      opened_urls,
      zn_heartbeat,
      zn_watchdog_pause,
      zn_watchdog_resume,
      zn_watchdog_status
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|_app, _event| {
      // 原先这里是两个各自独立的 `if let ... = _event`；本轮加移动端前后台分支时发现
      // `RunEvent` 不是 `Copy`，第二处会撞 "use of moved value" ⇒ 改成一次 `match`。
      match _event {
        // macOS / iOS / Android：系统「用 ZeroNote 打开」递进来的 URL 走这个事件。
        // ⚠️ Windows **不在其中** —— `RunEvent::Opened` 在 tauri 2.12 里被
        // `#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]` 编译掉了，
        // 在 Windows 上直接匹配它根本不过编译。
        // Windows 靠上面的「启动参数 + 单实例转发」。
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        tauri::RunEvent::Opened { urls } => {
          let raws: Vec<String> = urls.iter().map(|u| u.to_string()).collect();
          forward_open_targets(_app, &raws);
        }

        // 卡死兜底：**移动端前后台** —— 切后台时 WebView 被系统暂停、心跳自然停，
        // 不暂停计时就会被看门狗当成"卡死"误杀（这是 rev70 之后唯一没接线的一环）。
        // ⚠️ 必须用 `WindowEvent::{Suspended,Resumed}`，**不能**用 `RunEvent::Resumed`：
        // 后者是"事件循环被恢复"，与移动端回到前台是两回事（读 tauri-2.12.3/src/app.rs 核实）。
        // 源码注释原话：Suspended 在 Android 由 Activity 的 `onPause` 触发、Resumed 由 `onResume`；
        // 且两者都是 `#[cfg(mobile)]`（桌面不支持）⇒ 整条臂也得 cfg 住，否则桌面编译不过。
        #[cfg(mobile)]
        tauri::RunEvent::WindowEvent {
          event: tauri::WindowEvent::Suspended,
          ..
        } => {
          log::info!("[watchdog] 应用切后台 ⇒ 暂停计时");
          BEAT_PAUSED.store(true, Ordering::Relaxed);
        }
        #[cfg(mobile)]
        tauri::RunEvent::WindowEvent {
          event: tauri::WindowEvent::Resumed,
          ..
        } => {
          log::info!("[watchdog] 回到前台 ⇒ 恢复计时");
          // 和前端 `zn_watchdog_resume` 一样：**必须重置 LAST_BEAT**，
          // 否则后台待的那段时间会被算进间隔，一回前台就立刻超时。
          LAST_BEAT.store(now_ms(), Ordering::Relaxed);
          BEAT_PAUSED.store(false, Ordering::Relaxed);
        }

        _ => {}
      }
    });
}

/* ───────────── 测试（M1 的自动化证据）───────────── */

#[cfg(test)]
mod tests {
  use super::*;

  /// 看门狗的唯一判据 —— 四条边界一次钉住（线程与 `process::exit` 都没法在单测里跑，故抽成纯函数）。
  #[test]
  fn watchdog_fires_only_after_timeout_and_never_when_paused() {
    // 还没收到过心跳 ⇒ 不判（页面可能还在挂载）
    assert!(!watchdog_should_fire(0, 999_999, 5_000, false));
    // 暂停中 ⇒ 永不判（切后台 / 页面隐藏 / reload）
    assert!(!watchdog_should_fire(1, 999_999, 5_000, true));
    // 恰好等于阈值 ⇒ 还不判（判据是**超过**阈值）
    assert!(!watchdog_should_fire(1_000, 6_000, 5_000, false));
    // 超过阈值 ⇒ 判
    assert!(watchdog_should_fire(1_000, 6_001, 5_000, false));
  }

  /// 测试临时目录。**刻意不用 `std::env::temp_dir()`（`%TEMP%`）**：
  /// 2026-10-12 夜实测 —— 测试进程往 `%TEMP%` 建目录被拒（`Os code 5 PermissionDenied`，
  /// 12/18 个用例全挂在 `create_dir_all`），而**同一路径在 pwsh 里可写**
  /// ⇒ 挡住的是跑测试的那个受限上下文，不是磁盘也不是权限表。
  /// 改放仓库内 `<repo>/_tmp-test/`：① 该前缀已在 `.gitignore`（`_tmp-*/`）；
  /// ② 与 `_tmp-vault-tb/` 同一约定；③ 路径可预测，出问题直接去看，
  /// 不再受系统临时目录的权限摆布。
  fn tmpdir(tag: &str) -> PathBuf {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("..")
      .join("_tmp-test");
    // 目录名**不带 pid**：带 pid 会每跑一次测试就多留 18 个目录（旧版落在 `%TEMP%` 里
    // 已经堆到 239 个）。固定名的并发风险为零 —— cargo 会在 target 目录上取锁，
    // 同一 target 的两个 cargo 命令是串行的；测试内部各用例 tag 互不相同。
    let d = root.join(format!("zn-test-{tag}"));
    match fs::remove_dir_all(&d) {
      Ok(()) => {}
      Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
      // 清理失败**不再静默忽略** —— 上一版的 `let _ =` 正是把"不可写"这个真问题藏起来的那句
      Err(e) => panic!("清理测试目录失败（{}）：{e}", d.display()),
    }
    fs::create_dir_all(&d)
      .unwrap_or_else(|e| panic!("创建测试目录失败（{}）：{e}", d.display()));
    d
  }

  /// 库存在性探测（「最近库自动清理」的判据）：真目录为真；被删掉的库、文件、空串都为假；
  /// 而且**探测本身绝不创建目录** —— 它一旦顺手建库，"库没了"就会被静默伪装成"库还在"。
  #[test]
  fn vault_exists_is_read_only() {
    let d = tmpdir("vault-exists");
    let vault = d.join("vault");
    fs::create_dir_all(&vault).unwrap();
    let s = |p: &Path| p.to_string_lossy().to_string();

    assert!(vault_exists(s(&vault)));
    // 探测不得创建目录（这是它不能复用 ensure_vault 的原因）
    let ghost = d.join("ghost");
    assert!(!vault_exists(s(&ghost)));
    assert!(!ghost.exists(), "探测不应创建目录");
    // 文件不是库目录
    let file = d.join("note.md");
    fs::write(&file, "x").unwrap();
    assert!(!vault_exists(s(&file)));
  }

  /// 显示名回退链的前两级：frontmatter.title 优先；否则正文首行（剥掉行首标记）；
  /// 两级都没有 ⇒ 返回 None，由调用方回退到文件名。
  #[test]
  fn display_title_prefers_frontmatter_then_first_line() {
    let none = serde_json::json!({});
    assert_eq!(display_title(&none, "# 新笔记\n").as_deref(), Some("新笔记"));
    // 前面的空行要跳过
    assert_eq!(display_title(&none, "\n\n## 第二条\n正文\n").as_deref(), Some("第二条"));
    // 列表 / 待办 / 引用 / 有序列表的行首标记都要剥掉
    assert_eq!(display_title(&none, "- 条目\n").as_deref(), Some("条目"));
    assert_eq!(display_title(&none, "- [ ] 待办事项\n").as_deref(), Some("待办事项"));
    assert_eq!(display_title(&none, "> 引用一句\n").as_deref(), Some("引用一句"));
    assert_eq!(display_title(&none, "12. 有序条目\n").as_deref(), Some("有序条目"));
    // frontmatter 块本身不能当标题；块里的 title 优先于正文首行
    let text = "---\ntitle: 正式标题\n---\n\n# 正文首行\n";
    let fm = parse_frontmatter(text);
    assert_eq!(fm.get("title").and_then(|v| v.as_str()), Some("正式标题"));
    assert_eq!(display_title(&fm, text).as_deref(), Some("正式标题"));
    // 只有 frontmatter、没有正文 ⇒ None（调用方回退文件名）
    assert_eq!(display_title(&none, "---\na: 1\n---\n"), None);
    // 空文件 / 纯空行
    assert_eq!(display_title(&none, ""), None);
    assert_eq!(display_title(&none, "\n\n\n"), None);
    // 超长首行按**字符**截断（既不能 panic，也不能切碎中文）
    let long = format!("# {}\n", "字".repeat(100));
    let got = display_title(&none, &long).unwrap();
    assert_eq!(got.chars().count(), 81); // 80 字 + 省略号
    assert!(got.ends_with('…'));
  }

  /// 删除插件：正常路径删掉整个目录；越界 id 与不存在的 id 都必须报错（不能静默成功）
  #[test]
  fn delete_plugin_removes_dir_and_rejects_bad_ids() {
    let d = tmpdir("delplug");
    let p = d.join(".zn").join("plugins").join("hello");
    fs::create_dir_all(&p).unwrap();
    fs::write(p.join("manifest.json"), "{}").unwrap();
    assert!(p.is_dir());

    let vault = d.to_string_lossy().into_owned();
    delete_plugin(vault.clone(), "hello".to_string()).unwrap();
    assert!(!p.exists(), "插件目录应当被删掉");

    // 白名单：带路径分隔符 / 试图越界的一律拒绝
    assert!(delete_plugin(vault.clone(), "../evil".to_string()).is_err());
    assert!(delete_plugin(vault.clone(), "a/b".to_string()).is_err());
    // 不存在 ⇒ 明确报错，而不是假装成功（界面不该弹出"已删除"）
    assert!(delete_plugin(vault, "nope".to_string()).is_err());
  }

  // 授权记录的两个用例（授权往返 / 坏文件 fail closed）随 `permissions.json` 与
  // `read_permissions` / `set_permission` 于 2026-10-13 一并删除（rev66）。

  /// 导出目标校验：相对路径拒绝；Android 的 SAF URI 要给**专门**的说明
  /// （而不是"必须是绝对路径"那种误导信息）
  #[test]
  fn export_target_rejects_relative_and_saf_uri() {
    assert!(export_target("a.txt").is_err());
    let e = export_target("content://com.android.providers.downloads/document/1").unwrap_err();
    assert!(e.contains("SAF"), "应给出 Android SAF 的专门说明，实际：{e}");

    #[cfg(windows)]
    {
      assert!(export_target("C:\\tmp\\a.txt").is_ok());
      // Windows 上 /tmp/... 没有盘符，不算绝对路径
      assert!(export_target("/tmp/a.txt").is_err());
    }
    #[cfg(not(windows))]
    assert!(export_target("/tmp/a.txt").is_ok());
  }

  /// base64 解码：常规输入 / 缺填充 / 含换行 / 非法字符必须报错
  #[test]
  fn b64_decode_handles_padding_and_rejects_garbage() {
    assert_eq!(b64_decode("").unwrap(), Vec::<u8>::new());
    assert_eq!(b64_decode("aGVsbG8=").unwrap(), b"hello".to_vec());
    assert_eq!(b64_decode("aGVsbG8").unwrap(), b"hello".to_vec()); // 缺填充也能解
    assert_eq!(b64_decode("5L2g5aW9").unwrap(), "你好".as_bytes().to_vec());
    assert_eq!(b64_decode("aGVs\nbG8=").unwrap(), b"hello".to_vec()); // 容忍换行
    assert!(b64_decode("!!!!").is_err()); // 非法字符要报错，别静默产出坏数据
  }

  /// 文件夹操作：多级建目录（幂等）· 整树搬迁 · `mv` 语义 · 拒绝把目录移进自己的子孙
  #[test]
  fn dir_ops_create_and_move_safely() {
    let d = tmpdir("dirops");
    let vault = d.to_string_lossy().into_owned();

    create_dir(vault.clone(), "笔记/2026/10".to_string()).unwrap();
    assert!(d.join("笔记").join("2026").join("10").is_dir());
    create_dir(vault.clone(), "笔记/2026/10".to_string()).unwrap(); // 幂等

    // 目录里放个文件，验证搬的是整棵树
    fs::write(d.join("笔记").join("a.md"), "x").unwrap();
    move_entry(vault.clone(), "笔记".to_string(), "归档".to_string()).unwrap();
    assert!(d.join("归档").join("a.md").is_file());
    assert!(!d.join("笔记").exists());

    // 目标是已存在目录 ⇒ 移入其中（mv 语义）
    create_dir(vault.clone(), "目标".to_string()).unwrap();
    move_entry(vault.clone(), "归档/a.md".to_string(), "目标".to_string()).unwrap();
    assert!(d.join("目标").join("a.md").is_file());

    // 目录不能移进自己的子孙
    assert!(move_entry(vault.clone(), "目标".to_string(), "目标/子".to_string()).is_err());
    // 越界路径照样被 resolve 的白名单挡下
    assert!(create_dir(vault.clone(), "../evil".to_string()).is_err());
    assert!(move_entry(vault, "目标".to_string(), "../evil".to_string()).is_err());
  }

  /// private_root：库位于 `.vaults/<名字>/` 时，私有目录落到**库根**
  /// —— 插件与 store 因此跨库共用（切库不会"插件全没了"）
  #[test]
  fn private_root_hoists_sub_vaults_to_vault_root() {
    assert_eq!(private_root("C:/root"), PathBuf::from("C:/root"));
    assert_eq!(private_root("C:/root/.vaults/Work"), PathBuf::from("C:/root"));
    // 只认一层容器：更深的普通子目录不特殊对待
    assert_eq!(private_root("C:/root/a/b"), PathBuf::from("C:/root/a/b"));
  }

  #[test]
  fn resolve_rejects_escape_and_absolute() {
    assert!(resolve("C:/vault", "../evil.md").is_err());
    assert!(resolve("C:/vault", "a/../../b.md").is_err());
    assert!(resolve("C:/vault", "").is_err());
    assert!(resolve("C:/vault", "notes/a.md").is_ok());
    assert!(resolve("C:/vault", "日记/2026-10-11.md").is_ok());
  }

  #[test]
  fn atomic_write_creates_then_overwrites_without_leftover() {
    let d = tmpdir("aw");
    let f = d.join("a.md");
    atomic_write(&f, "第一版").unwrap();
    assert_eq!(fs::read_to_string(&f).unwrap(), "第一版");
    atomic_write(&f, "第二版").unwrap();
    assert_eq!(fs::read_to_string(&f).unwrap(), "第二版");
    assert!(!d.join("a.zn-tmp").exists(), "临时文件必须被清掉");
  }

  /// rev119：`.znp` 安装写到 `<库>/.zn/plugins/<id>/`
  #[test]
  fn install_znp_writes_manifest_and_entries() {
    let d = tmpdir("znp");
    let v = d.to_string_lossy().to_string();
    let pack = r#"{"znp":1,"manifest":{"id":"demo","name":"演示","version":"1.0.0","apiVersion":"^0.2.0","entry":"index.js"},"files":{"index.js":"export default { apply(){} }"}}"#;
    let p = d.join("demo.znp");
    fs::write(&p, pack).unwrap();
    let id = install_znp(v, p.to_string_lossy().to_string()).unwrap();
    assert_eq!(id, "demo");
    let mf = fs::read_to_string(d.join(".zn/plugins/demo/manifest.json")).unwrap();
    assert!(mf.contains("\"demo\""));
    let js = fs::read_to_string(d.join(".zn/plugins/demo/index.js")).unwrap();
    assert!(js.contains("apply"));
  }

  /// rev119：插件包里的 `..` 必须被拒（插件目录逃逸）
  #[test]
  fn install_znp_rejects_path_escape() {
    let d = tmpdir("znp2");
    let pack = r#"{"znp":1,"manifest":{"id":"demo","name":"x","version":"1","apiVersion":"^0.2.0","entry":"index.js"},"files":{"../evil.js":"x"}}"#;
    let p = d.join("bad.znp");
    fs::write(&p, pack).unwrap();
    assert!(
      install_znp(d.to_string_lossy().to_string(), p.to_string_lossy().to_string()).is_err(),
      "含 .. 的路径必须被拒"
    );
  }

  /// rev118：ID 稳定、改名后跟着走、引用被重写（文件名与标题两种写法）
  #[test]
  fn ids_are_stable_and_follow_rename() {
    let d = tmpdir("ids");
    let v = d.to_string_lossy().to_string();
    fs::write(d.join("a.md"), "# 甲\n").unwrap();
    fs::write(d.join("b.md"), "见 [[a]] 与 [[甲]]\n").unwrap();
    let first = list_notes(v.clone(), None).unwrap();
    let a_id = first
      .iter()
      .find(|m| m.path == "a.md")
      .expect("a.md 应在列表里")
      .id
      .clone();
    assert!(!a_id.is_empty(), "ID 不应为空");
    let again = list_notes(v.clone(), None).unwrap();
    assert_eq!(
      again.iter().find(|m| m.path == "a.md").unwrap().id,
      a_id,
      "同一路径两次 list 的 ID 必须一致"
    );

    rename_note(v.clone(), "a.md".into(), "c.md".into()).unwrap();
    let after = list_notes(v.clone(), None).unwrap();
    assert_eq!(
      after.iter().find(|m| m.path == "c.md").unwrap().id,
      a_id,
      "改名后 ID 必须跟着文件走"
    );
    assert_eq!(
      fs::read_to_string(d.join("b.md")).unwrap(),
      "见 [[c]] 与 [[c]]\n",
      "[[文件名]] 与 [[标题]] 两种引用都要重写"
    );
  }

  /// rev118：`](旧相对路径)` 也要重写，`[[旧名|显示名]]` 保留显示名
  #[test]
  fn rename_rewrites_path_links_and_aliases() {
    let d = tmpdir("rw");
    let v = d.to_string_lossy().to_string();
    fs::write(d.join("a.md"), "# 甲\n").unwrap();
    fs::write(d.join("b.md"), "链接：](a.md) 和 [[a|别名]]\n").unwrap();
    rename_note(v, "a.md".into(), "c.md".into()).unwrap();
    assert_eq!(
      fs::read_to_string(d.join("b.md")).unwrap(),
      "链接：](c.md) 和 [[c|别名]]\n"
    );
  }

  #[test]
  fn create_note_never_overwrites() {
    let d = tmpdir("cn");
    let v = d.to_string_lossy().to_string();
    create_note(v.clone(), "n.md".into(), "one".into()).unwrap();
    assert!(create_note(v, "n.md".into(), "two".into()).is_err());
    assert_eq!(fs::read_to_string(d.join("n.md")).unwrap(), "one");
  }

  #[test]
  fn delete_moves_to_trash_instead_of_unlinking() {
    let d = tmpdir("del");
    let v = d.to_string_lossy().to_string();
    create_note(v.clone(), "x.md".into(), "hi".into()).unwrap();
    delete_note(v, "x.md".into()).unwrap();
    assert!(!d.join("x.md").exists());
    let trash = d.join(".zn").join("trash");
    assert_eq!(fs::read_dir(&trash).unwrap().count(), 1);
  }

  /// `move_tree` 只搬内容、保持层级、**不删源目录**（收尾由 `delete_note` 负责）。
  #[test]
  fn move_tree_preserves_layout() {
    let d = tmpdir("mvtree");
    let src = d.join("src");
    fs::create_dir_all(src.join("子")).unwrap();
    fs::write(src.join("子").join("a.md"), "A").unwrap();
    fs::write(src.join("b.md"), "B").unwrap();
    let dst = d.join("dst");
    move_tree(&src, &dst).unwrap();
    assert_eq!(fs::read_to_string(dst.join("子").join("a.md")).unwrap(), "A");
    assert_eq!(fs::read_to_string(dst.join("b.md")).unwrap(), "B");
    assert!(src.exists(), "move_tree 不删源目录");
  }

  /// **非空目录删除**（2026-10-17 真机 bug 的回归）：两层嵌套 + 两个文件，
  /// 必须完整进回收站、能恢复回原位、内容不丢。
  ///
  /// 为什么这条必须存在：Windows 上「非空目录 rename 进已存在目录」会 ACCESS_DENIED，
  /// 而空目录/文件正常 —— 此前没有用例覆盖"删一个**有内容**的文件夹"这个组合。
  #[test]
  fn delete_non_empty_dir_survives_and_restores() {
    let d = tmpdir("deldir");
    let v = d.to_string_lossy().to_string();
    fs::create_dir_all(d.join("父").join("子")).unwrap();
    fs::write(d.join("父").join("子").join("x.md"), "# x").unwrap();
    fs::write(d.join("父").join("y.md"), "# y").unwrap();

    let trash_path = delete_note(v.clone(), "父".into()).unwrap();
    assert!(!d.join("父").exists(), "源目录必须被移走：{trash_path}");
    let list = list_trash(v.clone()).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].original_path.as_deref(), Some("父"));
    assert!(list[0].is_dir);

    assert_eq!(restore_trash(v.clone(), list[0].id.clone()).unwrap(), "父");
    assert_eq!(
      fs::read_to_string(d.join("父").join("子").join("x.md")).unwrap(),
      "# x",
      "恢复后嵌套内容必须还在"
    );
    assert_eq!(fs::read_to_string(d.join("父").join("y.md")).unwrap(), "# y");
  }

  /// 回收站全链路：删除记下**原路径** → 列表 → 恢复回**原处** → 彻底删除 / 清空。
  /// 另含两条边界：旧格式（扁平 `<时间戳>--<名>`）兼容、原位置撞名时**拒绝恢复而不是覆盖**。
  #[test]
  fn trash_roundtrip_list_restore_purge_and_legacy_format() {
    let d = tmpdir("trash");
    let v = d.to_string_lossy().to_string();
    fs::create_dir_all(d.join("a").join("b")).unwrap();
    fs::write(d.join("a").join("b").join("n.md"), "# n").unwrap();

    // ① 删除子目录里的文件：回收站记下原路径
    let trash_path = delete_note(v.clone(), "a/b/n.md".into()).unwrap();
    assert!(trash_path.starts_with(".zn/trash/"), "要返回回收站内路径：{trash_path}");
    let list = list_trash(v.clone()).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].original_path.as_deref(), Some("a/b/n.md"), "原路径必须记下来");
    assert_eq!(list[0].name, "n.md");
    assert!(!list[0].is_dir);

    // ② 恢复 ⇒ 回原位，回收站随之清空
    assert_eq!(restore_trash(v.clone(), list[0].id.clone()).unwrap(), "a/b/n.md");
    assert!(d.join("a").join("b").join("n.md").is_file(), "要恢复回原处");
    assert!(list_trash(v.clone()).unwrap().is_empty(), "恢复后回收站该空了");

    // ③ 删整个**目录** ⇒ 列表标 is_dir、大小递归求和（`# n` = 3 字节）
    delete_note(v.clone(), "a/b".into()).unwrap();
    let list = list_trash(v.clone()).unwrap();
    assert_eq!(list[0].original_path.as_deref(), Some("a/b"), "原路径是库内相对路径");
    assert!(list[0].is_dir, "目录要标出来");
    assert_eq!(list[0].size, 3, "目录大小要递归求和");
    purge_trash(v.clone(), list[0].id.clone()).unwrap();
    assert!(list_trash(v.clone()).unwrap().is_empty(), "彻底删除后为空");

    // ④ 旧格式兼容：手搓一个扁平的 `<stamp>--<name>`
    fs::write(d.join(".zn").join("trash").join("1700000000000--old.md"), "# old").unwrap();
    let list = list_trash(v.clone()).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].original_path, None, "旧格式没有原路径");
    assert_eq!(list[0].deleted_at, 1700000000000);
    assert_eq!(restore_trash(v.clone(), list[0].id.clone()).unwrap(), "old.md");
    assert!(d.join("old.md").is_file(), "旧格式只能恢复到库根");

    // ⑤ 原位置已有同名项 ⇒ 拒绝恢复（不覆盖），条目留在回收站里
    fs::write(d.join("keep.md"), "# keep").unwrap();
    delete_note(v.clone(), "keep.md".into()).unwrap();
    fs::write(d.join("keep.md"), "# 新的").unwrap();
    let list = list_trash(v.clone()).unwrap();
    assert!(restore_trash(v.clone(), list[0].id.clone()).is_err(), "撞名要拒绝");
    assert_eq!(list_trash(v.clone()).unwrap().len(), 1, "拒绝后条目仍在回收站");

    // ⑥ 清空 + id 合法性强校验
    assert!(purge_trash(v.clone(), "../escape".into()).is_err(), "路径分隔要拒绝");
    assert_eq!(empty_trash(v.clone()).unwrap(), 1);
    assert!(list_trash(v).unwrap().is_empty());
  }

  /// 外部打开（系统「打开方式」/ 命令行参数 / 单实例转发）要认**只读文档**：
  /// 2026-10-14 前只放行 `.md`，于是选中 ZeroNote 开 PDF 会在 `pick_open_targets` 里被静默丢掉。
  #[test]
  fn pick_open_targets_accepts_readonly_docs_but_not_other_files() {
    let d = tmpdir("open");
    fs::write(d.join("a.pdf"), "%PDF-1.4").unwrap();
    fs::write(d.join("b.epub"), "PK").unwrap();
    fs::write(d.join("c.png"), "PNG").unwrap();
    fs::write(d.join("d.md"), "# d").unwrap();

    let picked = pick_open_targets(vec![
      d.join("a.pdf").to_string_lossy().to_string(),
      d.join("b.epub").to_string_lossy().to_string(),
      d.join("c.png").to_string_lossy().to_string(),
      d.join("d.md").to_string_lossy().to_string(),
    ]);
    let names: Vec<String> = picked
      .iter()
      .filter_map(|p| Path::new(p).file_name().map(|n| n.to_string_lossy().to_string()))
      .collect();
    assert!(names.contains(&"a.pdf".to_string()), "PDF 要放行：{names:?}");
    assert!(names.contains(&"b.epub".to_string()), "EPUB 要放行：{names:?}");
    assert!(names.contains(&"d.md".to_string()), "笔记要放行：{names:?}");
    assert!(!names.contains(&"c.png".to_string()), "图片不放行：{names:?}");
  }

  #[test]
  fn list_covers_notes_and_readonly_docs_but_skips_others() {
    let d = tmpdir("ls");
    let v = d.to_string_lossy().to_string();
    fs::write(d.join("a.md"), "# a").unwrap();
    fs::write(d.join("b.pdf"), "%PDF-1.4").unwrap();
    fs::write(d.join("c.png"), "PNG").unwrap();
    fs::write(d.join("d.bin"), "BIN").unwrap();
    fs::create_dir_all(d.join("子目录")).unwrap();
    fs::write(d.join("子目录").join("c.md"), "# c").unwrap();
    fs::create_dir_all(d.join(".zn")).unwrap();
    fs::write(d.join(".zn").join("secret.md"), "# s").unwrap();

    let list = list_notes(v, None).unwrap();
    let paths: Vec<String> = list.iter().map(|m| m.path.clone()).collect();
    assert!(paths.contains(&"a.md".to_string()));
    assert!(paths.contains(&"子目录/c.md".to_string()), "中文子目录要能递归：{paths:?}");
    assert!(!paths.iter().any(|p| p.contains(".zn")), ".zn 不能进文件树");
    assert!(
      !paths.iter().any(|p| p.ends_with(".bin")),
      "非笔记 / 非文档 / 非图片的文件仍不进文件树：{paths:?}"
    );

    // 2026-10-13：只读文档也进文件树（此前只收 .md ⇒ 库里的 PDF 根本看不见）
    let pdf = list
      .iter()
      .find(|m| m.path == "b.pdf")
      .expect("文档要进文件树");
    assert_eq!(pdf.kind, "doc", "文档的 kind 必须是 doc");
    assert_eq!(pdf.title, "b", "文档显示名 = 去掉扩展名的文件名（类型由前端徽章显示）");
    assert!(pdf.frontmatter.is_null(), "文档不解析 frontmatter");
    let md = list.iter().find(|m| m.path == "a.md").unwrap();
    assert_eq!(md.kind, "note", "笔记的 kind 是 note");

    // 2026-10-18 rev173.3：图片附件也进文件树（前端归到「附件」分组）
    let png = list
      .iter()
      .find(|m| m.path == "c.png")
      .expect("图片要进文件树（附件的入口）");
    assert_eq!(png.kind, "image", "图片的 kind 必须是 image");
    assert_eq!(png.title, "c", "图片显示名 = 去掉扩展名的文件名");
    assert!(png.frontmatter.is_null(), "图片不解析 frontmatter");
  }

  /// 空目录也要上报 —— 文件树若只靠 `list_notes` 反推目录，**空文件夹根本不会显示**
  /// （"新建文件夹"看起来像没反应）。忽略/私密目录照旧不进清单。
  #[test]
  fn list_dirs_reports_empty_dirs_and_skips_ignored() {
    let d = tmpdir("dirs");
    let v = d.to_string_lossy().to_string();
    fs::create_dir_all(d.join("空目录")).unwrap();
    fs::create_dir_all(d.join("a").join("b")).unwrap();
    fs::create_dir_all(d.join(".zn").join("plugins")).unwrap();
    fs::create_dir_all(d.join("node_modules").join("x")).unwrap();

    let dirs = list_dirs(v).unwrap();
    assert!(dirs.contains(&"空目录".to_string()), "空目录必须上报：{dirs:?}");
    assert!(dirs.contains(&"a".to_string()), "父目录要上报：{dirs:?}");
    assert!(dirs.contains(&"a/b".to_string()), "多级目录要递归：{dirs:?}");
    assert!(
      !dirs
        .iter()
        .any(|p| p.starts_with(".zn") || p.contains("node_modules")),
      "忽略目录不进清单：{dirs:?}"
    );
  }

  /// 「创建副本」的地基：递归复制整棵树，**私有目录不外泄**，且三种拒绝都要挡住
  /// （源不存在 / 目标已存在 / 复制进自己的子孙）。
  #[test]
  fn copy_entry_copies_tree_and_refuses_bad_targets() {
    let d = tmpdir("copy");
    let v = d.to_string_lossy().to_string();
    fs::create_dir_all(d.join("src").join("sub")).unwrap();
    fs::write(d.join("src").join("a.md"), "# a").unwrap();
    fs::write(d.join("src").join("sub").join("b.md"), "# b").unwrap();
    fs::create_dir_all(d.join("src").join(".zn")).unwrap();
    fs::write(d.join("src").join(".zn").join("secret.md"), "# s").unwrap();

    copy_entry(v.clone(), "src".into(), "dst".into()).unwrap();
    assert!(d.join("dst").join("a.md").is_file(), "顶层文件要复制");
    assert!(d.join("dst").join("sub").join("b.md").is_file(), "子目录要递归");
    assert!(!d.join("dst").join(".zn").exists(), "私有目录不该被复制出去");

    // `to` 是**已存在的目录** ⇒ 复制**进**该目录（与 move 同一套语义）：dst/ 里再得一个 src/
    copy_entry(v.clone(), "src".into(), "dst".into()).unwrap();
    assert!(
      d.join("dst").join("src").join("a.md").is_file(),
      "目标是已存在目录时应复制进去"
    );
    assert!(copy_entry(v.clone(), "nope".into(), "x".into()).is_err(), "源不存在要报错");

    // 真正的不覆盖：目标同名**文件**已存在
    assert!(copy_entry(v.clone(), "src/a.md".into(), "dst/a.md".into()).is_err());

    // `to` 是已存在的目录 ⇒ 复制进去
    copy_entry(v.clone(), "src/a.md".into(), "dst/sub".into()).unwrap();
    assert!(d.join("dst").join("sub").join("a.md").is_file());

    // 复制进自己的子孙 ⇒ 拒绝（否则边复制边读取，越滚越大）
    assert!(copy_entry(v, "src".into(), "src/sub/x".into()).is_err());
  }

  #[test]
  fn frontmatter_parsed_from_leading_block() {
    let v = parse_frontmatter("---\ntitle: 测试\ntags: [a, b]\n---\n\n正文");
    assert_eq!(v["title"], "测试");
    assert!(parse_frontmatter("没有 frontmatter 的正文")
      .as_object()
      .unwrap()
      .is_empty());
  }

  /* ── 插件相关（M2）── */

  #[test]
  fn plugin_paths_are_sandboxed() {
    let d = tmpdir("plug");
    let v = d.to_string_lossy().to_string();
    assert!(plugin_dir(&v, "hello").is_ok());
    assert!(plugin_dir(&v, "hello-plugin_1.0").is_ok());
    assert!(plugin_dir(&v, "../evil").is_err(), "插件 id 不许带路径分隔");
    assert!(plugin_dir(&v, "a/b").is_err());
    assert!(plugin_dir(&v, "").is_err());
    assert!(plugin_file(&v, "hello", "../x.js").is_err());
    assert!(plugin_file(&v, "hello", "index.js").is_ok());
  }

  #[test]
  fn plugin_store_roundtrip() {
    let d = tmpdir("pstore");
    let v = d.to_string_lossy().to_string();
    let data = serde_json::json!({ "count": 1, "name": "灵感流" });
    plugin_store_write(v.clone(), "hello".into(), data.clone()).unwrap();
    assert_eq!(plugin_store_read(v, "hello".into()).unwrap(), data);
  }

  #[test]
  fn list_plugins_returns_sorted_dir_names() {
    let d = tmpdir("lplug");
    let v = d.to_string_lossy().to_string();
    for name in ["beta", "alpha"] {
      let p = d.join(".zn").join("plugins").join(name);
      fs::create_dir_all(&p).unwrap();
      fs::write(p.join("manifest.json"), "{}").unwrap();
    }
    assert_eq!(
      list_plugins(v).unwrap(),
      vec!["alpha".to_string(), "beta".to_string()]
    );
  }

  /// 插件整目录复制（rev173.6 清理迁移）：子目录一起带走，目标已有文件不覆盖。
  #[test]
  fn copy_plugin_dir_copies_tree_and_keeps_existing() {
    let d = tmpdir("copyplug");
    let vault = d.join("vault");
    let global = d.join("global");
    // 源：库内插件，带**未声明**的 vendor 子目录
    let src = vault.join(".zn").join("plugins").join("p1");
    fs::create_dir_all(src.join("vendor")).unwrap();
    fs::write(src.join("manifest.json"), "{}").unwrap();
    fs::write(src.join("vendor").join("lib.js"), "v1").unwrap();
    // 目标：已有一个更新的 manifest
    let dst = global.join(".zn").join("plugins").join("p1");
    fs::create_dir_all(&dst).unwrap();
    fs::write(dst.join("manifest.json"), "new").unwrap();

    let n = copy_plugin_dir(
      vault.to_string_lossy().to_string(),
      global.to_string_lossy().to_string(),
      "p1".into(),
    )
    .unwrap();
    assert_eq!(n, 1, "只补缺口：manifest 已存在不覆盖，vendor/lib.js 要复制");
    assert_eq!(fs::read_to_string(dst.join("manifest.json")).unwrap(), "new");
    assert_eq!(
      fs::read_to_string(dst.join("vendor").join("lib.js")).unwrap(),
      "v1"
    );

    // 源不存在 ⇒ 明确报错
    assert!(copy_plugin_dir(
      vault.to_string_lossy().to_string(),
      global.to_string_lossy().to_string(),
      "nope".into(),
    )
    .is_err());
  }

  /* ── 插入图片（rev173）── */

  /// 复制进笔记所在目录：返回库内相对路径、内容一致、重名不覆盖。
  #[test]
  fn import_attachment_copies_next_to_note_without_overwrite() {
    let d = tmpdir("attach");
    let vault = d.join("vault");
    fs::create_dir_all(vault.join("sub")).unwrap();
    fs::write(vault.join("sub").join("a.md"), "x").unwrap();
    let src = d.join("picked.png");
    fs::write(&src, b"PNG1").unwrap();
    let v = vault.to_string_lossy().to_string();
    let s = src.to_string_lossy().to_string();

    let rel = import_attachment(
      v.clone(),
      "sub/a.md".into(),
      s.clone(),
      "image-20261018-200000".into(),
    )
    .unwrap();
    assert_eq!(rel, "sub/image-20261018-200000.png");
    assert_eq!(fs::read(vault.join(&rel)).unwrap(), b"PNG1");

    // 同一秒再插一张 ⇒ 加 -1，绝不覆盖
    fs::write(&src, b"PNG2").unwrap();
    let rel2 = import_attachment(
      v,
      "sub/a.md".into(),
      s,
      "image-20261018-200000".into(),
    )
    .unwrap();
    assert_eq!(rel2, "sub/image-20261018-200000-1.png");
    assert_eq!(
      fs::read(vault.join("sub/image-20261018-200000.png")).unwrap(),
      b"PNG1"
    );
  }

  /// 库根笔记 ⇒ 相对路径不带目录；stem 里的路径分隔符被剥掉（不能借此写到库外）。
  #[test]
  fn import_attachment_sanitizes_stem_and_handles_root_note() {
    let d = tmpdir("attach-stem");
    let vault = d.join("vault");
    fs::create_dir_all(&vault).unwrap();
    fs::write(vault.join("a.md"), "x").unwrap();
    let src = d.join("picked.PNG");
    fs::write(&src, b"x").unwrap();
    let v = vault.to_string_lossy().to_string();
    let s = src.to_string_lossy().to_string();
    let rel = import_attachment(v, "a.md".into(), s, "../../evil".into()).unwrap();
    // 扩展名统一小写；文件仍落在库根
    assert_eq!(rel, "evil.png");
    assert!(vault.join("evil.png").is_file());
  }

  /// 附件：普通文件（pdf 等）允许复制；中文 stem 保留；可执行扩展名拒绝（rev173.3）。
  #[test]
  fn import_attachment_allows_plain_files_and_keeps_chinese_stem() {
    let d = tmpdir("attach-any");
    let vault = d.join("vault");
    fs::create_dir_all(&vault).unwrap();
    fs::write(vault.join("a.md"), "x").unwrap();
    let src = d.join("报告.pdf");
    fs::write(&src, b"%PDF-1.4").unwrap();
    let v = vault.to_string_lossy().to_string();
    let rel = import_attachment(
      v.clone(),
      "a.md".into(),
      src.to_string_lossy().to_string(),
      "报告 终版".into(),
    )
    .unwrap();
    assert_eq!(rel, "报告-终版.pdf", "中文留在文件名里，空格转 -");
    assert!(vault.join("报告-终版.pdf").is_file());

    let bat = d.join("tool.bat");
    fs::write(&bat, b"echo hi").unwrap();
    assert!(
      import_attachment(
        v,
        "a.md".into(),
        bat.to_string_lossy().to_string(),
        "tool".into()
      )
      .is_err(),
      "可执行 / 脚本文件必须拒绝"
    );
  }

  /// 可执行扩展名 / 源不存在 / 越界笔记路径 ⇒ 明确报错（不能静默复制一个 .exe 进来）。
  #[test]
  fn import_attachment_rejects_executable_and_missing_src() {
    let d = tmpdir("attach-bad");
    let vault = d.join("vault");
    fs::create_dir_all(&vault).unwrap();
    fs::write(vault.join("a.md"), "x").unwrap();
    let exe = d.join("tool.exe");
    fs::write(&exe, b"MZ").unwrap();
    let png = d.join("ok.png");
    fs::write(&png, b"x").unwrap();
    let v = vault.to_string_lossy().to_string();
    let exe_s = exe.to_string_lossy().to_string();
    let png_s = png.to_string_lossy().to_string();

    assert!(import_attachment(v.clone(), "a.md".into(), exe_s, "image".into()).is_err());
    let missing = d.join("nope.png").to_string_lossy().to_string();
    assert!(import_attachment(v.clone(), "a.md".into(), missing, "image".into()).is_err());
    // 越界 note_path 也拒绝（复用 resolve）
    assert!(import_attachment(v, "../evil.md".into(), png_s, "image".into()).is_err());
  }
}
