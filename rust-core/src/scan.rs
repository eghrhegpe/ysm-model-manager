use crate::{policy::normalize_ext, ModelEntry, ScanError, ScanPolicy, ScanReport};
use jwalk::{rayon::prelude::*, WalkDir};
use std::{
    fs,
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

/// Compatibility scan matching the existing Go scanner contract.
/// Directories ending in `.ban` or `.disabled` (case-insensitive) are not descended into —
/// mirrors Go `scanner.ScanEntries` (`types.IsDisableSuffix` → SkipDir).
pub fn scan_fast(root: impl AsRef<Path>, policy: &ScanPolicy) -> ScanReport {
    scan_impl(root.as_ref(), policy, false)
}

/// Stateful-index scan used by the new desktop shell.
///
/// Unlike [`scan_fast`], this intentionally descends into `.ban` and `.disabled` directories
/// (both are ADR-038 D3.7 disable suffixes) so disabled directory-based models remain
/// discoverable and can be re-enabled after a restart. This is a **deliberate divergence**
/// from Go `scanner.ScanEntries` (which always skips them) — see rustbridge.md contract table.
///
/// **命名含 `_no_hash` 后缀**：本函数不补哈希（类似 `scan_fast`），调用方需自行调
/// `hydrate_hashes` 后再使用 `entry.hash` 字段。若未来新增补哈希版本，此处改为 `_no_hash`
/// 前缀而非函数体重构——避免调用方误以为 hash 已填。
///
/// **预留接口**：当前无生产消费方（rust-wails-bridge 的两个生产入口均走 `scan_fast` 或
/// `scan_impl_manifest`，不下钻禁用目录）。本函数仅被 `tests.rs` 引用。若未来「新桌面壳列出
/// 并再启用禁用模型」立项，此处可直接复用；在此之前视为孤儿代码，行为变更需经代码评审。
pub fn scan_index(root: impl AsRef<Path>, policy: &ScanPolicy) -> ScanReport {
    scan_impl(root.as_ref(), policy, true)
}

fn scan_impl(root: &Path, policy: &ScanPolicy, include_banned_dirs: bool) -> ScanReport {
    let root = root.to_path_buf();
    if root.as_os_str().is_empty() {
        return ScanReport::default();
    }

    let mut errors = Vec::new();
    let mut candidates = Vec::new();
    let walk = WalkDir::new(&root).process_read_dir(move |_, _, _, children| {
        for child in children.iter_mut().filter_map(|r| r.as_mut().ok()) {
            if child.file_type.is_dir()
                && should_skip_dir_name(&child.file_name.to_string_lossy(), include_banned_dirs)
            {
                child.read_children = None;
            }
        }
    });

    for result in walk {
        match result {
            Ok(entry) => {
                if entry.depth() == 0 || entry.file_type().is_dir() {
                    continue;
                }
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().into_owned();
                let restored = strip_disable_suffix(&name);
                let ext = extension_of(restored);
                if ext.is_empty() || !policy.supports_ext(&ext) {
                    continue;
                }
                if ext == ".json" && !is_model_json_name(restored) {
                    continue;
                }
                // Go scanner 契约（go/scanner/scanner.go L345-348）：ysm.json 条目重命名为
                // 父目录名（UI/同步层对文件夹式模型显示目录名）——Rust 路径必须对齐，
                // 否则 Windows 生产构建（rust_backend）同一目录产出不同 ModelEntry.Name（code review P2）
                let display_name = if restored.eq_ignore_ascii_case("ysm.json") {
                    path.parent()
                        .and_then(|p| p.file_name())
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or(name.clone())
                } else {
                    name
                };
                let subdir = first_relative_component(&root, &path)
                    .filter(|name| policy.is_mmd_subdir(name))
                    .unwrap_or_default();
                let rtype = policy.rtype_for_ext(&ext).to_string();
                candidates.push(Candidate {
                    name: display_name,
                    path,
                    ext,
                    subdir,
                    rtype,
                });
            }
            Err(err) => errors.push(ScanError {
                path: err.path().unwrap_or(root.as_path()).to_path_buf(),
                message: err.to_string(),
            }),
        }
    }

    let resolved: Vec<Result<ModelEntry, ScanError>> =
        candidates.into_par_iter().map(resolve_metadata).collect();
    let mut entries = Vec::with_capacity(resolved.len());
    for item in resolved {
        match item {
            Ok(entry) => entries.push(entry),
            Err(err) => errors.push(err),
        }
    }
    ScanReport { entries, errors }
}

#[derive(Debug, Clone)]
pub struct Candidate {
    pub name: String,
    pub path: PathBuf,
    pub ext: String,
    pub subdir: String,
    pub rtype: String,
}

/// Manifest-driven scan: skip filesystem discovery (jwalk) entirely and resolve metadata
/// for a pre-enumerated candidate list supplied by the Go scanner (which already walked the
/// tree and classified entries). Used by the `ysm_scan_manifest` ABI to avoid duplicating
/// Go's discovery work — see ADR-120.
///
/// Candidates whose ext is not supported by `policy` are dropped (caller must filter, but we
/// guard here too so a stale manifest cannot inject unsupported entries).
///
/// NOTE: `Candidate.rtype` is **not derived here** — it is trusted from the caller-supplied
/// `Candidate.rtype` field. Unlike `scan_impl` (which calls `policy.rtype_for_ext`), the manifest
/// path assumes the Go scanner has already resolved the correct type. This is intentional: the
/// legacy bridge (`response.rs`) flattens `subdir`/`type` out of the serialized output, so the
/// rtype drift between the two paths is currently invisible across the ABI. If a future caller
/// needs `ModelEntry.rtype` populated from the manifest path, derive it here via
/// `policy.rtype_for_ext` (code review P3).
///
/// The `.json` allowlist is also enforced here (mirroring `scan_impl` L57) so a stale manifest
/// cannot inject e.g. `animation.json` as an independent entry — `supports_ext` alone permits
/// any `.json`, but only `ysm.json` is a valid model entry (ADR-038 D2).
///
/// The allowlist is checked against the **on-disk file name** (path base), not `c.name` —
/// `c.name` is the display name and is rewritten to the parent directory name for `ysm.json`
/// entries (see `scan_impl` L63-70), which would wrongly fail the allowlist.
pub fn scan_impl_manifest(mut candidates: Vec<Candidate>, policy: &ScanPolicy) -> ScanReport {
    candidates.retain(|c| {
        if c.ext.is_empty() || !policy.supports_ext(&c.ext) {
            return false;
        }
        if c.ext.eq_ignore_ascii_case(".json") {
            // 对称 scan_impl L52-57：先 strip disable suffix 再查白名单，
            // 否则 ysm.json.disabled 被 jwalk 保留、被 manifest 路径丢弃（ADR-120 契约）
            let base = c
                .path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            let stripped = strip_disable_suffix(base);
            return is_model_json_name(stripped);
        }
        true
    });
    let resolved: Vec<Result<ModelEntry, ScanError>> =
        candidates.into_par_iter().map(resolve_metadata).collect();
    let mut entries = Vec::new();
    let mut errors = Vec::new();
    for item in resolved {
        match item {
            Ok(entry) => entries.push(entry),
            Err(err) => errors.push(err),
        }
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    errors.sort_by(|a, b| a.path.cmp(&b.path));
    ScanReport { entries, errors }
}

fn resolve_metadata(candidate: Candidate) -> Result<ModelEntry, ScanError> {
    let metadata = fs::metadata(&candidate.path).map_err(|err| ScanError {
        path: candidate.path.clone(),
        message: format!("metadata failed: {err}"),
    })?;
    Ok(ModelEntry {
        name: candidate.name,
        size: i64::try_from(metadata.len()).unwrap_or(i64::MAX),
        path: candidate.path,
        ext: candidate.ext,
        hash: String::new(),
        mod_time_ms: system_time_to_unix_ms(metadata.modified().unwrap_or(UNIX_EPOCH)),
        subdir: candidate.subdir,
        rtype: candidate.rtype,
    })
}

fn system_time_to_unix_ms(time: std::time::SystemTime) -> i64 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(duration) => i64::try_from(duration.as_millis()).unwrap_or(i64::MAX),
        Err(err) => -i64::try_from(err.duration().as_millis()).unwrap_or(i64::MAX),
    }
}

