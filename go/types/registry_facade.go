// registry_facade.go —— go/types 门面别名（ADR-192 第一刀）
//
// registry 域已迁至独立子包 go/types/registry（package registry）。go/types 保留
// 纯 DTO 域，本文件重建所有迁出符号，使旧路径 `go/types` 的 77 个外部 .go 消费者
// 零改动继续工作。方法集经 type alias 自动保留（alias 后方法自动可用，勿重复定义）。
package types

import "ysm-model-manager/go/types/registry"

// 类型别名：方法（FindByID / EffectiveExtensions / MatchZipEntry / UnmarshalJSON / Desc）
// 经 alias 自动保留，勿重复定义方法，否则冲突。
type (
	// Deprecated: 直接 import go/types/registry
	ResourceTypeRegistry = registry.ResourceTypeRegistry
	// Deprecated: 直接 import go/types/registry
	ResourceType = registry.ResourceType
	// Deprecated: 直接 import go/types/registry
	ModRequirement = registry.ModRequirement
	// Deprecated: 直接 import go/types/registry
	Variant = registry.Variant
	// Deprecated: 直接 import go/types/registry
	NestedPattern = registry.NestedPattern
	// Deprecated: 直接 import go/types/registry
	ZipEntryMatch = registry.ZipEntryMatch
	// Deprecated: 直接 import go/types/registry
	FormatRange = registry.FormatRange
	// Deprecated: 直接 import go/types/registry
	PackMeta = registry.PackMeta
	// Deprecated: 直接 import go/types/registry
	LitematicMeta = registry.LitematicMeta
	// Deprecated: 直接 import go/types/registry
	LitematicBlockStat = registry.LitematicBlockStat
	// Deprecated: 直接 import go/types/registry
	LitematicVoxelData = registry.LitematicVoxelData
	// Deprecated: 直接 import go/types/registry
	VoxelGroup = registry.VoxelGroup
	// Deprecated: 直接 import go/types/registry
	SubDirEntry = registry.SubDirEntry
)

// 常量对等
const (
	// Deprecated: 直接 import go/types/registry
	MaxImportSize = registry.MaxImportSize
	// Deprecated: 直接 import go/types/registry
	MaxImportSizeMB = registry.MaxImportSizeMB
	// Deprecated: 直接 import go/types/registry
	MaxReadLimit = registry.MaxReadLimit
)

// 变量对等（registry 侧只读，切片头拷贝语义等价）
// Deprecated: 直接 import go/types/registry
var DisableSuffixes = registry.DisableSuffixes

// SetBundledRegistryJSON 由根包 main 注入编译期内嵌的注册表字节（单源：仓库根 resource_types.json）。
// Deprecated: 直接 import go/types/registry
func SetBundledRegistryJSON(b []byte) {
	registry.SetBundledRegistryJSON(b)
}

// SetRegistryPath 设置注册表文件路径（仅测试用）。
// Deprecated: 直接 import go/types/registry
func SetRegistryPath(path string) {
	registry.SetRegistryPath(path)
}

// LoadRegistry 加载资源类型注册表（单一事实来源 = 编译期嵌入的 resource_types.json）。
// Deprecated: 直接 import go/types/registry
func LoadRegistry() *registry.ResourceTypeRegistry {
	return registry.LoadRegistry()
}

// BundledRegistryJSON 返回编译期内嵌的资源类型注册表原始 JSON 字节（单一事实来源）。
// Deprecated: 直接 import go/types/registry
func BundledRegistryJSON() []byte {
	return registry.BundledRegistryJSON()
}

// RegistryType 按 id 查找资源类型，不存在时返回 nil（深拷贝）。
// Deprecated: 直接 import go/types/registry
func RegistryType(id string) *registry.ResourceType {
	return registry.RegistryType(id)
}

// ModKeywordsFor 从注册表查询资源类型的 mod 文件名关键词（ADR-110，含组级回退）。
// Deprecated: 直接 import go/types/registry
func ModKeywordsFor(rtype string) []string {
	return registry.ModKeywordsFor(rtype)
}

// ModMetaFor 从注册表查询内容检测型资源类型的 mod 信息（ADR-110）。
// Deprecated: 直接 import go/types/registry
func ModMetaFor(rtype string) (string, string) {
	return registry.ModMetaFor(rtype)
}

