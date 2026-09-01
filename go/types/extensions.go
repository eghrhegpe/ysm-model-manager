// ===== 扩展名定义 =====
// 所有扩展名和子目录信息均通过 resource_types.json 注册表驱动，
// 新增类型只需在 JSON 中添加条目，无需修改此文件。
package types

import (
	"path"
	"strings"
	"sync/atomic"
)

// ===== 已移除壳-叶架构（ADR-XXX 大统一）=====
// SubtypesFor/SubtypeNames/SubtypeByDir/IsSubDirName/MMDSubDirs/IsMMDSubDir/IsSubDirGrouping
// 全部移除。每个资源类型独立管自己的路径和扩展名，不再共享根目录或父子关系。

// IsNestedModelDir 判断 rtype 是否有嵌套模型目录结构（ADR-095）：
// 模型入口文件在 assets/<namespace>/ 下（如 maid-model 的 maid_model.json）。
// 消费注册表 nestedModelDir 字段，不硬编码 rtype。
func IsNestedModelDir(rtype string) bool {
	if rt := RegistryType(rtype); rt != nil {
		return rt.NestedModelDir || len(rt.NestedPatterns) > 0
	}
	return false
}

// NestedPatternsFor 返回指定资源类型的嵌套模式配置列表（ADR-XXX）。
// 若类型未配置 NestedPatterns 但有 NestedModelDir 标记，返回默认的 assets/入口文件模式。
func NestedPatternsFor(rtype string) []NestedPattern {
	rt := RegistryType(rtype)
	if rt == nil {
		return nil
	}
	// 优先返回显式配置的 NestedPatterns
	if len(rt.NestedPatterns) > 0 {
		return rt.NestedPatterns
	}
	// 向后兼容：只有 NestedModelDir 标记时返回默认模式
	if rt.NestedModelDir {
		return []NestedPattern{
			{
				EntryDir:   "assets",
				EntryFiles: []string{"maid_model.json", "chair_model.json"},
				MaxDepth:   10,
			},
		}
	}
	return nil
}

// MaxImportSize 导入文件最大体积限制（500MB）
// MMD/VRC 模型文件可达数十 MB，但超过 500MB 的文件可能是异常数据
const MaxImportSize = 500 * 1024 * 1024

// MaxImportSizeMB MaxImportSize 的 MB 整数表示（错误文案格式化用，防 500MB 字面量漂移）
const MaxImportSizeMB = MaxImportSize / (1024 * 1024)

// MaxReadLimit 单文件/条目读取上限（50MB）——共享常量（索引 6.7+5.2）：
// 收敛 geometry maxExtractSize（ZIP/7z 条目防炸弹）、fileops maxPreviewRead（预览整读）、
// ysm maxReadSize/maxYsmJSON/maxTexGeo/maxTexJSON（解析整读）三包 9 处独立声明的
// `50 << 20` 为单一事实来源，任一包调整上限只改本常量。
const MaxReadLimit = 50 << 20

// AllExts 返回所有支持的扩展名（去重后）。
// 壳类型（有 subtypes）自动派生并集——不再依赖手动维护的父级 extensions。
func AllExts() []string {
	reg := LoadRegistry()
	seen := map[string]bool{}
	var result []string
	for _, rt := range reg.ResourceTypes {
		for _, e := range rt.EffectiveExtensions() {
			if !seen[e] {
				seen[e] = true
				result = append(result, e)
			}
		}
	}
	return result
}

// ContainerExts 全局容器扩展名集合（.zip/.7z）。
// 容器是可包裹任意资源类型的通用包装层，不是资源类型的属性——本函数是 Go 侧
// 容器判定的单一事实来源：识别链路（packs.DetectResourceType 的 isContainer）、
// 整合包目录查找（FindInstDir 的容器弱证据）统一走 IsContainerExt，禁止魔法字符串。
// 前端对应物：frontend/src/utils/resource/types.ts 的 CONTAINER_EXTS（歧义扩展名推导源）；
// 契约对应物：tests/test_resource_schema.mjs 的 CONTAINER_EXTS。三端同源。
func ContainerExts() []string {
	return []string{".zip", ".7z"}
}

// IsContainerExt 判断扩展名是否是容器扩展名（大小写不敏感）。
// 容器文件（.zip/.7z）的类型归属不能靠扩展名判定（ADR-067：任何类型都可能被
// 包裹），必须走 zipEntries 内容指纹（packs.DetectResourceType / importer.DetectZipType）。
func IsContainerExt(ext string) bool {
	low := strings.ToLower(ext)
	return low == ".zip" || low == ".7z"
}

