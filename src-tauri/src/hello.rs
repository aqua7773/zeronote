//! Windows Hello（期 2c · rev173.169）—— KeyCredentialManager + 带窗口 interop
//!
//! **为什么必须用 interop**：`KeyCredential::RequestSignAsync` 在没有 HWND 的进程里会
//! **静默挂死**（rev173.167 PowerShell 实测 90 秒无返回）。带窗口的两个接口只在系统
//! winmd（`Windows.Security.winmd`）里，windows crate 0.62 **没有生成**，所以这里用
//! `define_interface!` 手写 vtable：
//!
//! - `IKeyCredentialManagerCreateWithWindowStatics`（`30b1b9c9-61ef-43e8-88ac-cc433b38d1a6`）
//!   → `RequestCreateForWindowAsync(HWND, name, option)`
//! - `IKeyCredentialWithWindow`（`050deb3b-b19c-4635-9df6-5650d66c62b1`）
//!   → `RequestSignForWindowAsync(HWND, buffer)`
//!
//! IID 与参数形态来自本机 `C:\Windows\System32\WinMetadata\Windows.Security.winmd` 的元数据
//! （2026-10-26 解析），不是猜的。
//!
//! **为什么是同步函数**：`IKeyCredentialWithWindow` 等 COM 接口不是 `Send`，而 Tauri 命令的
//! Future 必须是 `Send`。这里把等待关进同步函数（`futures::executor::block_on`），调用方用
//! `spawn_blocking` 隔离 —— Future 里只出现 `isize` 句柄和字符串。
//!
//! **安全边界**（方案 §8.5）：防拿到磁盘 / 云端的离线攻击与物理接近；**不防同用户下的恶意
//! 进程** —— 它也能发起签名请求，只是每次都要用户点确认。签名是 RSA-PKCS1 v1.5 + SHA256
//! （确定性）⇒ 同一 challenge 每次得到同一份签名 ⇒ HKDF 出同一把 KEK。

#![cfg(windows)]

use core::ffi::c_void;

use futures::executor::block_on;
use windows::core::{factory, HRESULT, HSTRING, IInspectable_Vtbl, Interface};
use windows::Security::Credentials::{
  KeyCredentialCreationOption, KeyCredentialManager, KeyCredentialOperationResult,
  KeyCredentialRetrievalResult, KeyCredentialStatus,
};
use windows::Storage::Streams::{DataReader, IBuffer};
use windows_future::IAsyncOperation;

windows::core::imp::define_interface!(
  IKeyCredentialManagerCreateWithWindowStatics,
  IKeyCredentialManagerCreateWithWindowStatics_Vtbl,
  0x30b1b9c9_61ef_43e8_88ac_cc433b38d1a6
);
impl windows::core::RuntimeType for IKeyCredentialManagerCreateWithWindowStatics {
  const SIGNATURE: windows::core::imp::ConstBuffer =
    windows::core::imp::ConstBuffer::for_interface::<Self>();
}

#[repr(C)]
#[doc(hidden)]
pub struct IKeyCredentialManagerCreateWithWindowStatics_Vtbl {
  pub base__: IInspectable_Vtbl,
  pub RequestCreateForWindowAsync: unsafe extern "system" fn(
    *mut c_void, // this
    *mut c_void, // HWND（值类型，ABI 上是指针宽度）
    *mut c_void, // HSTRING
    KeyCredentialCreationOption,
    *mut *mut c_void, // IAsyncOperation<KeyCredentialRetrievalResult>
  ) -> HRESULT,
}

windows::core::imp::define_interface!(
  IKeyCredentialWithWindow,
  IKeyCredentialWithWindow_Vtbl,
  0x050deb3b_b19c_4635_9df6_5650d66c62b1
);
impl windows::core::RuntimeType for IKeyCredentialWithWindow {
  const SIGNATURE: windows::core::imp::ConstBuffer =
    windows::core::imp::ConstBuffer::for_interface::<Self>();
}

#[repr(C)]
#[doc(hidden)]
pub struct IKeyCredentialWithWindow_Vtbl {
  pub base__: IInspectable_Vtbl,
  pub RequestSignForWindowAsync: unsafe extern "system" fn(
    *mut c_void, // this
    *mut c_void, // HWND
    *mut c_void, // IBuffer
    *mut *mut c_void, // IAsyncOperation<KeyCredentialOperationResult>
  ) -> HRESULT,
}

