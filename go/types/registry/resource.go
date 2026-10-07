// resource.go：registry 类型定义与加载入口（原 resource.go 拆分，2026-10 文件行数治理）。
// 2026-10 拆分：原 694 行按职责分为 resource.go（本文件：类型 + LoadRegistry + 校验调用序列）/
// resource_guard.go（guard* 不变量校验）/ resource_lookup.go（类型查找与元信息读取）。
package registry

import (
	"encoding/json"
	"log"
	"path/filepath"
	"strings"
	"sync"
)

// bundledRegistryJSON 是编译期内嵌的 resource_types.json（单一事实来源）。
// 由根包 main 在 init() 中经 embed.go 读取并注入（registry.SetBundledRegistryJSON），
// 与 internal/app 共用同一份 root embed，彻底取代旧的手工副本 resource_types_embed.go
// （曾因不同步导致分类被回退弹平）。测试/未注入场景下由 loadRegistryBytes 回退读取仓库根 resource_types.json。
var bundledRegistryJSON []byte

// SetBundledRegistryJSON 由根包 main 注入编译期内嵌的注册表字节（单源：仓库根 resource_types.json）。
// 加锁保护：与 SetRegistryPath 同源（写 bundledRegistryJSON 与并发 LoadRegistry 读存在数据竞争，
// ADR-202 刀1——包内 t.Parallel 前置地基）。
func SetBundledRegistryJSON(b []byte) {
	registryMu.Lock()
	defer registryMu.Unlock()
	bundledRegistryJSON = b
}

// ResourceTypeRegistry 资源类型注册表
type ResourceTypeRegistry struct {
	ResourceTypes []ResourceType `json:"resourceTypes"`
}

// ResourceType 一种受支持的资源类型定义
type ResourceType struct {
	ID             string          `json:"id"`
	Name           string          `json:"name"`
	Icon           string          `json:"icon"`
	Group          string          `json:"group"`                // 所属分组（ADR-092）：minecraft / minecraft-mod / mmd / vrm / other
	GroupLabel     string          `json:"groupLabel,omitempty"` // 分组显示名，仅该组首个类型携带（消除双写）
	GroupIcon      string          `json:"groupIcon,omitempty"`  // 分组图标，同上
	Extensions     []string        `json:"extensions"`
	StorageSubDir  string          `json:"storageSubDir"`
	InstanceDir    string          `json:"instanceDir"` // 整合包内实际存放目录（安装+扫描统一路径）
	InstanceLevel  bool            `json:"instanceLevel"`
	Preview        string          `json:"preview"`                  // "3d" / "thumbnail" / "none"
	Detector       string          `json:"detector"`                 // "ysm" / "mcmeta" / "shader" / "zipentry" / "extension"
	CliAnalyzable  bool            `json:"cliAnalyzable"`            // CLI（go/cli benchmark 等）是否有该类型的解析链路；单一事实源=本 JSON，2026-09 起 perfTypeManifest 不再持有（前端目标集选择器同源消费）
	ConfigField    string          `json:"configField"`              // AppConfig 字段名（如 YsmRoot）
	ConfigFallback string          `json:"configFallback"`           // AppConfig 回退字段名（如 VrcRoot→MmdRoot）
	IsDir          bool            `json:"isDir"`                    // 目录型资源（删除/同步整目录）
	Hashable       bool            `json:"hashable"`                 // 扩展名参与 SHA256 哈希（ShouldHashExt 注册表驱动）
	DirLevelSync   bool            `json:"dirLevelSync"`             // 文件夹级资源同步（sync.SyncResourcesDirLevel）
	ScanInstance   bool            `json:"scanInstance"`             // instance 视图额外扫描整合包目录（非模型类型兜底）
	FallbackDir    string          `json:"fallbackDir,omitempty"`    // 兜底扫描只认此目录名（空=不限定，ScanInstance=true 时生效）
	InstallExts    []string        `json:"installExts"`              // 安装白名单扩展名（空=全部放行，仅可执行文件黑名单除外）
	ZipEntries     []ZipEntryMatch `json:"zipEntries"`               // ZIP 内容特征条目（importer.DetectContainerType 注册表驱动）
	NestedModelDir bool            `json:"nestedModelDir"`           // 嵌套模型目录（无独立 ADR，特性登记见 extensions.go 注释 + 知识卡 go-types-registry；原注释误引 ADR-095）：模型入口在 assets/<namespace>/ 下（如 maid-model 的 maid_model.json）
	NestedPatterns []NestedPattern `json:"nestedPatterns,omitempty"` // 嵌套模式配置（无独立 ADR）：支持任意深度的嵌套路径检测
	Priority       int             `json:"priority,omitempty"`       // 检测优先级（同指纹计数打平时高者胜：专用指纹类型 > 通用指纹类型，如 maid-model > resourcepack）
	Mod            *ModRequirement `json:"mod,omitempty"`            // mod 依赖声明（ADR-110：mod 下沉注册表）
	Variants       []Variant       `json:"variants,omitempty"`       // 格式变体（ADR-111：variants 解耦，按扩展名分发预览器）
}

