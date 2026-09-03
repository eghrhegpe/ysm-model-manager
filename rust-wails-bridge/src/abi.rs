use crate::response::{scan_json, scan_json_manifest, ScanResponse};
use std::{panic::AssertUnwindSafe, ptr, slice, str};

/// Owned byte buffer returned across the C ABI.
#[repr(C)]
pub struct YsmBuffer {
    pub ptr: *mut u8,
    pub len: usize,
    pub cap: usize,
}

impl YsmBuffer {
    fn from_vec(mut bytes: Vec<u8>) -> Self {
        let buffer = Self {
            ptr: bytes.as_mut_ptr(),
            len: bytes.len(),
            cap: bytes.capacity(),
        };
        std::mem::forget(bytes);
        buffer
    }
}

fn input_utf8<'a>(ptr: *const u8, len: usize, label: &str) -> Result<&'a str, String> {
    if len == 0 {
        return Ok("");
    }
    if ptr.is_null() {
        return Err(format!("{label} pointer is null"));
    }
    // SAFETY: the ABI contract requires `ptr` to reference `len` readable bytes.
    let bytes = unsafe { slice::from_raw_parts(ptr, len) };
    str::from_utf8(bytes).map_err(|error| format!("{label} is not UTF-8: {error}"))
}

fn encode_response(response: ScanResponse) -> YsmBuffer {
    let bytes = serde_json::to_vec(&response).unwrap_or_else(|error| {
        format!(r#"{{"entries":[],"errors":[],"cacheable":false,"error":"response serialization failed: {error}"}}"#).into_bytes()
    });
    YsmBuffer::from_vec(bytes)
}

/// Scan one library root and return a UTF-8 JSON response through `out`.
///
/// # Safety
/// Non-empty input pointers must reference their declared readable byte ranges. `out` must point
/// to writable storage for one [`YsmBuffer`].
#[no_mangle]
pub unsafe extern "C" fn ysm_scan(
    root_ptr: *const u8,
    root_len: usize,
    registry_ptr: *const u8,
    registry_len: usize,
    out: *mut YsmBuffer,
) -> i32 {
    if out.is_null() {
        return -1;
    }
    let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
        let root = input_utf8(root_ptr, root_len, "root")?;
        let registry = input_utf8(registry_ptr, registry_len, "registry")?;
        Ok::<_, String>(scan_json(root, registry))
    }));
    let response = match result {
        Ok(Ok(response)) => response,
        Ok(Err(error)) => ScanResponse::fatal(error),
        Err(_) => ScanResponse::fatal("Rust scanner panicked"),
    };
    // encode_response 外层 catch_unwind 是**必须存在的安全网**：
    // DLL panic 越过 FFI 边界是 UB（Go/C 侧未定义行为），一旦 serialize 意外 panic，
    // 外层 catch_unwind 确保我们返回 fatal error 而非崩溃。
    // serde_json::to_vec 对当前 ScanResponse 结构几乎不可能 panic（无递归、无非序列化类型），
    // 但编译期约束（serde derive）无法阻止未来新增字段时引入 panic 路径——此保护防御的是
    // "未来有人往 ScanResponse 加非 Serialize 字段"的误操作，而非当前代码风险。
    let encoded = std::panic::catch_unwind(AssertUnwindSafe(|| encode_response(response)));
    let buffer = match encoded {
        Ok(buf) => buf,
        Err(_) => encode_response(ScanResponse::fatal("response serialization panicked")),
    };
    // SAFETY: null was rejected above and the caller owns writable output storage.
    unsafe { ptr::write(out, buffer) };
    0
}

/// Scan one library root using a pre-enumerated manifest supplied by the Go scanner,
/// skipping filesystem discovery. `manifest_ptr`/`manifest_len` carry a UTF-8 JSON array of
/// manifest entries. See ADR-120.
///
/// # Safety
/// Non-empty input pointers must reference their declared readable byte ranges. `out` must
/// point to writable storage for one [`YsmBuffer`].
#[no_mangle]
pub unsafe extern "C" fn ysm_scan_manifest(
    root_ptr: *const u8,
    root_len: usize,
    registry_ptr: *const u8,
    registry_len: usize,
    manifest_ptr: *const u8,
    manifest_len: usize,
    out: *mut YsmBuffer,
) -> i32 {
    if out.is_null() {
        return -1;
    }
    let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
        let root = input_utf8(root_ptr, root_len, "root")?;
        let registry = input_utf8(registry_ptr, registry_len, "registry")?;
        let manifest = input_utf8(manifest_ptr, manifest_len, "manifest")?;
        Ok::<_, String>(scan_json_manifest(root, registry, manifest))
    }));
    let response = match result {
        Ok(Ok(response)) => response,
        Ok(Err(error)) => ScanResponse::fatal(error),
        Err(_) => ScanResponse::fatal("Rust scanner panicked"),
    };
    // 同上：encode_response 包 catch_unwind，防止序列化 panic 穿透 C 边界。
    let encoded = std::panic::catch_unwind(AssertUnwindSafe(|| encode_response(response)));
    let buffer = match encoded {
        Ok(buf) => buf,
        Err(_) => encode_response(ScanResponse::fatal("response serialization panicked")),
    };
    // SAFETY: null was rejected above and the caller owns writable output storage.
    unsafe { ptr::write(out, buffer) };
    0
}

/// Release a buffer returned by [`ysm_scan`].
///
/// # Safety
/// The parts must be unchanged and released exactly once.
#[no_mangle]
pub unsafe extern "C" fn ysm_buffer_free(ptr: *mut u8, len: usize, cap: usize) {
    if ptr.is_null() {
        return;
    }
    // SAFETY: these parts came from `Vec<u8>` and ownership is transferred back once.
    unsafe {
        drop(Vec::from_raw_parts(ptr, len, cap));
    }
}