/// 剥离禁用后缀（`.ban` / `.disabled`，大小写不敏感）。
///
/// **顺序无关**：`.ban` 和 `.disabled` 互不为后缀（`.disabled` 不以 `.ban` 结尾，反之亦然），
/// 因此先判哪个都不影响最终剥离结果。此处 `.ban` 优先仅是实现选择，与 Go 端常量序
/// （`.disabled` 在前）不同但等价——parity fixture 锁定了两端输出逐字一致。
pub(crate) fn strip_disable_suffix(name: &str) -> &str {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".ban") {
        &name[..name.len() - 4]
    } else if lower.ends_with(".disabled") {
        &name[..name.len() - ".disabled".len()]
    } else {
        name
    }
}

/// `.json` 文件名白名单：仅 ysm.json（新格式声明）。
/// 对齐 Go 端 `types.IsYsmEntryJSON`（ADR-038 D2：.json 仅放行 ysm.json，
/// 包内 geometry/animation/语言 json 不得作为独立条目扫描）。
/// 旧格式几何（main/arm/arrow/info）是 Go 端 FileInventory.legacyModels 的
/// **分类**而非扫描条目门禁——此前把 legacy 白名单当条目门禁（code review P2）：
/// 无目录作用域，resourcepacks/shaderpacks/MMD 子目录里任何叫 info.json/
/// main.json 的文件都会误成 ysm 模型条目（rtype 解析为第一个声明 .json 的类型）。
pub(crate) fn is_model_json_name(name: &str) -> bool {
    // 对齐 Go types.IsYsmEntryJSON（ADR-038 D2 单点权威）：EqualFold(TrimSpace, "ysm.json")。
    // TrimSpace 是契约契约——Go scanner L359 用 NormalizeResourceName 后再走 IsYsmEntryJSON，
    // " ysm.json " 在 Go 放行；Rust 此前未 trim 会拒绝（静默漂移，parity fixture 已锁定）。
    name.trim().eq_ignore_ascii_case("ysm.json")
}

/// name 是否带禁用后缀（.disabled/.ban，大小写不敏感）——对齐 Go types.IsDisableSuffix。
/// 供 should_skip_dir_name 与契约测试共用；strip_disable_suffix 侧需识别具体后缀故自带判断
/// （.ban 优先，与 Go 的常量序相反，但两后缀互不为后缀，剥离结果一致——parity fixture 锁定）
pub(crate) fn is_disable_suffix(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".ban") || lower.ends_with(".disabled")
}

fn extension_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(normalize_ext)
        .unwrap_or_default()
}

fn should_skip_dir_name(name: &str, include_banned_dirs: bool) -> bool {
    name.eq_ignore_ascii_case(".recycle")
        || name == ".github"
        || (!include_banned_dirs && is_disable_suffix(name))
}

fn first_relative_component(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    relative.components().find_map(|component| match component {
        Component::Normal(name) => Some(name.to_string_lossy().into_owned()),
        _ => None,
    })
}
