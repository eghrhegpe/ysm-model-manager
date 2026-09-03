use super::*;
use crate::response::{scan_json, scan_json_manifest};
use serde_json::Value;
use std::{
    fs,
    path::PathBuf,
    process, ptr, slice,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

static NEXT_ID: AtomicU64 = AtomicU64::new(0);
struct TempRoot(PathBuf);

impl TempRoot {
    fn new() -> Self {
        let nonce = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "ysm-wails-bridge-{}-{stamp}-{nonce}",
            process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn registry() -> &'static str {
    r#"{"resourceTypes":[{"id":"ysm","extensions":[".ysm",".json"],"hashable":true}]}"#
}

#[test]
fn response_preserves_wails_model_entry_contract() {
    let root = TempRoot::new();
    fs::write(root.0.join("hero.ysm"), b"hero").unwrap();
    fs::write(root.0.join("animation.json"), b"{}").unwrap();
    let value = serde_json::to_value(scan_json(root.0.to_str().unwrap(), registry())).unwrap();
    let entry = &value["entries"].as_array().unwrap()[0];
    assert_eq!(entry["Name"], "hero.ysm");
    assert_eq!(entry["Size"], 4);
    assert_eq!(entry["Ext"], ".ysm");
    // Go types.ModelEntry 契约：ModTime = Unix 毫秒（Go 侧注释锁定单位），
    // 与当前时钟对拍 ±5s——只断言 >0 锁不住秒/毫秒漂移
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    let mod_time = entry["ModTime"].as_i64().unwrap();
    assert!(
        (mod_time - now_ms).abs() < 5_000,
        "ModTime {mod_time} 偏离当前毫秒时钟 {now_ms} 超过 5s（疑似秒/毫秒单位漂移）"
    );
    // Path 字段：绝对路径且指向该文件
    let path = entry["Path"].as_str().unwrap();
    assert!(
        std::path::Path::new(path).is_absolute() && path.ends_with("hero.ysm"),
        "Path 应为指向 hero.ysm 的绝对路径，实际 {path}"
    );
    assert_eq!(entry["HasTags"], false);
    assert_eq!(entry["Hash"].as_str().unwrap().len(), 64);
    assert!(entry.get("subdir").is_none());
}

#[test]
fn response_uses_parent_directory_name_for_ysm_json() {
    let root = TempRoot::new();
    let model_dir = root.0.join("official-winefox");
    fs::create_dir_all(&model_dir).unwrap();
    fs::write(model_dir.join("ysm.json"), b"{}").unwrap();

    let value = serde_json::to_value(scan_json(root.0.to_str().unwrap(), registry())).unwrap();
    let entries = value["entries"].as_array().unwrap();

    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["Name"], "official-winefox");
    assert_eq!(entries[0]["Size"], 2);
    assert!(entries[0]["ModTime"].as_i64().unwrap() > 0);
    assert_eq!(entries[0]["Hash"].as_str().unwrap().len(), 64);
}

#[test]
fn invalid_registry_is_fatal_without_panicking() {
    let value = serde_json::to_value(scan_json("C:/models", "not-json")).unwrap();
    assert_eq!(value["entries"], Value::Array(vec![]));
    assert!(value["error"]
        .as_str()
        .unwrap()
        .contains("invalid resource registry"));
}

#[test]
fn missing_root_reports_scan_error_and_stays_uncacheable() {
    // 锁定「合法 registry + 不可读 root」的行为：errors 数组承载错误（非顶层 error）、
    // entries 空、cacheable=false——Go rustbridge.Scan 据此透传，行为漂移即双端断裂
    let missing = std::env::temp_dir()
        .join(format!("ysm-missing-root-{}", std::process::id()))
        .join("no-such-dir");
    let value = serde_json::to_value(scan_json(missing.to_str().unwrap(), registry())).unwrap();
    assert_eq!(value["entries"], Value::Array(vec![]));
    assert!(value["error"].is_null());
    let err = &value["errors"].as_array().unwrap()[0];
    assert!(
        err["message"].as_str().unwrap().contains("not readable"),
        "应报 not readable，实际 {}",
        err["message"]
    );
    assert_eq!(value["cacheable"], false);
}

#[test]
fn file_root_is_reported_not_a_directory() {
    // root 是文件而非目录：独立于「不可读」的错误分支（fs::metadata Ok 但 !is_dir）
    let root = TempRoot::new();
    let file = root.0.join("plain-file.txt");
    fs::write(&file, b"x").unwrap();
    let value = serde_json::to_value(scan_json(file.to_str().unwrap(), registry())).unwrap();
    assert_eq!(value["entries"], Value::Array(vec![]));
    let err = &value["errors"].as_array().unwrap()[0];
    assert!(err["message"].as_str().unwrap().contains("not a directory"));
}

#[test]
fn c_abi_buffer_can_be_released() {
    let root = TempRoot::new();
    fs::write(root.0.join("hero.ysm"), b"hero").unwrap();
    let root_text = root.0.to_string_lossy();
    let mut buffer = YsmBuffer {
        ptr: ptr::null_mut(),
        len: 0,
        cap: 0,
    };
    let status = unsafe {
        ysm_scan(
            root_text.as_ptr(),
            root_text.len(),
            registry().as_ptr(),
            registry().len(),
            &mut buffer,
        )
    };
    assert_eq!(status, 0);
    let json = unsafe { slice::from_raw_parts(buffer.ptr, buffer.len) };
    let value: Value = serde_json::from_slice(json).unwrap();
    assert_eq!(value["entries"].as_array().unwrap().len(), 1);
    unsafe { ysm_buffer_free(buffer.ptr, buffer.len, buffer.cap) };
}

/// ADR-120 核心契约：manifest 路径（Go 预枚举）产出 == jwalk 路径（ysm_scan）产出。
/// 同一棵树，两种发现方式，最终 entries 必须逐字段一致（路径/大小/扩展名/哈希/ModTime）。
#[test]
fn manifest_scan_matches_jwalk_scan() {
    let root = TempRoot::new();
    fs::write(root.0.join("hero.ysm"), b"hero-content").unwrap();
    let model_dir = root.0.join("official-winefox");
    fs::create_dir_all(&model_dir).unwrap();
    fs::write(model_dir.join("ysm.json"), b"{}").unwrap();
    // 注意：registry 仅放行 .ysm + ysm.json（is_model_json_name 白名单），
    // animation.json 等非 ysm.json 的 .json 被 jwalk 过滤——manifest 必须与此口径一致。

    let root_text = root.0.to_string_lossy();
    let registry_text = registry();
    // Windows 路径反斜杠需转义为 JSON 合法字符串；用正斜杠等价（PathBuf 接受）
    let hero_path = root.0.join("hero.ysm").to_string_lossy().replace('\\', "/");
    let ysmjson_path = model_dir.join("ysm.json").to_string_lossy().replace('\\', "/");

    // jwalk 基准
    let jwalk = serde_json::to_value(scan_json(&root_text, registry_text)).unwrap();
    let jwalk_entries = jwalk["entries"].as_array().unwrap();
    assert_eq!(jwalk_entries.len(), 2, "jwalk 应产出 2 条（hero.ysm / ysm.json 目录）");

    // manifest：仅列 jwalk 真会产出的 2 条（路径绝对、ext/name/subdir/type 对齐 Go ModelEntry）
    // 注意字段名用 "type"（对齐 Go `json:"type,omitempty"`），不再用旧 "rtype"（已被 serde 丢弃）
    let manifest = format!(
        r#"[
            {{"Path":"{}","Ext":".ysm","Name":"hero.ysm","subdir":"","type":"ysm"}},
            {{"Path":"{}","Ext":".json","Name":"official-winefox","subdir":"","type":"ysm"}}
        ]"#,
        hero_path, ysmjson_path,
    );

    let manifest_value =
        serde_json::to_value(scan_json_manifest(&root_text, registry_text, &manifest)).unwrap();
    let manifest_entries = manifest_value["entries"].as_array().unwrap();
    assert_eq!(manifest_entries.len(), 2, "manifest 应产出 2 条");

    // 按 Path 排序后逐字段比对
    let sort_by_path = |v: &Value| -> Vec<Value> {
        let mut arr: Vec<Value> = v["entries"].as_array().unwrap().clone();
        arr.sort_by(|a, b| a["Path"].as_str().cmp(&b["Path"].as_str()));
        arr
    };
    let jwalk_sorted = sort_by_path(&jwalk);
    let manifest_sorted = sort_by_path(&manifest_value);

    for (j, m) in jwalk_sorted.iter().zip(manifest_sorted.iter()) {
        // Windows 路径分隔符：jwalk 产出反斜杠，manifest 输入正斜杠，归一化后比对
        let j_path = j["Path"].as_str().unwrap().replace('\\', "/");
        let m_path = m["Path"].as_str().unwrap().replace('\\', "/");
        assert_eq!(j_path, m_path, "Path 必须一致（分隔符归一化）");
        assert_eq!(j["Ext"], m["Ext"], "Ext 必须一致");
        assert_eq!(j["Name"], m["Name"], "Name 必须一致");
        assert_eq!(j["Size"], m["Size"], "Size 必须一致");
        assert_eq!(j["Hash"], m["Hash"], "Hash 必须一致（同一文件 sha256）");
        assert_eq!(j["ModTime"], m["ModTime"], "ModTime 必须一致");
    }
    assert_eq!(manifest_value["cacheable"], true);
}

