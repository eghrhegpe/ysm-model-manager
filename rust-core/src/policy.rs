use serde::Deserialize;
use std::{collections::HashMap, collections::HashSet, fs, io, path::Path};

pub const DEFAULT_MAX_HASH_BYTES: u64 = 500 * 1024 * 1024;

const MMD_SUBDIRS: &[&str] = &[
    "EntityPlayer",
    "SceneModel",
    "DefaultAnim",
    "CustomAnim",
    "StageAnim",
    "DefaultMorph",
    "CustomMorph",
    "shader",
];

#[derive(Debug, Clone)]
pub struct ScanPolicy {
    supported_exts: HashSet<String>,
    hash_exts: HashSet<String>,
    mmd_subdirs: HashSet<String>,
    pub max_hash_bytes: u64,
    /// 扩展名→rtype 映射（多对一）。扫描时按 ext 查 rtype，填 ModelEntry.rtype。
    /// 同一 ext 可能属于多个 rtype（如 .zip 属于 resourcepack/ysm/maid-model/...），
    /// 此时取 registry 声明序首个（优先级最高）——前端按目录上下文二次区分。
    ext_to_rtype: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct Registry {
    #[serde(rename = "resourceTypes")]
    resource_types: Vec<ResourceType>,
}

#[derive(Debug, Deserialize)]
struct ResourceType {
    id: String,
    #[serde(default)]
    extensions: Vec<String>,
    #[serde(default)]
    hashable: bool,
}

impl ScanPolicy {
    pub fn from_registry_json(input: &str) -> Result<Self, serde_json::Error> {
        let registry: Registry = serde_json::from_str(input)?;
        let mut supported_exts = HashSet::new();
        let mut hash_exts = HashSet::new();
        let mut ext_to_rtype = HashMap::new();

        for resource_type in registry.resource_types {
            let rtype = resource_type.id.clone();
            for ext in resource_type.extensions {
                let ext = normalize_ext(&ext);
                if ext.is_empty() {
                    continue;
                }
                supported_exts.insert(ext.clone());
                // 首次声明优先（registry 声明序 = 优先级序）
                ext_to_rtype.entry(ext.clone()).or_insert(rtype.clone());
                if resource_type.hashable {
                    hash_exts.insert(ext);
                }
            }
        }

        Ok(Self {
            supported_exts,
            hash_exts,
            mmd_subdirs: MMD_SUBDIRS.iter().map(|s| s.to_ascii_lowercase()).collect(),
            max_hash_bytes: DEFAULT_MAX_HASH_BYTES,
            ext_to_rtype,
        })
    }

    pub fn from_registry_path(path: impl AsRef<Path>) -> io::Result<Self> {
        let raw = fs::read_to_string(path)?;
        Self::from_registry_json(&raw)
            .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))
    }

    pub fn supports_ext(&self, ext: &str) -> bool {
        self.supported_exts.contains(&normalize_ext(ext))
    }

    pub fn should_hash_ext(&self, ext: &str) -> bool {
        self.hash_exts.contains(&normalize_ext(ext))
    }

    /// 按扩展名查资源类型 ID（如 ".ysm" → "ysm"）。未知扩展名返回空串。
    ///
    /// **生命周期**：返回值借用 `&self`（HashMap 内部数据），调用方不得将结果
    /// 存入持久结构；需持有 String 时调用 `.to_string()`。
    pub fn rtype_for_ext(&self, ext: &str) -> &str {
        self.ext_to_rtype
            .get(&normalize_ext(ext))
            .map(String::as_str)
            .unwrap_or("")
    }

    pub(crate) fn is_mmd_subdir(&self, name: &str) -> bool {
        self.mmd_subdirs.contains(&name.to_ascii_lowercase())
    }
}

pub(crate) fn normalize_ext(ext: &str) -> String {
    let trimmed = ext.trim().to_ascii_lowercase();
    if trimmed.is_empty() {
        return trimmed;
    }
    if trimmed.starts_with('.') {
        trimmed
    } else {
        format!(".{trimmed}")
    }
}