// ===== 扩展名集合 map 缓存 =====
// IsSupportedExt / ShouldHashExt 原是每文件双层 for 循环遍历全注册表（且 EffectiveExtensions
// 每次调用临时分配 slice），注册表膨胀后线性劣化。改为 atomic.Value 缓存扩展名集合：
// 以注册表实例指针为失效 key——SetRegistryPath 重置注册表 → LoadRegistry 返回新实例 → 自动重建，
// 语义与逐次遍历完全一致（行为锁定测试 extensions_map_test.go 防误用 sync.Once 永久缓存）。

type extCacheEntry struct {
	reg     *ResourceTypeRegistry
	extSet  map[string]bool // 全部扩展名（小写）
	hashSet map[string]bool // 仅 hashable 类型声明的扩展名（小写）
}

var extCache atomic.Value // *extCacheEntry

// loadExtCache 返回与当前注册表匹配的扩展名集合缓存（实例变化时重建）。
// atomic.Value 无锁热路径：并发重建幂等，最后 Store 者胜。
func loadExtCache(reg *ResourceTypeRegistry) *extCacheEntry {
	if c, ok := extCache.Load().(*extCacheEntry); ok && c.reg == reg {
		return c
	}
	c := &extCacheEntry{
		reg:     reg,
		extSet:  make(map[string]bool),
		hashSet: make(map[string]bool),
	}
	for _, rt := range reg.ResourceTypes {
		hashable := rt.Hashable
		for _, e := range rt.EffectiveExtensions() { // 已小写
			c.extSet[e] = true
			if hashable {
				c.hashSet[e] = true
			}
		}
	}
	extCache.Store(c)
	return c
}

// IsSupportedExt 检查扩展名是否被任何资源类型支持。
// 壳类型（有 subtypes）自动派生并集——不再依赖手动维护的父级 extensions。
func IsSupportedExt(ext string) bool {
	reg := LoadRegistry()
	return loadExtCache(reg).extSet[strings.ToLower(ext)]
}

// IsYsmEntryJSON 判断是否为 YSM 解压目录的唯一清单入口 ysm.json（大小写不敏感）
// ADR-038 D2：.json 仅放行 ysm.json；包内 geometry/animation/语言 json 不得作为独立条目
// 扫描（scanner）、导入（importer/app_install）统一走此判定，口径单点维护。
func IsYsmEntryJSON(baseName string) bool {
	return strings.EqualFold(strings.TrimSpace(baseName), "ysm.json")
}

// DisableSuffixes 禁用后缀列表（新标准 .disabled 在前，历史 .ban 兼容在后）。
var DisableSuffixes = []string{".disabled", ".ban"}

// StripDisableSuffix 剥离禁用后缀（大小写不敏感，依次尝试 .disabled/.ban）。
// 单一事实来源——sync/scanner/ysm/installer/fileops 的禁用后缀剥离均委托本函数，
// 防多处内联 `name[:len(name)-N]` 口径漂移。
func StripDisableSuffix(name string) string {
	lower := strings.ToLower(name)
	for _, sfx := range DisableSuffixes {
		if strings.HasSuffix(lower, sfx) {
			return name[:len(name)-len(sfx)]
		}
	}
	return name
}

// StripBanSuffix 保留向后兼容——内部委托 StripDisableSuffix。
func StripBanSuffix(name string) string {
	return StripDisableSuffix(name)
}

// IsDisableSuffix 判断文件名是否带禁用后缀（.disabled/.ban，大小写不敏感）。
func IsDisableSuffix(name string) bool {
	lower := strings.ToLower(name)
	for _, sfx := range DisableSuffixes {
		if strings.HasSuffix(lower, sfx) {
			return true
		}
	}
	return false
}

// NormalizeResourceName 归一化资源文件名用于同步匹配（ADR-064 收敛）：
// 小写 + 去除 .disabled/.ban 禁用后缀。原 sync.isSyncAllowed/syncNameKey/
// instance.extMatch/scanner.stripDisableSuffix 四处内联同义实现收敛于此。
func NormalizeResourceName(name string) string {
	low := strings.ToLower(name)
	low = strings.TrimSuffix(low, ".disabled")
	low = strings.TrimSuffix(low, ".ban")
	return low
}

// IsResourceAllowed 判断文件名是否属于受支持的同步资源（ADR-064 收敛）：
// 扩展名命中注册表全扩展集（AllExts），.json 仅放行 ysm.json（统一走
// IsYsmEntryJSON，含 TrimSpace/大小写不敏感）。
// 原 sync.isSyncAllowed 收敛于此；scanner 内联过滤语义一致（scanner 另有
// .ban 目录跳过等展示层逻辑，保持独立）。
func IsResourceAllowed(name string) bool {
	base := NormalizeResourceName(name)
	// .json 只允许 ysm.json（其余为动作/动画/模型引用文件，不应单独同步）
	if strings.HasSuffix(base, ".json") {
		return IsYsmEntryJSON(base)
	}
	for _, ext := range AllExts() {
		if strings.HasSuffix(base, ext) {
			return true
		}
	}
	return false
}