// IsNestedModelDir 判断 rtype 是否有嵌套模型目录结构（ADR-095）。
// Deprecated: 直接 import go/types/registry
func IsNestedModelDir(rtype string) bool {
	return registry.IsNestedModelDir(rtype)
}

// NestedPatternsFor 返回指定资源类型的嵌套模式配置列表。
// Deprecated: 直接 import go/types/registry
func NestedPatternsFor(rtype string) []registry.NestedPattern {
	return registry.NestedPatternsFor(rtype)
}

// AllExts 返回所有支持的扩展名（去重后）。
// Deprecated: 直接 import go/types/registry
func AllExts() []string {
	return registry.AllExts()
}

// ContainerExts 全局容器扩展名集合（.zip/.7z）。
// Deprecated: 直接 import go/types/registry
func ContainerExts() []string {
	return registry.ContainerExts()
}

// IsContainerExt 判断扩展名是否是容器扩展名（大小写不敏感）。
// Deprecated: 直接 import go/types/registry
func IsContainerExt(ext string) bool {
	return registry.IsContainerExt(ext)
}

// IsSupportedExt 检查扩展名是否被任何资源类型支持。
// Deprecated: 直接 import go/types/registry
func IsSupportedExt(ext string) bool {
	return registry.IsSupportedExt(ext)
}

// IsYsmEntryJSON 判断是否为 YSM 解压目录的唯一清单入口 ysm.json（大小写不敏感）。
// Deprecated: 直接 import go/types/registry
func IsYsmEntryJSON(baseName string) bool {
	return registry.IsYsmEntryJSON(baseName)
}

// StripDisableSuffix 剥离禁用后缀（大小写不敏感，依次尝试 .disabled/.ban）。
// Deprecated: 直接 import go/types/registry
func StripDisableSuffix(name string) string {
	return registry.StripDisableSuffix(name)
}

// StripBanSuffix 保留向后兼容——内部委托 StripDisableSuffix。
// Deprecated: 直接 import go/types/registry
func StripBanSuffix(name string) string {
	return registry.StripBanSuffix(name)
}

// IsDisableSuffix 判断文件名是否带禁用后缀（大小写不敏感）。
// Deprecated: 直接 import go/types/registry
func IsDisableSuffix(name string) bool {
	return registry.IsDisableSuffix(name)
}

// NormalizeResourceName 归一化资源文件名用于同步匹配（ADR-064 收敛）。
// Deprecated: 直接 import go/types/registry
func NormalizeResourceName(name string) string {
	return registry.NormalizeResourceName(name)
}

// IsResourceAllowed 判断文件名是否属于受支持的同步资源（ADR-064 收敛）。
// Deprecated: 直接 import go/types/registry
func IsResourceAllowed(name string) bool {
	return registry.IsResourceAllowed(name)
}

// ShouldHashExt 判断扩展名是否需要计算 SHA256 哈希（注册表驱动）。
// Deprecated: 直接 import go/types/registry
func ShouldHashExt(ext string) bool {
	return registry.ShouldHashExt(ext)
}

// IsDirLevelSync 判断 rtype 是否为文件夹级资源同步类型。
// Deprecated: 直接 import go/types/registry
func IsDirLevelSync(rtype string) bool {
	return registry.IsDirLevelSync(rtype)
}

// IsScanInstance 判断 rtype 是否需要 instance 视图额外扫描整合包目录。
// Deprecated: 直接 import go/types/registry
func IsScanInstance(rtype string) bool {
	return registry.IsScanInstance(rtype)
}

// InstallExtsFor 返回 rtype 的安装白名单扩展名（空=全部放行）。
// Deprecated: 直接 import go/types/registry
func InstallExtsFor(rtype string) []string {
	return registry.InstallExtsFor(rtype)
}

// MatchZipEntry 按注册表 zipEntries 特征匹配 ZIP 条目名，返回命中的资源类型 ID。
// Deprecated: 直接 import go/types/registry
func MatchZipEntry(name string) string {
	return registry.MatchZipEntry(name)
}

// ExtBelongsTo 返回扩展名所属的资源类型 ID 列表（可能多个）。
// Deprecated: 直接 import go/types/registry
func ExtBelongsTo(ext string) []string {
	return registry.ExtBelongsTo(ext)
}

