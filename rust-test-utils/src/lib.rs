//! 共享测试基础设施——跨 crate 复用的 test helper。
//!
//! 当前仅包含 `TempRoot`：跨平台 temp 目录隔离的测试根目录，带自动 Drop 清理。
//! 未来若其他 crate 有重复测试工具（fixture helpers、mock 构造器等）可继续扩充。

use std::{
    fs,
    path::{Path, PathBuf},
    process,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

/// 唯一 ID 计数器，保证同名 TempRoot 在不同测试实例间路径不冲突。
static NEXT_ID: AtomicU64 = AtomicU64::new(0);

/// 测试用临时根目录：在 `std::env::temp_dir()` 下创建唯一子目录，Drop 时自动清理。
///
/// # 清理失败处理
/// CI 环境下 temp 目录清理失败（如 Windows 进程未释放句柄）会导致后续测试因目录存在而失败。
/// 本实现清理失败时 `eprintln!` 输出警告——足够让 CI 日志可见，又不阻塞测试继续运行
/// （nonce 唯一保证下次运行不会撞名）。
#[derive(Debug)]
pub struct TempRoot(pub PathBuf);

impl TempRoot {
    /// 创建带 `label` 前缀的唯一 temp 目录。
    ///
    /// `label` 用于在 temp 目录下区分不同用途的根（如 `"filter"` / `"hash"` / `"mmd"`），
    /// 便于排查清理失败时定位是哪个测试遗留。
    pub fn new(label: &str) -> Self {
        let nonce = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "ysm-test-{label}-{}-{timestamp}-{nonce}",
            process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    /// 便捷方法：使用 `"test"` 作为 label，供不需要区分用途的测试调用。
    pub fn test() -> Self {
        Self::new("test")
    }

    /// 获取路径引用。
    pub fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        if fs::remove_dir_all(&self.0).is_err() {
            eprintln!("[test] warn: failed to clean up TempRoot {:?}", self.0);
        }
    }
}
