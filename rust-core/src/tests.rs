use super::*;
use super::scan::{is_disable_suffix, is_model_json_name, strip_disable_suffix};
use rust_test_utils::TempRoot;
use std::{
    fs,
    path::{Path, PathBuf},
    process,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

fn policy() -> ScanPolicy {
    ScanPolicy::from_registry_json(
        r#"{
      "resourceTypes": [
        {"id":"ysm","extensions":[".ysm",".json"],"hashable":true},
        {"id":"blueprint","extensions":[".nbt"],"hashable":true},
        {"id":"other","extensions":[".zip"],"hashable":false}
      ]
    }"#,
    )
    .unwrap()
}

#[test]
fn registry_drives_supported_and_hashable_extensions() {
    let policy = policy();
    assert!(policy.supports_ext(".ysm"));
    assert!(policy.supports_ext("ZIP"));
    assert!(policy.should_hash_ext(".ysm"));
    assert!(!policy.should_hash_ext(".zip"));
}

#[test]
fn scan_preserves_go_filter_contract() {
    let root = TempRoot::new("filters");
    fs::write(root.path().join("a.ysm"), b"data").unwrap();
    fs::write(root.path().join("b.txt"), b"x").unwrap();
    fs::write(root.path().join("c.ysm.ban"), b"x").unwrap();
    fs::write(root.path().join("anim.json"), b"{}").unwrap();
    fs::write(root.path().join("ysm.json"), b"{}").unwrap();
    // code review P2：legacy 白名单回退后，main/info 也不得作为扫描条目
    fs::write(root.path().join("main.json"), b"{}").unwrap();
    fs::write(root.path().join("info.json"), b"{}").unwrap();
    let recycle = root.path().join(".ReCyClE");
    fs::create_dir_all(&recycle).unwrap();
    fs::write(recycle.join("d.ysm"), b"x").unwrap();
    let github = root.path().join(".github");
    fs::create_dir_all(&github).unwrap();
    fs::write(github.join("ignored.ysm"), b"x").unwrap();
    let banned_dir = root.path().join("disabled-model.ban");
    fs::create_dir_all(&banned_dir).unwrap();
    fs::write(banned_dir.join("ignored.ysm"), b"x").unwrap();

    let report = scan_fast(root.path(), &policy());
    assert!(report.errors.is_empty(), "{:?}", report.errors);
    assert_eq!(report.entries.len(), 3);
    assert_eq!(
        report
            .entries
            .iter()
            .find(|e| e.name == "c.ysm.ban")
            .unwrap()
            .ext,
        ".ysm"
    );
    assert!(report.entries.iter().any(|e| e.name == "a.ysm"));
    // b7ef2815 引入的 rtype 字段：扫描条目应带类型（a.ysm → ysm）
    assert_eq!(
        report.entries.iter().find(|e| e.name == "a.ysm").unwrap().rtype,
        "ysm"
    );
    // Go 契约（code review P2）：ysm.json 条目重命名为父目录名（root 目录 basename）
    let root_name = root
        .path()
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    assert!(
        report.entries.iter().any(|e| e.name == root_name),
        "ysm.json 条目应重命名为父目录名 {}，实际 {:?}",
        root_name,
        report.entries.iter().map(|e| e.name.as_str()).collect::<Vec<_>>()
    );
    assert!(!report.entries.iter().any(|e| e.name == "anim.json"));
    assert!(!report.entries.iter().any(|e| e.name == "main.json")); // code review P2：legacy 非条目
    assert!(!report.entries.iter().any(|e| e.name == "info.json"));
    assert!(!report
        .entries
        .iter()
        .any(|e| e.path.starts_with(&banned_dir)));
}

#[test]
fn index_scan_discovers_banned_directories_without_changing_compat_scan() {
    let root = TempRoot::new("index-disabled");
    let banned_dir = root.path().join("ModelA.ban");
    fs::create_dir_all(&banned_dir).unwrap();
    fs::write(banned_dir.join("ysm.json"), b"{}").unwrap();
    assert!(scan_fast(root.path(), &policy()).entries.is_empty());
    let indexed = scan_index_no_hash(root.path(), &policy());
    assert!(indexed.errors.is_empty(), "{:?}", indexed.errors);
    assert_eq!(indexed.entries.len(), 1);
    assert!(indexed.entries[0].path.starts_with(&banned_dir));
}

