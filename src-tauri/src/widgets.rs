//! 安卓桌面组件的数据通道（需求 §15 · rev173.242 起）
//!
//! ## 为什么要有这一层
//!
//! 桌面组件（`AppWidgetProvider`）跑在 Launcher 的进程语义里，**碰不到运行中的 WebView**
//! —— 没有 IPC、没有 JS、没有内存态。它唯一能依赖的东西是「磁盘上的一份快照」。
//!
//! 所以数据流是单向的：
//!
//! ```text
//!   WebView（内核）──算好 JSON──▶ <app_data_dir>/.zn/widget-data.json ◀──读── AppWidgetProvider
//! ```
//!
//! 「算」留在前端（`src/kernel/widget-data.ts`）：打卡的应打卡日判定本来就在 JS 里
//! （`examples/habit/index.js` 的 `isDueDay`），同一门语言才能与插件逻辑逐行对照；
//! Rust 这边只负责**把字节可靠地落到磁盘**，不掺业务判断。
//!
//! ## 落点为什么是 `app_data_dir/.zn/`
//!
//! 与全局插件根（`appDataDir()/.zn/plugins/`）同一个目录，Kotlin 侧用
//! `context.dataDir` 就能拿到同一路径（Android 上两者都是 `/data/user/0/<pkg>`），
//! 不需要在两端各存一份「应用数据目录在哪」的配置。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// 快照文件名（`<app_data_dir>/.zn/widget-data.json`）
const WIDGET_DATA_FILE: &str = "widget-data.json";
/// 私有目录名（与 lib.rs 的 `PRIVATE_DIR` 一致）
const PRIVATE_DIR: &str = ".zn";

/// 快照的落点。`root` = 应用数据目录（Android 上是 `/data/user/0/<pkg>`）。
///
/// 抽成纯函数是为了单测：命令里传 `app_data_dir()`，测试里传临时目录。
fn widget_data_path(root: &Path) -> PathBuf {
  root.join(PRIVATE_DIR).join(WIDGET_DATA_FILE)
}

/// 写快照（原子替换：先写 `.zn/widget-data.json.tmp` 再 rename）。
///
/// 为什么必须原子：组件可能正在**读**这个文件（Launcher 刷新与前端保存是两个进程），
/// 直接 `fs::write` 会留下「读到半截 JSON」的窗口 —— 组件侧只能整份当坏数据，
/// 表现为「桌面组件突然空白」，而且不可复现。
fn write_widget_data(root: &Path, json: &str) -> Result<PathBuf, String> {
  let target = widget_data_path(root);
  if let Some(dir) = target.parent() {
    fs::create_dir_all(dir).map_err(|e| format!("建目录失败 {}：{e}", dir.display()))?;
  }
  let tmp = target.with_extension("json.tmp");
  {
    let mut f = fs::File::create(&tmp).map_err(|e| format!("写临时文件失败 {}：{e}", tmp.display()))?;
    f.write_all(json.as_bytes())
      .map_err(|e| format!("写临时文件失败 {}：{e}", tmp.display()))?;
    // 落盘再 rename：断电 / 进程被杀时不会留下「tmp 有内容、目标没更新」的半截状态
    f.sync_all()
      .map_err(|e| format!("落盘失败 {}：{e}", tmp.display()))?;
  }
  fs::rename(&tmp, &target).map_err(|e| {
    // rename 失败时清掉 tmp，别在磁盘上留垃圾（下次会重新建）
    let _ = fs::remove_file(&tmp);
    format!("替换快照失败 {}：{e}", target.display())
  })?;
  Ok(target)
}

/// 写桌面组件快照。`data` 是前端算好的 JSON 文本（原样落盘，Rust 不看内容）。
///
/// 返回值 = 实际写入的绝对路径（前端可以在调试面板里核对落点）。
#[tauri::command]
pub fn widget_data_write(app: tauri::AppHandle, data: String) -> Result<String, String> {
  use tauri::Manager;
  let root = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("拿不到应用数据目录：{e}"))?;
  let path = write_widget_data(&root, &data)?;
  Ok(path.display().to_string())
}

/// 「今日打卡」组件写脏标记的文件名（Kotlin `HabitStore.DIRTY_FILE` 必须一致）。
const HABIT_DIRTY_FILE: &str = "widget-habit-dirty";