/// manifest 含 policy 不支持的 ext → 被 scan_impl_manifest 丢弃，不产生条目（不 panic）。
#[test]
fn manifest_drops_unsupported_ext() {
    let root = TempRoot::new();
    fs::write(root.0.join("note.txt"), b"x").unwrap();
    let note_path = root.0.join("note.txt").to_string_lossy().replace('\\', "/");
    let manifest = format!(
        r#"[{{"Path":"{}","Ext":".txt","Name":"note.txt","subdir":"","type":"ysm"}}]"#,
        note_path,
    );
    let value = serde_json::to_value(scan_json_manifest(
        &root.0.to_string_lossy(),
        registry(),
        &manifest,
    ))
    .unwrap();
    assert_eq!(value["entries"].as_array().unwrap().len(), 0);
    assert_eq!(value["cacheable"], true);
}

/// 无效 manifest JSON → fatal，不 panic（ABI 安全网）。用存在的 root 排除 not-readable 分支。
#[test]
fn invalid_manifest_is_fatal() {
    let root = TempRoot::new();
    let value = serde_json::to_value(scan_json_manifest(
        &root.0.to_string_lossy(),
        registry(),
        "not-json",
    ))
    .unwrap();
    assert_eq!(value["entries"], Value::Array(vec![]));
    assert!(value["error"]
        .as_str()
        .unwrap()
        .contains("invalid manifest json"));
}