fn status_name(status: KeyCredentialStatus) -> &'static str {
  match status {
    KeyCredentialStatus::Success => "success",
    KeyCredentialStatus::UnknownError => "unknown_error",
    KeyCredentialStatus::NotFound => "not_found",
    KeyCredentialStatus::UserCanceled => "user_canceled",
    KeyCredentialStatus::UserPrefersPassword => "user_prefers_password",
    KeyCredentialStatus::CredentialAlreadyExists => "credential_already_exists",
    KeyCredentialStatus::SecurityDeviceLocked => "security_device_locked",
    _ => "unknown",
  }
}

fn wait<T: windows::core::RuntimeType>(op: IAsyncOperation<T>) -> Result<T, String> {
  block_on(async move { op.await }).map_err(|e| e.to_string())
}

/// 设备 / 用户是否能用 Windows Hello（PIN 或生物识别，同一套凭据）。
pub fn is_supported() -> Result<bool, String> {
  let op = KeyCredentialManager::IsSupportedAsync().map_err(|e| e.to_string())?;
  wait(op)
}

/// 建（或替换）一条 Hello 凭据，必须带窗口（否则挂死）。
pub fn enroll(hwnd: isize, account_id: &str) -> Result<(), String> {
  let hwnd = hwnd as *mut c_void;
  let interop: IKeyCredentialManagerCreateWithWindowStatics =
    factory::<KeyCredentialManager, IKeyCredentialManagerCreateWithWindowStatics>()
      .map_err(|e| e.to_string())?;
  let name = HSTRING::from(account_id);
  let mut raw: *mut c_void = std::ptr::null_mut();
  unsafe {
    let vtbl = Interface::vtable(&interop);
    (vtbl.RequestCreateForWindowAsync)(
      Interface::as_raw(&interop),
      hwnd,
      core::mem::transmute_copy(&name),
      KeyCredentialCreationOption::ReplaceExisting,
      &mut raw,
    )
    .ok()
    .map_err(|e| format!("创建 Hello 凭据失败：{e}"))?;
  }
  let op: IAsyncOperation<KeyCredentialRetrievalResult> =
    unsafe { windows::core::Type::from_abi(raw) }.map_err(|e| e.to_string())?;
  let result = wait(op).map_err(|e| format!("创建 Hello 凭据失败：{e}"))?;
  let status = result.Status().map_err(|e| e.to_string())?;
  if status != KeyCredentialStatus::Success {
    return Err(format!("创建 Hello 凭据：{}", status_name(status)));
  }
  Ok(())
}

/// 用 Hello 凭据签一段 challenge，必须带窗口（否则挂死）。
pub fn sign(hwnd: isize, account_id: &str, challenge: &[u8]) -> Result<Vec<u8>, String> {
  let hwnd = hwnd as *mut c_void;
  let name = HSTRING::from(account_id);

  let open = KeyCredentialManager::OpenAsync(&name).map_err(|e| e.to_string())?;
  let retrieved = wait(open).map_err(|e| format!("打开 Hello 凭据失败：{e}"))?;
  let status = retrieved.Status().map_err(|e| e.to_string())?;
  if status != KeyCredentialStatus::Success {
    return Err(format!("打开 Hello 凭据：{}", status_name(status)));
  }
  let credential = retrieved.Credential().map_err(|e| e.to_string())?;

  let interop: IKeyCredentialWithWindow = credential.cast().map_err(|e| e.to_string())?;
  let buffer = windows::Security::Cryptography::CryptographicBuffer::CreateFromByteArray(challenge)
    .map_err(|e| e.to_string())?;

  let mut raw: *mut c_void = std::ptr::null_mut();
  unsafe {
    let vtbl = Interface::vtable(&interop);
    (vtbl.RequestSignForWindowAsync)(
      Interface::as_raw(&interop),
      hwnd,
      buffer.as_raw(),
      &mut raw,
    )
    .ok()
    .map_err(|e| format!("Hello 签名失败：{e}"))?;
  }
  let op: IAsyncOperation<KeyCredentialOperationResult> =
    unsafe { windows::core::Type::from_abi(raw) }.map_err(|e| e.to_string())?;
  let result = wait(op).map_err(|e| format!("Hello 签名失败：{e}"))?;
  let status = result.Status().map_err(|e| e.to_string())?;
  if status != KeyCredentialStatus::Success {
    return Err(format!("Hello 签名：{}", status_name(status)));
  }
  let sig_buffer: IBuffer = result.Result().map_err(|e| e.to_string())?;
  buffer_to_vec(&sig_buffer)
}

fn buffer_to_vec(buffer: &IBuffer) -> Result<Vec<u8>, String> {
  let len = buffer.Length().map_err(|e| e.to_string())? as usize;
  let reader = DataReader::FromBuffer(buffer).map_err(|e| e.to_string())?;
  let mut out = vec![0u8; len];
  reader.ReadBytes(&mut out).map_err(|e| e.to_string())?;
  Ok(out)
}
