use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelEntry {
    pub name: String,
    pub size: i64,
    pub path: PathBuf,
    pub ext: String,
    pub hash: String,
    pub mod_time_ms: i64,
    // 注：v1.13 flatten Wails repository view 后，subdir 不再通过 ABI 输出。
    // 字段保留用于 rust-core 内部分组（scan.rs first_relative_component 计算），
    // 但 bridge 层（response.rs CompatModelEntry）恒空——如需恢复分组视图，
    // 需在 ABI 层面重新引入，而非靠此字段静默流通。
    pub subdir: String,
    /// Resource type id (e.g. "ysm" / "EntityPlayer"). Filled from ScanPolicy during scan
    /// so the frontend can read `entry.rtype` directly instead of reverse-looking-up the
    /// type from the file path.
    pub rtype: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanError {
    pub path: PathBuf,
    pub message: String,
}

#[derive(Debug, Default)]
pub struct ScanReport {
    pub entries: Vec<ModelEntry>,
    pub errors: Vec<ScanError>,
}