#[test]
fn fast_scan_defers_hash_then_parallel_hydration_matches_sha256() {
    let root = TempRoot::new("hash");
    fs::write(root.path().join("hello.ysm"), b"hello").unwrap();
    let mut report = scan_fast(root.path(), &policy());
    assert_eq!(report.entries[0].hash, "");
    assert!(hydrate_hashes(&mut report.entries, &policy()).is_empty());
    assert_eq!(
        report.entries[0].hash,
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
}

#[test]
fn mmd_first_level_directory_is_preserved_for_grouping() {
    let root = TempRoot::new("mmd");
    let scene = root.path().join("SceneModel");
    fs::create_dir_all(&scene).unwrap();
    fs::write(scene.join("stage.nbt"), b"x").unwrap();
    let report = scan_fast(root.path(), &policy());
    assert_eq!(report.entries[0].subdir, "SceneModel");
}

#[test]
fn oversized_hashable_file_is_reported_without_hashing() {
    let root = TempRoot::new("limit");
    fs::write(root.path().join("large.ysm"), b"1234").unwrap();
    let mut policy = policy();
    policy.max_hash_bytes = 3;
    let mut report = scan_fast(root.path(), &policy);
    let errors = hydrate_hashes(&mut report.entries, &policy);
    assert_eq!(report.entries[0].hash, "");
    assert_eq!(errors.len(), 1);
}

#[test]
fn json_entry_gate_is_ysm_only() {
    // code review P2：legacy 白名单（main/arm/arrow/info）回退——仅 ysm.json 是扫描条目
    assert!(is_model_json_name("ysm.json"));
    assert!(is_model_json_name("YSM.JSON")); // 大小写不敏感（Go EqualFold 同口径）
    for name in [
        "main.json",
        "arm.json",
        "arrow.json",
        "info.json",
        "main.geo.json",
        "arm.geo.json",
        "anim.json",
        "foo.json",
    ] {
        assert!(
            !is_model_json_name(name),
            "{name} 不应是扫描条目（对齐 Go IsYsmEntryJSON）"
        );
    }
}

#[test]
fn rtype_first_declared_wins() {
    // 同一 ext 多类型时取 registry 声明序首个：.json → ysm（首个声明），.zip → other
    let policy = policy();
    assert_eq!(policy.rtype_for_ext(".json"), "ysm");
    assert_eq!(policy.rtype_for_ext(".zip"), "other");
    assert_eq!(policy.rtype_for_ext(".nbt"), "blueprint");
}

// ===== Rust-Go 边界契约测试（共享 fixture）=====
// 读 tests/parity/go-rust-predicates.json，与 Go go/types 端逐字对齐三个谓词。
// 单一权威 = Go（ADR-038 D2）；cargo test 的 cwd = crate 根，经 CARGO_MANIFEST_DIR 定址。
//
// 注：parity fixture 只锁三个纯谓词（strip_disable_suffix / is_ysm_entry_json / is_disable_suffix）。
// scan_fast vs scan_eager 的 hash 行为差异（fast 不补 hash、eager 补）是设计意图，
// 由 fast_scan_defers_hash_then_parallel_hydration_matches_sha256 单测锁——不在 parity 范围内。
const PARITY_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tests/parity/go-rust-predicates.json"
);

fn parity_json<'a>(doc: &'a serde_json::Value, key: &str) -> Vec<(&'a str, &'a str)> {
    doc[key]
        .as_array()
        .unwrap_or_else(|| panic!("fixture 缺 {key} 数组"))
        .iter()
        .map(|pair| {
            let a = pair[0].as_str().unwrap_or_default();
            let b = pair[1].as_str().unwrap_or_default();
            (a, b)
        })
        .collect()
}

#[test]
fn parity_strip_disable_suffix() {
    let doc: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(PARITY_FIXTURE).unwrap())
            .expect("parse parity fixture");
    for (input, expected) in parity_json(&doc, "strip_disable_suffix") {
        assert_eq!(
            strip_disable_suffix(input),
            expected,
            "strip_disable_suffix({input:?})"
        );
    }
}

#[test]
fn parity_is_model_json_name() {
    let doc: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(PARITY_FIXTURE).unwrap())
            .expect("parse parity fixture");
    for (input, want) in parity_json(&doc, "is_ysm_entry_json") {
        let expected = want == "true";
        assert_eq!(
            is_model_json_name(input),
            expected,
            "is_model_json_name({input:?})"
        );
    }
}

#[test]
fn parity_is_disable_suffix() {
    let doc: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(PARITY_FIXTURE).unwrap())
            .expect("parse parity fixture");
    for (input, want) in parity_json(&doc, "is_disable_suffix") {
        let expected = want == "true";
        assert_eq!(is_disable_suffix(input), expected, "is_disable_suffix({input:?})");
    }
}

#[test]
fn disabled_dir_skipped_in_fast_but_discovered_in_index() {
    // scan_fast 对齐 Go scanner（.disabled 目录整组 SkipDir，ADR-038 D3.7）；
    // scan_index_no_hash 故意下钻以保禁用目录模型可再启用（与 .ban 对称，见 scan.rs doc）。
    let root = TempRoot::new("disabled-dir");
    let dis_dir = root.path().join("ModelB.disabled");
    fs::create_dir_all(&dis_dir).unwrap();
    fs::write(dis_dir.join("ysm.json"), b"{}").unwrap();
    fs::write(dis_dir.join("extra.ysm"), b"x").unwrap();

    assert!(scan_fast(root.path(), &policy()).entries.is_empty());

    // index 模式整组下钻：ysm.json（重命名为父目录名）与 extra.ysm 都成为条目
    let indexed = scan_index_no_hash(root.path(), &policy());
    assert!(indexed.errors.is_empty(), "{:?}", indexed.errors);
    assert_eq!(indexed.entries.len(), 2);
    assert!(
        indexed.entries.iter().all(|e| e.path.starts_with(&dis_dir)),
        "index 模式应发现禁用目录内全部条目: {:?}",
        indexed.entries.iter().map(|e| &e.path).collect::<Vec<_>>()
    );
}
