package cli

// perf_identity.go — 性能报告身份块（ADR-262 D2）。
//
// 立因（2026-09-17）：perf 载荷此前只有 `model`（原始路径串）+ `format`（`detectModelFormat`
// 的扩展名表），于是：
//   - **无 registry 类型 id** → 报告分不清「真实场景里这是什么模型」。扩展名推不出归属：
//     `.zip` 被 14 个类型声明（resourcepack / shaderpack / ysm / …），last-wins 必错；
//     MMD 子类型（EntityPlayer / DefaultMorph / CustomAnim）共享 .vpd/.vmd，也全靠目录归属。
//   - **无相对路径** → 换机器 / 换仓库根后，测试与 AI 无法回溯识别同一条报告。
//
// 判定**复用** `classifyForScan` 的三段口径（flow.go：目录归属 > 扩展名 > 容器兜底），
// 不另立第四张类型表；`rtype_source` 记录命中来源，便于诊断「凭什么判成这个类型」。
// `format`（YSM/PMX/…）仍是展示标签，不是判定依据。

import (
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/types/registry"
)

// perfIdentity 性能报告身份块（字段名与前端 PerfIdentity 逐字对齐）。
//
// FilesRoot / RelPath 成对出现：`filesRoot` 是仓库根（原样透传），`relPath` 相对它。
// 测试只断言 relPath + rtype，不断言绝对路径（跨机器可比）。
type perfIdentity struct {
	// Rtype registry 类型 id（ysm / EntityPlayer / resourcepack / …）；
	// 未命中扩展名归 "other"，容器兜底归 "container"（诚实不猜，见 classifyForScan）
	Rtype string `json:"rtype"`
	// RtypeSource 判定来源：location（祖先目录归属）| extension（扩展名消歧）| container（容器兜底）
	RtypeSource string `json:"rtype_source"`
	// RtypeLabel registry 里的显示名（如「YSM 模型」）；前端只读不判，不自行映射类型
	RtypeLabel string `json:"rtype_label,omitempty"`
	// FilesRoot 仓库根（原样透传，供 relPath 参照）
	FilesRoot string `json:"filesRoot,omitempty"`
	// RelPath 相对 FilesRoot 的路径；无法求相对时回落原样路径
	RelPath string `json:"relPath"`
	// AbsPath 绝对路径（诊断用；测试与报告比对请用 relPath）
	AbsPath string `json:"absPath"`
}

// buildPerfIdentity 组装身份块。
// reg 为 nil 时现取 `registry.LoadRegistry()`（命令级一次，非 per-file）；
// 传入已加载的 reg 可避免 resource-scan 这类逐文件场景的重复加锁。
func buildPerfIdentity(path, filesRoot string, reg *registry.ResourceTypeRegistry) perfIdentity {
	if reg == nil {
		reg = registry.LoadRegistry()
	}
	ext := strings.ToLower(filepath.Ext(path))

	// 来源判定与 classifyForScan 的分支一一对应（顺序不可换：目录归属优先）
	source := "extension"
	rtype := ""
	if id := registry.TypeByLocation(path, reg); id != "" {
		source = "location"
		rtype = id
	} else if registry.IsContainerExt(ext) {
		source = "container"
	}
	if rtype == "" {
		rtype = classifyForScan(path, ext, reg)
	}
	// 显示名取自 registry（类型命名的单一事实源在本表，前端不得自建映射）
	rtypeLabel := ""
	for _, rt := range reg.ResourceTypes {
		if rt.ID == rtype {
			rtypeLabel = rt.Name
			break
		}
	}

	absPath := path
	if a, err := filepath.Abs(path); err == nil {
		absPath = a
	}
	relPath := path
	if filesRoot != "" {
		base := filesRoot
		if b, err := filepath.Abs(filesRoot); err == nil {
			base = b
		}
		if r, err := filepath.Rel(base, absPath); err == nil {
			relPath = filepath.ToSlash(r)
		}
	}

	return perfIdentity{
		Rtype:       rtype,
		RtypeSource: source,
		RtypeLabel:  rtypeLabel,
		FilesRoot:   filesRoot,
		RelPath:     relPath,
		AbsPath:     absPath,
	}
}

// perfIdentitySize 取文件字节数；目录式模型（YSM 解压目录）与不可 stat 路径返回 0。
func perfIdentitySize(path string) int64 {
	if info, err := os.Stat(path); err == nil && !info.IsDir() {
		return info.Size()
	}
	return 0
}