// ExtBelongsToBy 返回扩展名在指定注册表中的声明者 ID 列表（可注入版本）。
// Deprecated: 直接 import go/types/registry
func ExtBelongsToBy(ext string, reg *registry.ResourceTypeRegistry) []string {
	return registry.ExtBelongsToBy(ext, reg)
}

// SupportedExtsForType 返回指定资源类型的所有扩展名（壳类型自动派生并集）。
// Deprecated: 直接 import go/types/registry
func SupportedExtsForType(rtype string) []string {
	return registry.SupportedExtsForType(rtype)
}

// SupportedExtsForSubtype 返回指定资源类型的扩展名（subtype 参数见源实现）。
// Deprecated: 直接 import go/types/registry
func SupportedExtsForSubtype(rtype, subtype string) []string {
	return registry.SupportedExtsForSubtype(rtype, subtype)
}

// StorageSubDir 每种资源类型在 FilesRoot 下的存储子目录。
// Deprecated: 直接 import go/types/registry
func StorageSubDir(rtype string) string {
	return registry.StorageSubDir(rtype)
}

// GroupOf 返回资源类型所属分组 id（ADR-092）。
// Deprecated: 直接 import go/types/registry
func GroupOf(rtype string) string {
	return registry.GroupOf(rtype)
}

// GroupStorageRoot 返回资源类型在 FilesRoot 下的分组存储根目录（ADR-092 两层路由）。
// Deprecated: 直接 import go/types/registry
func GroupStorageRoot(rtype string) string {
	return registry.GroupStorageRoot(rtype)
}

// GroupLabel 返回分组显示名（ADR-092，从注册表派生）。
// Deprecated: 直接 import go/types/registry
func GroupLabel(group string) string {
	return registry.GroupLabel(group)
}

// GroupIcon 返回分组图标（ADR-092，从注册表派生）。
// Deprecated: 直接 import go/types/registry
func GroupIcon(group string) string {
	return registry.GroupIcon(group)
}

// SubDirMap 返回指定资源类型在整合包实例版本目录中的实例子目录。
// Deprecated: 直接 import go/types/registry
func SubDirMap(rtype string) string {
	return registry.SubDirMap(rtype)
}

// SubDirAll 返回所有资源类型在整合包实例中的版本子目录映射。
// Deprecated: 直接 import go/types/registry
func SubDirAll() map[string]string {
	return registry.SubDirAll()
}

// AllSubDirs 返回所有资源类型的版本子目录信息（遍历用）。
// Deprecated: 直接 import go/types/registry
func AllSubDirs() []registry.SubDirEntry {
	return registry.AllSubDirs()
}

// FindInstDir 查找整合包中指定资源类型的子目录。
// Deprecated: 直接 import go/types/registry
func FindInstDir(versionDir, subDir, rtype string) string {
	return registry.FindInstDir(versionDir, subDir, rtype)
}

// TypeByLocation 祖先目录归属判定（location 路由，MMD 子类型共享扩展名消歧）。
// 注意：参数名用 reg 而非 registry——registry 为本文件 import 的包标识符，同名会遮蔽。
// Deprecated: 直接 import go/types/registry
func TypeByLocation(path string, reg *registry.ResourceTypeRegistry) string {
	return registry.TypeByLocation(path, reg)
}

// SupportedTextureExts 返回项目认可的全部纹理扩展名（小写，含 .tga）。
// Deprecated: 直接 import go/types/registry
func SupportedTextureExts() []string {
	return registry.SupportedTextureExts()
}

// RenderableTextureExts 返回 Web 可渲染的纹理扩展名（小写，不含 .tga）。
// Deprecated: 直接 import go/types/registry
func RenderableTextureExts() []string {
	return registry.RenderableTextureExts()
}

// IsTextureExt 是否为受支持的纹理扩展名（含 .tga，大小写不敏感）。
// Deprecated: 直接 import go/types/registry
func IsTextureExt(ext string) bool {
	return registry.IsTextureExt(ext)
}

// IsRenderableTextureExt 是否为 Web 可渲染的纹理扩展名（不含 .tga）。
// Deprecated: 直接 import go/types/registry
func IsRenderableTextureExt(ext string) bool {
	return registry.IsRenderableTextureExt(ext)
}

// TextureMIME 按扩展名返回 Web 可解码的图像 MIME 类型（大小写不敏感）。
// Deprecated: 直接 import go/types/registry
func TextureMIME(ext string) string {
	return registry.TextureMIME(ext)
}