// ModRequirement mod 依赖声明（ADR-110）：
//   - JarKeywords：文件名关键词匹配（如 "mmdskin" 匹配 mmdskin-1.0.jar）
//   - ModID/DisplayName：内容检测型（读 mods.toml，如 touhou_little_maid）
//
// 两者互斥：有 ModID 时优先内容检测，否则用 JarKeywords 文件名匹配。
type ModRequirement struct {
	JarKeywords []string `json:"jarKeywords,omitempty"` // 文件名关键词（小写匹配）
	ModID       string   `json:"modId,omitempty"`       // mods.toml 中的 modId
	DisplayName string   `json:"displayName,omitempty"` // mods.toml 中的 displayName
}

// Variant 格式变体声明（ADR-111：variants 解耦）：
// 同一资源类型内不同格式变体的预览器路由。
// 例如角色模型（EntityPlayer）内 .pmx 用 mmd 预览器，.vrm 用 vrm 预览器。
type Variant struct {
	Ext     string `json:"ext"`     // 扩展名（如 ".pmx"、".vrm"）
	Preview string `json:"preview"` // 预览器 id（如 "mmd"、"vrm"）
}

// NestedPattern 嵌套模型模式配置：
// 支持任意深度的嵌套路径检测，用于识别多层嵌套的模型结构。
// 例如 maid-model 的 assets/<namespace>/maid_model.json 结构，
// 或其他更深层的嵌套目录结构。
//
// 配置示例：
//
//	{
//	  "entryDir": "assets",           // 入口目录（相对于模型根目录）
//	  "entryFiles": ["maid_model.json", "chair_model.json"]  // 入口文件名
//	}
//
// 运行时行为：
//  1. 从模型根目录开始，递归查找 entryDir 指定的目录
//  2. 在 entryDir 下查找 entryFiles 中任一文件
//  3. 找到后将该目录识别为模型目录（含层级信息）
type NestedPattern struct {
	EntryDir   string   `json:"entryDir"`           // 入口目录名（如 "assets"），为空则直接在根目录查找
	EntryFiles []string `json:"entryFiles"`         // 入口文件名列表（如 ["maid_model.json"]）
	MaxDepth   int      `json:"maxDepth,omitempty"` // 最大递归深度（默认 10），防止无限递归
}

// EffectiveExtensions 返回资源类型的有效扩展名集（小写化）。
// 单一事实源——代码应通过此函数获取扩展名，而非直接读 rt.Extensions。
func (rt *ResourceType) EffectiveExtensions() []string {
	out := make([]string, len(rt.Extensions))
	for i, e := range rt.Extensions {
		out[i] = strings.ToLower(e)
	}
	return out
}

// ZipEntryMatch ZIP 内容特征条目：检测 ZIP 内是否存在命中条目名
type ZipEntryMatch struct {
	Name  string `json:"name"`  // 条目名（小写比较）
	Match string `json:"match"` // "exact" / "prefix" / "suffix"
}

// MatchZipEntry 检测 ZIP 条目名是否命中本类型的特征条目（小写不敏感）
// ADR-082 S1：任意层级段后缀匹配——对路径按 / 分段，每个段后缀都参与指纹匹配，
// 解决「zip 套一层目录」（MyPack/pack.mcmeta 命中 pack.mcmeta exact）。
// suffix 幂等（原 HasSuffix 已覆盖任意层级），exact/prefix 从「根目录限定」放宽为「任意层级」。
func (rt *ResourceType) MatchZipEntry(name string) bool {
	low := strings.ToLower(name)
	// 段后缀：a/b/c → [a/b/c, b/c, c]（zip 条目名标准为 /，反斜杠归一）
	segs := strings.Split(filepath.ToSlash(low), "/")
	for i := range segs {
		seg := strings.Join(segs[i:], "/")
		for _, m := range rt.ZipEntries {
			mlow := strings.ToLower(m.Name)
			switch m.Match {
			case "prefix":
				if strings.HasPrefix(seg, mlow) {
					return true
				}
			case "suffix":
				if strings.HasSuffix(seg, mlow) {
					return true
				}
			default: // "exact"
				if seg == mlow {
					return true
				}
			}
		}
	}
	return false
}

var (
	registryMu   sync.Mutex
	registry     *ResourceTypeRegistry
	registryPath = "resource_types.json" // 可被 tests 替换
)

// SetRegistryPath 设置注册表文件路径（仅测试用；⚠️ 禁止生产调用——生产路径不得改注册表源）
// 加锁保护：并发调用 LoadRegistry + SetRegistryPath 触发数据竞争（审计 P1 #2）。
func SetRegistryPath(path string) {
	registryMu.Lock()
	defer registryMu.Unlock()
	registryPath = path
	registry = nil
}