// IsTypeModelFile 已下沉至 go/packs/classify.go（ADR-144：其 zipentry 分支需开容器
// 做指纹判定，随识别大脑一并下沉；消费方改调 packs.IsTypeModelFile）。

// ShouldHashExt 判断扩展名是否需要计算 SHA256 哈希（用于同步系统文件匹配）。
// 注册表驱动：任何声明 hashable 的资源类型的扩展名均计入哈希。
// 壳类型（有 subtypes）自动派生并集——不再依赖手动维护的父级 extensions。
func ShouldHashExt(ext string) bool {
	reg := LoadRegistry()
	return loadExtCache(reg).hashSet[strings.ToLower(ext)]
}

// IsDirLevelSync 判断 rtype 是否为文件夹级资源同步类型
// （sync.SyncResourcesDirLevel 按文件夹名对比；注册表 dirLevelSync 驱动，新增类型只需改 JSON）
func IsDirLevelSync(rtype string) bool {
	if rt := RegistryType(rtype); rt != nil {
		return rt.DirLevelSync
	}
	return false
}

// IsScanInstance 判断 rtype 是否需要 instance 视图额外扫描整合包目录。
// 已废弃（ADR-064 阶段二）：SyncResources 相对路径对比全树递归收集所有受支持
// 文件（含嵌套），同名不同目录不再 map 去重丢失，原兜底 Walk 无新增条目可补，
// 本函数无调用方（2026-08-15 审核确认），保留定义仅为兼容资源类型注册表
// scanInstance 字段解析；新增代码禁止使用。
// Deprecated: 无消费方，计划随 scanInstance 字段一并移除。
func IsScanInstance(rtype string) bool {
	if rt := RegistryType(rtype); rt != nil {
		return rt.ScanInstance
	}
	return false
}

// InstallExtsFor 返回 rtype 的安装白名单扩展名（空=全部放行，仅可执行文件黑名单除外）
// installer.installDirRecursive 的 isAllowed 注册表驱动；新增类型只需改 JSON。
func InstallExtsFor(rtype string) []string {
	if rt := RegistryType(rtype); rt != nil {
		return append([]string(nil), rt.InstallExts...)
	}
	return nil
}

// MatchZipEntry 按注册表 zipEntries 特征匹配 ZIP 条目名，返回命中的资源类型 ID。
// importer.DetectZipType 注册表驱动（Top 2）：新增类型只需在 JSON 中声明
// zipEntries（exact/prefix/suffix），无需修改检测器代码。
// 按注册表顺序优先匹配（resourcepack → shaderpack → ysm → …），无命中返回空串。
func MatchZipEntry(name string) string {
	reg := LoadRegistry()
	for _, rt := range reg.ResourceTypes {
		if len(rt.ZipEntries) == 0 {
			continue
		}
		if rt.MatchZipEntry(name) {
			return rt.ID
		}
	}
	return ""
}

// ExtBelongsTo 返回扩展名所属的资源类型 ID 列表（可能多个）。
// 壳类型（有 subtypes）自动派生并集——不再依赖手动维护的父级 extensions。
func ExtBelongsTo(ext string) []string {
	ext = strings.ToLower(ext)
	reg := LoadRegistry()
	var result []string
	for _, rt := range reg.ResourceTypes {
		for _, e := range rt.EffectiveExtensions() {
			if strings.ToLower(e) == ext {
				result = append(result, rt.ID)
				break
			}
		}
	}
	return result
}

// ExtBelongsToBy 返回扩展名在指定注册表中的声明者 ID 列表（ExtBelongsTo 的可注入版本）。
// 纯注册表查询，归属本包（ADR-144：types/resource.go 守卫与 packs.ClassifyExt 共用；
// 若随识别大脑下沉 packs 会造成 types→packs 反向依赖，故保留于此）。
func ExtBelongsToBy(ext string, reg *ResourceTypeRegistry) []string {
	ext = strings.ToLower(ext)
	var result []string
	for i := range reg.ResourceTypes {
		rt := &reg.ResourceTypes[i]
		for _, e := range rt.EffectiveExtensions() {
			if strings.ToLower(e) == ext {
				result = append(result, rt.ID)
				break
			}
		}
	}
	return result
}

