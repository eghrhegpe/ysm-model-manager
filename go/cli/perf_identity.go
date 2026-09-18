package cli

// perf_identity.go — 性能报告身份块与目标路径解析（ADR-262 D2）。
//
// 立因（2026-09-17）：perf 载荷此前只有 `model`（原始路径串）+ `format`（`detectModelFormat`
// 的扩展名表），于是：
//   - **无 registry 类型 id** → 报告分不清「真实场景里这是什么模型」。扩展名推不出归属：
//     `.zip` 被 14 个类型声明（resourcepack / shaderpack / ysm / …），last-wins 必错；
//     MMD 子类型（EntityPlayer / DefaultMorph / CustomAnim）共享 .vpd/.vmd，也全靠目录归属。
//   - **无相对路径** → 换机器 / 换仓库根后，测试与 AI 无法回溯识别同一条报告。
//   - **无模型形态** → 解包 YSM 目录（目录式）与打包 .ysm（文件式）在报告里长得一样。
//
// 判定**复用** `classifyForScan` 的三段口径（flow.go：目录归属 > 扩展名 > 容器兜底），
// 不另立第四张类型表；`rtype_source` 记录命中来源，便于诊断「凭什么判成这个类型」。
// `format`（YSM/PMX/…）仍是展示标签，不是判定依据。

import (
	"fmt"
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
	// Form 模型形态：dir（解包目录，以 <dir>/ysm.json 为入口）| file（打包容器/单文件）
	Form string `json:"form"`
	// FilesRoot 仓库根（原样透传，供 relPath 参照）
	FilesRoot string `json:"filesRoot,omitempty"`
	// RelPath 相对 FilesRoot 的路径；无法求相对时回落原样路径
	RelPath string `json:"relPath"`
	// AbsPath 绝对路径（诊断用；测试与报告比对请用 relPath）
	AbsPath string `json:"absPath"`
}

// resolveBenchModelTarget 归一化基准测试目标路径（perf 入口的单点，不是各消费方各写分支）。
//
// 目录式模型在仓里有**既有约定**：`scanner.go` 扫描到 `ysm.json` 时把条目 `Name` 取父目录名、
// `Path` 保持 ysm.json 文件路径，且全体消费方（fileops 整组移动/禁用、avatar 元数据、
// importer、app_model 的 `.json` 分支）统一用 `registry.IsYsmEntryJSON` 判定——
// 即「目录式模型由 <dir>/ysm.json 这个**文件路径**标识」。故此处只需把用户/测试传入的
// 目录折叠成该约定路径，下游（ReadFile / AnalyzeBedrockModel / identity / cache）零改动。
//
// 返回 entryPath（喂 ① 读盘与 ② 解析）与 form（file | dir）。
func resolveBenchModelTarget(target string) (entryPath, form string, err error) {
	info, statErr := os.Stat(target)
	if statErr != nil {
		return "", "", statErr
	}
	if !info.IsDir() {
		return target, "file", nil
	}
	entry := filepath.Join(target, "ysm.json")
	if _, err := os.Stat(entry); err != nil {
		return "", "", fmt.Errorf("目录式模型须含 ysm.json 清单，%s 内未找到", target)
	}
	return entry, "dir", nil
}

// buildPerfIdentity 组装身份块。
// reg 为 nil 时现取 `registry.LoadRegistry()`（命令级一次，非 per-file）；
// 传入已加载的 reg 可避免 resource-scan 这类逐文件场景的重复加锁。
func buildPerfIdentity(path, filesRoot string, reg *registry.ResourceTypeRegistry) perfIdentity {
	if reg == nil {
		reg = registry.LoadRegistry()
	}
	ext := strings.ToLower(filepath.Ext(path))

	// 三段判定复用 classifyForScanWithSource（flow.go）——分支顺序只存在那一份，
	// 此处不得复制分支，否则 classifyForScan 变更时 rtype_source 会静默漂移
	rtype, source := classifyForScanWithSource(path, ext, reg)
	// 显示名取自 registry（类型命名单一事实源；前端不得自建映射）
	rtypeLabel := rtypeDisplayName(rtype)

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

	// 形态：以 ysm.json 为入口即目录式（打包形态是 .ysm/.zip/.7z，不会以 ysm.json 结尾）
	form := "file"
	if registry.IsYsmEntryJSON(filepath.Base(path)) {
		form = "dir"
	}

	return perfIdentity{
		Rtype:       rtype,
		RtypeSource: source,
		RtypeLabel:  rtypeLabel,
		Form:        form,
		FilesRoot:   filesRoot,
		RelPath:     relPath,
		AbsPath:     absPath,
	}
}

// perfIdentitySize 取文件字节数；目录式模型的入参是 ysm.json 清单（仅百字节，
// 不代表模型体量）→ 返回 0，避免把清单一角当成模型大小。模型体量看 ④⑤ 阶段字节数。
func perfIdentitySize(path string) int64 {
	if registry.IsYsmEntryJSON(filepath.Base(path)) {
		return 0
	}
	if info, err := os.Stat(path); err == nil && !info.IsDir() {
		return info.Size()
	}
	return 0
}