// LoadRegistry 加载资源类型注册表（单一事实来源 = 编译期嵌入的 resource_types.json）。
// 仅当 SetRegistryPath 显式指定外部绝对路径时才读取外部文件（测试/显式覆盖）；
// 默认回退到编译时嵌入数据，不再扫描 exe 旁目录，杜绝旧快照遮蔽导致的漂移。
// 加锁替代 sync.Once：避免 SetRegistryPath 重置 once 与 Do 之间的竞争。
func LoadRegistry() *ResourceTypeRegistry {
	registryMu.Lock()
	defer registryMu.Unlock()
	if registry != nil {
		return registry
	}
	data := loadRegistryBytes()
	var reg ResourceTypeRegistry
	if err := json.Unmarshal(data, &reg); err != nil {
		// 解析失败回退嵌入基线而不是缓存空注册表——
		// 原实现 `registry = &ResourceTypeRegistry{}` 会让空注册表
		// 在进程生命周期内永久缓存（无重试、不回退），所有扩展名查询静默失效
		log.Printf("[types] 解析注册表失败，回退嵌入基线: %v", err)
		// 回退解码必须用全新零值变量——
		// encoding/json 对字段类型错误是「跳过该字段继续解码」，失败后 reg 可能已部分填充，
		// 复用 reg 解码基线会得到「基线 + 损坏文件残留字段」的混合注册表
		// （baseline 缺 configFallback 等字段时残留值存活），违反「回退=干净基线」契约
		var baseline ResourceTypeRegistry
		if err := json.Unmarshal(bundledRegistryJSON, &baseline); err != nil {
			// 嵌入基线本身损坏（生成文件被破坏）时仍不 panic，但标记空表避免二次解析
			log.Printf("[types] 嵌入基线解析也失败: %v", err)
			registry = &ResourceTypeRegistry{}
			return registry
		}
		reg = baseline
	}
	// BUG-1/4 修复：外部文件合法但语义为空（`resourceTypes: []` 或 `null`）→
	// 视为与解析失败同等级，回退嵌入基线。
	// 否则 IsSupportedExt / StorageSubDir 等下游全线静默失效，用户只能重启进程。
	if len(reg.ResourceTypes) == 0 {
		log.Printf("[types] 外部注册表为空（%d 条目），回退嵌入基线", len(reg.ResourceTypes))
		var baseline ResourceTypeRegistry
		if err := json.Unmarshal(bundledRegistryJSON, &baseline); err != nil {
			registry = &ResourceTypeRegistry{}
			return registry
		}
		reg = baseline
	}
	// BUG-3 修复：重复 id 去重，保留最后一次出现的条目（last-wins），
	// 避免 RegistryType 与 ExtBelongsTo 对同一 id 语义不一致（前者 first-wins、后者 all-wins）。
	if len(reg.ResourceTypes) > 1 {
		seen := make(map[string]int, len(reg.ResourceTypes))
		deduped := make([]ResourceType, 0, len(reg.ResourceTypes))
		dupCount := 0
		for i, rt := range reg.ResourceTypes {
			if j, ok := seen[rt.ID]; ok {
				deduped[j] = rt
				dupCount++
			} else {
				seen[rt.ID] = i
				deduped = append(deduped, rt)
			}
		}
		if dupCount > 0 {
			log.Printf("[types] 注册表含 %d 个重复 id，已去重（保留最后出现条目）", dupCount)
			reg.ResourceTypes = deduped
		}
	}
	// P0 注册表 schema 守卫：字段唯一归属 + 引用完整性。
	// 违反则逐条 log.Printf 告警、不阻断加载（避免生产环境因历史债直接瘫痪）。
	for _, v := range validateRegistrySchema(&reg) {
		log.Printf("[types][WARN] %s", v)
	}
	registry = &reg
	return registry
}

// validateRegistrySchema 注册表 schema 守卫：
//  1. storageSubDir 全局唯一——重复值意味着两个类型落盘到同一路径，存储冲突
//  2. configField 全局唯一——重复值意味着两个类型声明同一配置槽，查询歧义
//  3. configFallback 引用完整性——回退字段必须指向已声明的 configField，消除孤儿回退
//
// 返回违规描述列表（空 = 合规）。守卫本身不落日志、不改数据：
// LoadRegistry 侧对每条违规 log.Printf 告警（WARN 级，不阻断——生产注册表可能
// 含历史债，硬 fail 会让 IsSupportedExt 全线失效）；真实注册表的硬断言由 schema
// 契约测试（tests/test_resource_schema.mjs）承担，CI 拦在提交前。
//
// 每个守卫是「独立遍历 reg → 追加违规」的封闭单元，彼此无共享可变状态，
// 故各成一个具名函数；本函数只保留调用序列——追加顺序即对外可见的违规顺序契约。
