use crate::{scan_fast, ModelEntry, ScanError, ScanPolicy, ScanReport};
use jwalk::rayon::prelude::*;
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{self, Read},
    path::Path,
};

pub fn hydrate_hashes(entries: &mut [ModelEntry], policy: &ScanPolicy) -> Vec<ScanError> {
    entries
        .par_iter_mut()
        .filter_map(|entry| {
            if !policy.should_hash_ext(&entry.ext) {
                return None;
            }
            // size < 0 守卫：与 Go scanner 语义对齐（Go i64 大小写负值表示异常），
            // Rust 端 fs::metadata.len() 返回 u64 永不负，故此处实际永不触发，仅作契约锁。
            if entry.size < 0 || entry.size as u64 > policy.max_hash_bytes {
                entry.hash.clear();
                return Some(ScanError {
                    path: entry.path.clone(),
                    message: format!(
                        "hash skipped: file is larger than {} bytes",
                        policy.max_hash_bytes
                    ),
                });
            }

            match sha256_file(&entry.path) {
                Ok(hash) => {
                    entry.hash = hash;
                    None
                }
                Err(err) => {
                    entry.hash.clear();
                    Some(ScanError {
                        path: entry.path.clone(),
                        message: format!("hash failed: {err}"),
                    })
                }
            }
        })
        .collect()
}

pub fn scan_eager(root: impl AsRef<Path>, policy: &ScanPolicy) -> ScanReport {
    let mut report = scan_fast(root, policy);
    report
        .errors
        .extend(hydrate_hashes(&mut report.entries, policy));
    report
}

pub fn sha256_file(path: impl AsRef<Path>) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 128 * 1024];

    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    let digest = hasher.finalize();
    let mut hex = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(&mut hex, "{byte:02x}");
    }
    Ok(hex)
}
