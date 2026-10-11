// ZeroNote 内核（Rust 侧）
//
// 对应 `docs\内核契约-v0.1.md` §1.1 —— fs 原语。
// 三条硬保证：
//   ① 所有写入原子（临时文件 + rename）
//   ② 只接受「库内相对路径」，拒绝目录穿越
//   ③ 删除进 `.zn/trash/`，不是物理删除
//
// 这里**只实现文件能力**，不认识任何具体功能（标签 / 同步 / AI 都不在这）。

use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// 库内私有目录：不进文件树、不进 git
const PRIVATE_DIR: &str = ".zn";

/// 遍历时跳过的目录名
const SKIP_DIRS: [&str; 4] = [".zn", ".git", "node_modules", ".obsidian"];

#[derive(Serialize)]
pub struct NoteMeta {
  /// 库内相对路径，统一用 `/`
  path: String,
  title: String,
  /// 毫秒时间戳
  mtime: u64,
  size: u64,
  frontmatter: serde_json::Value,
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
    let lower = name.to_lowercase();
    if !(lower.ends_with(".md") || lower.ends_with(".markdown")) {
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
    let text = fs::read_to_string(&path).unwrap_or_default();
    let rel = path
      .strip_prefix(root)
      .map_err(|e| e.to_string())?
      .to_string_lossy()
      .replace('\\', "/");
    let title = rel
      .rsplit('/')
      .next()
      .unwrap_or(&rel)
      .trim_end_matches(".markdown")
      .trim_end_matches(".md")
      .to_string();
    out.push(NoteMeta {
      path: rel,
      title,
      mtime,
      size: meta.len(),
      frontmatter: parse_frontmatter(&text),
    });
  }
  Ok(())
}

/// 原子写：同目录临时文件 → sync → rename 覆盖
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
      // Windows 的 rename 不覆盖已存在文件：内容已完整落盘，先删旧再改名
      let _ = fs::remove_file(abs);
      fs::rename(&tmp, abs).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("替换原文件失败：{e}")
      })
    }
  }
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
  let src = resolve(&vault, &from)?;
  let dst = resolve(&vault, &to)?;
  if dst.exists() {
    return Err(format!("目标已存在，不覆盖：{to}"));
  }
  if let Some(dir) = dst.parent() {
    fs::create_dir_all(dir).map_err(|e| format!("创建目录失败：{e}"))?;
  }
  fs::rename(&src, &dst).map_err(|e| format!("重命名失败：{e}"))
}

/// 删除 = 移入 `.zn/trash/<时间戳>--<原名>`（可恢复）
#[tauri::command]
fn delete_note(vault: String, path: String) -> Result<(), String> {
  let abs = resolve(&vault, &path)?;
  let trash = Path::new(&vault).join(PRIVATE_DIR).join("trash");
  fs::create_dir_all(&trash).map_err(|e| format!("创建回收站失败：{e}"))?;
  let stamp = std::time::SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_millis())
    .unwrap_or(0);
  let name = abs
    .file_name()
    .map(|s| s.to_string_lossy().to_string())
    .unwrap_or_else(|| "note.md".to_string());
  let dest = trash.join(format!("{stamp}--{name}"));
  fs::rename(&abs, &dest).map_err(|e| format!("移入回收站失败：{e}"))
}

#[tauri::command]
fn note_exists(vault: String, path: String) -> Result<bool, String> {
  Ok(resolve(&vault, &path)?.exists())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      list_notes,
      read_note,
      write_note,
      create_note,
      rename_note,
      delete_note,
      note_exists
    ])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}

/* ───────────── 测试（M1 的自动化证据）───────────── */

#[cfg(test)]
mod tests {
  use super::*;

  fn tmpdir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("zn-test-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
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

  #[test]
  fn list_skips_private_dirs_and_non_markdown() {
    let d = tmpdir("ls");
    let v = d.to_string_lossy().to_string();
    fs::write(d.join("a.md"), "# a").unwrap();
    fs::write(d.join("b.txt"), "b").unwrap();
    fs::create_dir_all(d.join("子目录")).unwrap();
    fs::write(d.join("子目录").join("c.md"), "# c").unwrap();
    fs::create_dir_all(d.join(".zn")).unwrap();
    fs::write(d.join(".zn").join("secret.md"), "# s").unwrap();

    let paths: Vec<String> = list_notes(v, None)
      .unwrap()
      .into_iter()
      .map(|m| m.path)
      .collect();
    assert!(paths.contains(&"a.md".to_string()));
    assert!(paths.contains(&"子目录/c.md".to_string()), "中文子目录要能递归：{paths:?}");
    assert!(!paths.iter().any(|p| p.contains(".zn")), ".zn 不能进文件树");
    assert!(!paths.iter().any(|p| p.ends_with(".txt")), "只收 markdown");
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
}
