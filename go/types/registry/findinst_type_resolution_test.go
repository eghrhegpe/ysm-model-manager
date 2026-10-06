package registry

import (
	"path/filepath"
	"testing"
)

// ===== FindInstDir / 类型解析的健壮性契约 =====
//
// 背景（gocyclo 拆解时发现的既有隐患）：FindInstDir 用大小写敏感的 RegistryType(rtype)，
// 而 buildInstDirEvidence 经 SupportedExtsForType 走小写回退——两者不同源。rtype 为大小写
// 变体时（前端经绑定入参可传：app_install_instance.go 的 d.RType / rtype、
// resource_bindings.go 的 rtype）extSet 非空而 rt == nil，原实现在 `!rt.ScanInstance`
// 处空指针解引用。buildInstDirEvidence 的注释本就写明「rt 可传 nil（未知类型）」，故正确
// 语义 = 未知类型不走兜底扫描、返回标准路径：兜底扫描会越界读 versionDir 一级目录，而
// 同步/回收站据此做删改，绝不能对未知类型放开。

// 已知类型的大小写变体必须与精确 id 等价——解析收敛到单一来源 resolveRegistryType。
// 锁的是「同一份 rtype 在不同函数里能否解析出类型」的口径一致性：此前 SupportedExtsForType
// 有回退、SubDirMap 有回退、FindInstDir 没有，三者各说各话。
func TestRegistryTypeResolution_CaseVariantEquivalence(t *testing.T) {
	base := RegistryType("ysm")
	if base == nil {
		t.Fatal("前置失败：注册表应含 id=ysm")
	}
	if got := resolveRegistryType("YSM"); got == nil {
		t.Fatal(`resolveRegistryType("YSM") = nil，大小写变体应解析成功`)
	} else if got.ID != base.ID {
		t.Errorf("大小写变体解析到不同类型: %q vs %q", got.ID, base.ID)
	}
	if a, b := SupportedExtsForType("YSM"), SupportedExtsForType("ysm"); len(a) != len(b) {
		t.Errorf("大小写变体扩展集不一致: %v vs %v", a, b)
	}
	if a, b := SubDirMap("YSM"), SubDirMap("ysm"); a != b {
		t.Errorf("大小写变体子目录不一致: %q vs %q", a, b)
	}
	// 未知类型必须解析为 nil（而非 panic 或误命中）——上层据此走安全默认分支。
	for _, id := range []string{"no-such-type", ""} {
		if resolveRegistryType(id) != nil {
			t.Errorf("resolveRegistryType(%q) 应为 nil", id)
		}
	}
}

// 未知 / 空 / 大小写变体的 rtype 都不得 panic，且一律返回标准路径。
func TestFindInstDir_UnknownTypeDoesNotPanic(t *testing.T) {
	for _, rtype := range []string{"no-such-type", "", "YSM"} {
		versionDir := t.TempDir() // 标准子目录不存在 → 必经原实现的 nil 解引用点
		standard := filepath.Join(versionDir, "blueprint")
		if got := FindInstDir(versionDir, "blueprint", rtype); got != standard {
			t.Errorf("rtype=%q: got %q, want %q（未知类型应返回标准路径，不兜底扫描）",
				rtype, got, standard)
		}
	}
}