// SupportedExtsForType 返回指定资源类型的所有扩展名。
// 当类型挂有 subtypes 时，自动派生所有子类型扩展名的并集（单一事实源：
// subtype 自声明 extensions 驱动，父类型 extensions 字段仅作文档记录）。
// 无 subtypes 时直接返回父类型 extensions（独立类型的常规路径）。
func SupportedExtsForType(rtype string) []string {
	rt := RegistryType(rtype)
	if rt == nil {
		rt = RegistryType(strings.ToLower(rtype))
	}
	if rt == nil {
		return nil
	}
	return rt.EffectiveExtensions()
}

// SupportedExtsForSubtype 返回指定资源类型的扩展名。
// 壳-叶架构已移除，subtype 参数忽略——保留签名为 Wails 绑定兼容。
func SupportedExtsForSubtype(rtype, subtype string) []string {
	return SupportedExtsForType(rtype)
}

// StorageSubDir 每种资源类型在 FilesRoot 下的存储子目录
// 从 resource_types.json 注册表读取，无匹配时返回 rtype 自身
func StorageSubDir(rtype string) string {
	if rt := RegistryType(rtype); rt != nil && rt.StorageSubDir != "" {
		return rt.StorageSubDir
	}
	return rtype
}

// GroupOf 返回资源类型所属分组 id（ADR-092）
// 从注册表 group 字段读取；无 group 字段时返回空串（表示单级平铺、不参与分组）。
func GroupOf(rtype string) string {
	if rt := RegistryType(rtype); rt != nil && rt.Group != "" {
		return rt.Group
	}
	return ""
}

// GroupStorageRoot 返回资源类型在 FilesRoot 下的分组存储根目录（ADR-092 两层路由）：
//   - 有 group：FilesRoot/{group}/{storageSubDir}
//   - 无 group（向后兼容）：FilesRoot/{storageSubDir}（单级平铺，不强制迁移旧目录）
//
// 返回的是相对于 FilesRoot 的子路径（不含 FilesRoot 本身），调用方自行 Join。
func GroupStorageRoot(rtype string) string {
	rt := RegistryType(rtype)
	if rt == nil {
		return rtype
	}
	sub := rt.StorageSubDir
	if sub == "" {
		sub = rtype
	}
	if rt.Group != "" {
		return path.Join(rt.Group, sub)
	}
	return sub
}

// GroupLabel 返回分组显示名（从注册表各类型的 groupLabel 字段派生，消除 resourceGroups 冗余源）；
// 取该组第一个有 groupLabel 的类型的值；未知分组返回空串。
func GroupLabel(group string) string {
	if group == "" {
		return ""
	}
	reg := LoadRegistry()
	for _, rt := range reg.ResourceTypes {
		if rt.Group == group && rt.GroupLabel != "" {
			return rt.GroupLabel
		}
	}
	return ""
}

// GroupIcon 返回分组图标（从注册表各类型的 groupIcon 字段派生）。
func GroupIcon(group string) string {
	if group == "" {
		return ""
	}
	reg := LoadRegistry()
	for _, rt := range reg.ResourceTypes {
		if rt.Group == group && rt.GroupIcon != "" {
			return rt.GroupIcon
		}
	}
	return ""
}

// SubDirEntry 资源类型的版本子目录信息
type SubDirEntry struct {
	SubDir string
	RType  string
}

// resolveSubDir 解析资源类型的实例子目录
func resolveSubDir(rt ResourceType) string {
	return rt.InstanceDir
}

// SubDirMap 返回指定资源类型在整合包实例版本目录中的实例子目录
func SubDirMap(rtype string) string {
	if rt := RegistryType(rtype); rt != nil {
		if d := resolveSubDir(*rt); d != "" {
			return d
		}
	}
	// 小写兜底（向后兼容）
	if rt := RegistryType(strings.ToLower(rtype)); rt != nil {
		if d := resolveSubDir(*rt); d != "" {
			return d
		}
	}
	return ""
}

// SubDirAll 返回所有资源类型在整合包实例中的版本子目录映射
func SubDirAll() map[string]string {
	reg := LoadRegistry()
	m := make(map[string]string, len(reg.ResourceTypes))
	for _, rt := range reg.ResourceTypes {
		if d := resolveSubDir(rt); d != "" {
			m[rt.ID] = d
		}
	}
	return m
}

// AllSubDirs 返回所有资源类型的版本子目录信息（遍历用）
func AllSubDirs() []SubDirEntry {
	reg := LoadRegistry()
	result := make([]SubDirEntry, 0, len(reg.ResourceTypes))
	for _, rt := range reg.ResourceTypes {
		if d := resolveSubDir(rt); d != "" {
			result = append(result, SubDirEntry{SubDir: d, RType: rt.ID})
		}
	}
	return result
}
