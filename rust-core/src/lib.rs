mod hash;
mod model;
mod policy;
mod scan;

pub use hash::{hydrate_hashes, scan_eager, sha256_file};
pub use model::{ModelEntry, ScanError, ScanReport};
pub use policy::{ScanPolicy, DEFAULT_MAX_HASH_BYTES};
pub use scan::{scan_fast, scan_impl_manifest, Candidate};

#[cfg(test)]
mod tests;
