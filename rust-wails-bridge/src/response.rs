use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use ysm_model_manager_core::{hydrate_hashes, scan_eager, scan_impl_manifest, Candidate, ModelEntry, ScanError, ScanPolicy};

#[derive(Serialize)]
pub(crate) struct ScanResponse {
    entries: Vec<CompatModelEntry>,
    errors: Vec<CompatScanError>,
    cacheable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl ScanResponse {
    pub(crate) fn fatal(message: impl Into<String>) -> Self {
        Self {
            entries: Vec::new(),
            errors: Vec::new(),
            cacheable: false,
            error: Some(message.into()),
        }
    }
}

#[derive(Serialize)]
struct CompatModelEntry {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Size")]
    size: i64,
    #[serde(rename = "Path")]
    path: String,
    #[serde(rename = "Ext")]
    ext: String,
    #[serde(rename = "Hash")]
    hash: String,
    #[serde(rename = "ModTime")]
    mod_time: i64,
    #[serde(rename = "HasTags")]
    has_tags: bool,
    // 注：v1.13 已 flatten Wails repository view，subdir 字段不再通过此 ABI 输出。
    // 保留字段定义但恒空（skip_serializing_if），避免未来在此结构体上扩展时遗漏清空。
    // 如需获取分组信息，请走 rust-core 内部 API（scan.rs first_relative_component）。
    #[serde(rename = "subdir", skip_serializing_if = "String::is_empty")]
    subdir: String,
    // 对齐 Go `types.ModelEntry.Type`（`json:"type,omitempty"`）。
    // eager 路径（scan_json）从 scan_fast 继承 rtype；manifest 路径（scan_json_manifest）
    // 使用 Go 传入的 type 字段（即 ManifestEntry.rtype）。两者均走 skip_serializing_if，
    // rtype 为空时省略该字段以保持 JSON 输出与当前 Go frontend 兼容。
    #[serde(rename = "type", skip_serializing_if = "String::is_empty")]
    r#type: String,
}

impl From<ModelEntry> for CompatModelEntry {
    fn from(entry: ModelEntry) -> Self {
        Self {
            name: entry.name,
            size: entry.size,
            path: entry.path.to_string_lossy().into_owned(),
            ext: entry.ext,
            hash: entry.hash,
            mod_time: entry.mod_time_ms,
            has_tags: false,
            // Upstream v1.13 flattened the Wails repository view. Keep richer grouping metadata
            // inside rust-core/rust-index, but do not reintroduce it through the legacy binding.
            subdir: String::new(),
            r#type: entry.rtype,
        }
    }
}

#[derive(Serialize)]
struct CompatScanError {
    path: String,
    message: String,
}

impl From<ScanError> for CompatScanError {
    fn from(error: ScanError) -> Self {
        Self {
            path: error.path.to_string_lossy().into_owned(),
            message: error.message,
        }
    }
}

pub(crate) fn scan_json(root: &str, registry_json: &str) -> ScanResponse {
    let policy = match ScanPolicy::from_registry_json(registry_json) {
        Ok(policy) => policy,
        Err(error) => return ScanResponse::fatal(format!("invalid resource registry: {error}")),
    };
    let root = PathBuf::from(root);
    match fs::metadata(&root) {
        Ok(metadata) if metadata.is_dir() => {}
        Ok(_) => return non_cacheable_error(&root, "scan root is not a directory"),
        Err(error) => {
            return non_cacheable_error(&root, format!("scan root is not readable: {error}"))
        }
    }
    let mut report = scan_eager(root, &policy);
    report.entries.sort_by(|a, b| a.path.cmp(&b.path));
    report.errors.sort_by(|a, b| a.path.cmp(&b.path));
    ScanResponse {
        entries: report.entries.into_iter().map(Into::into).collect(),
        errors: report.errors.into_iter().map(Into::into).collect(),
        cacheable: true,
        error: None,
    }
}

fn non_cacheable_error(path: &Path, message: impl Into<String>) -> ScanResponse {
    ScanResponse {
        entries: Vec::new(),
        errors: vec![CompatScanError {
            path: path.to_string_lossy().into_owned(),
            message: message.into(),
        }],
        cacheable: false,
        error: None,
    }
}

/// Manifest entry supplied by the Go scanner (ADR-120). Field names mirror Go
/// `types.ModelEntry` JSON keys (Path/Ext/Name/subdir/type) to avoid any re-classification on
/// the Rust side — we trust Go's discovery and only resolve filesystem metadata here.
#[derive(serde::Deserialize)]
struct ManifestEntry {
    #[serde(rename = "Path")]
    path: String,
    #[serde(rename = "Ext")]
    ext: String,
    #[serde(rename = "Name")]
    name: String,
    // subdir 不再通过此 ABI 输出（v1.13 flatten）；保留 ManifestEntry 字段仅用于
    // Candidate 构建（scan_impl_manifest 内部消费），不传播到 CompatModelEntry。
    #[serde(rename = "subdir", default)]
    _subdir: String,
    // 对齐 Go `types.ModelEntry.Type`（`json:"type,omitempty"`）。注意：当前 rust-core
    // `scan_impl_manifest` 不填 rtype（见 scan.rs 注释），故 manifest 路径产出的 ModelEntry.rtype
    // 恒为空——桥序列化 `type` 也为空。字段保留以覆盖完整契约（code review P3）。
    #[serde(rename = "type", default)]
    rtype: String,
}

/// Scan using a pre-enumerated manifest from the Go scanner, skipping filesystem discovery.
/// `manifest_json` is a JSON array of [`ManifestEntry`]; entries unsupported by `policy` are
/// dropped inside [`scan_impl_manifest`]. See ADR-120.
pub(crate) fn scan_json_manifest(
    root: &str,
    registry_json: &str,
    manifest_json: &str,
) -> ScanResponse {
    let policy = match ScanPolicy::from_registry_json(registry_json) {
        Ok(policy) => policy,
        Err(error) => return ScanResponse::fatal(format!("invalid resource registry: {error}")),
    };
    let root = PathBuf::from(root);
    match fs::metadata(&root) {
        Ok(metadata) if metadata.is_dir() => {}
        Ok(_) => return non_cacheable_error(&root, "scan root is not a directory"),
        Err(error) => {
            return non_cacheable_error(&root, format!("scan root is not readable: {error}"))
        }
    }
    let manifest: Vec<ManifestEntry> = match serde_json::from_str(manifest_json) {
        Ok(manifest) => manifest,
        Err(error) => return ScanResponse::fatal(format!("invalid manifest json: {error}")),
    };
    let candidates: Vec<Candidate> = manifest
        .into_iter()
        .map(|entry| {
            // 锚定 scan root：相对路径 join root，避免 fs::metadata 相对进程 CWD 解析
            let path = PathBuf::from(&entry.path);
            let anchored = if path.is_absolute() {
                path
            } else {
                root.join(path)
            };
            Candidate {
                name: entry.name,
                path: anchored,
                ext: entry.ext,
                subdir: entry._subdir,
                rtype: entry.rtype,
            }
        })
        .collect();
    let mut report = scan_impl_manifest(candidates, &policy);
    // 与 scan_eager（jwalk 路径）对称：补哈希，保证两种路径产出逐字段一致（ADR-120 契约）
    report.errors.extend(hydrate_hashes(&mut report.entries, &policy));
    report.errors.sort_by(|a, b| a.path.cmp(&b.path));
    ScanResponse {
        entries: report.entries.into_iter().map(Into::into).collect(),
        errors: report.errors.into_iter().map(Into::into).collect(),
        cacheable: true,
        error: None,
    }
}