/// 消费打卡组件的 dirty 标记：**存在 ⇒ 删掉并返回 true**。
///
/// 为什么需要它（需求 §15.2「点击某个计划，直接完成一次打卡」）：
/// 桌面组件在 Launcher 进程里直接把 `habit` 插件的 `store.json` 改了，
/// 而插件在 WebView 里持有的是**加载时的内存态**。用户切回 App 时若插件还活着，
/// 它不知道磁盘已经变了（下次保存还会把旧数据写回去）。前端在「回到前台」
/// 时调用这里 —— true 就 `reloadPlugin('habit')`，重载即从磁盘重读。
///
/// 语义是「取走」而不是「读」：同一笔脏数据只需要重载一次，留着会让每次回前台都白重载。
#[tauri::command]
pub fn widget_take_habit_dirty(app: tauri::AppHandle) -> Result<bool, String> {
  use tauri::Manager;
  let root = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("拿不到应用数据目录：{e}"))?;
  take_dirty_marker(&root.join(PRIVATE_DIR), HABIT_DIRTY_FILE)
}

/// 取走标记（抽成纯函数便于单测）：不存在 ⇒ false；删失败也返回 false（下次再试）。
fn take_dirty_marker(private_dir: &Path, name: &str) -> Result<bool, String> {
  let path = private_dir.join(name);
  if !path.exists() {
    return Ok(false);
  }
  fs::remove_file(&path).map_err(|e| format!("清理脏标记失败 {}：{e}", path.display()))?;
  Ok(true)
}

#[cfg(test)]
mod tests {
  use super::*;

  /// 每个用例一个独立临时目录（`_tmp-test/` 是仓库约定，见 CARD「Rust 测试临时目录」）
  fn tmp_root(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("zn-widget-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[test]
  fn writes_under_private_dir() {
    let root = tmp_root("under-private");
    let path = write_widget_data(&root, r#"{"vault":"/x"}"#).unwrap();
    assert_eq!(path, root.join(".zn").join("widget-data.json"));
    assert_eq!(fs::read_to_string(&path).unwrap(), r#"{"vault":"/x"}"#);
    let _ = fs::remove_dir_all(&root);
  }

  /// 第二次写必须是**替换**（不留 tmp、不追加），且旧内容不残留
  #[test]
  fn overwrite_is_atomic_and_clean() {
    let root = tmp_root("overwrite");
    write_widget_data(&root, r#"{"a":1}"#).unwrap();
    let path = write_widget_data(&root, r#"{"a":2,"b":[1,2]}"#).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), r#"{"a":2,"b":[1,2]}"#);
    assert!(!root.join(".zn").join("widget-data.json.tmp").exists(), "tmp 应被 rename 掉");
    let _ = fs::remove_dir_all(&root);
  }

  /// `.zn` 不存在时要自己建（首次装完就点组件的最常见路径）
  #[test]
  fn creates_private_dir_when_missing() {
    let root = tmp_root("mkdir");
    assert!(!root.join(".zn").exists());
    write_widget_data(&root, "{}").unwrap();
    assert!(root.join(".zn").is_dir());
    let _ = fs::remove_dir_all(&root);
  }

  /// 中文 / 换行原样落盘（UTF-8 不转义 —— 组件侧直接按 UTF-8 读）
  #[test]
  fn keeps_utf8_verbatim() {
    let root = tmp_root("utf8");
    let json = r#"{"title":"晨间笔记\n第二行"}"#;
    let path = write_widget_data(&root, json).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), json);
    let _ = fs::remove_dir_all(&root);
  }

  /// 脏标记是「取走」语义：第一次 true、第二次 false、文件不在了
  #[test]
  fn dirty_marker_is_taken_once() {
    let root = tmp_root("dirty");
    let dir = root.join(".zn");
    fs::create_dir_all(&dir).unwrap();
    assert!(!take_dirty_marker(&dir, HABIT_DIRTY_FILE).unwrap(), "没有标记时返回 false");
    fs::write(dir.join(HABIT_DIRTY_FILE), "1700000000000").unwrap();
    assert!(take_dirty_marker(&dir, HABIT_DIRTY_FILE).unwrap(), "有标记时返回 true");
    assert!(!dir.join(HABIT_DIRTY_FILE).exists(), "取走后必须删掉");
    assert!(!take_dirty_marker(&dir, HABIT_DIRTY_FILE).unwrap(), "第二次返回 false");
    let _ = fs::remove_dir_all(&root);
  }
}
