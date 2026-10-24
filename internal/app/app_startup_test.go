package app

import (
	"os"
	"path"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
	"ysm-model-manager/internal/testutil"
)

// ===== ServiceStartup 抽取出的可判逻辑（生命周期壳需 Wails runtime，无法直测）=====

// TestIsWindowOffscreen 双屏切换残留坐标判据：阈值 ±(-200)/4000 边界逐条钉死。
// 语义敏感点：恰好等于阈值属「屏幕内」（严格不等号），把合法单屏窗口判出屏幕外
// 会让窗口每次启动都被强行居中，用户位置偏好静默丢失。
func TestIsWindowOffscreen(t *testing.T) {
	cases := []struct {
		name       string
		x, y       int
		wantOffscr bool
	}{
		{"主屏左上角(0,0)合法", 0, 0, false},
		{"双屏右侧副屏内", 2560, 100, false},
		{"恰好等于负阈值-200算屏内", -200, -200, false},
		{"恰好等于正阈值4000算屏内", 4000, 4000, false},
		{"X越过负阈值1像素", -201, 0, true},
		{"Y越过负阈值1像素", 0, -201, true},
		{"X越过正阈值1像素", 4001, 0, true},
		{"Y越过正阈值1像素", 0, 4001, true},
		{"副屏未连接残留(极负)", -3000, -3000, true},
		{"仅X越界也判屏外", 9999, 100, true},
		{"仅Y越界也判屏外", 100, 9999, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			testutil.Equal(t, isWindowOffscreen(tc.x, tc.y), tc.wantOffscr, "isWindowOffscreen(%d, %d)", tc.x, tc.y)
		})
	}
}

// TestResolveStartupConfigBootstrap 启动期配置补齐判据 4 象限：
// 「配置文件缺失」与「McRoot 缺失」任一成立即需落盘，且 McRoot 只在为空时被探测结果补齐。
func TestResolveStartupConfigBootstrap(t *testing.T) {
	t.Run("配置缺失+McRoot空→写盘并补齐首个探测结果", func(t *testing.T) {
		cfg := types.AppConfig{}
		calls := 0
		discover := func() []string { calls++; return []string{"/mc/one", "/mc/two"} }
		testutil.Equal(t, resolveStartupConfigBootstrap(&cfg, true, discover), true, "配置缺失应要求写盘")
		testutil.Equal(t, calls, 1, "McRoot 为空应探测 1 次")
		testutil.Equal(t, cfg.McRoot, "/mc/one", "应取探测结果首个")
	})

	t.Run("配置存在+McRoot空+探测到→写盘并补齐", func(t *testing.T) {
		cfg := types.AppConfig{}
		testutil.Equal(t, resolveStartupConfigBootstrap(&cfg, false, func() []string { return []string{"/mc/found"} }), true, "McRoot 由空补上应要求写盘")
		testutil.Equal(t, cfg.McRoot, "/mc/found", "McRoot")
	})

	t.Run("配置存在+McRoot空+探测无果→不写盘", func(t *testing.T) {
		cfg := types.AppConfig{}
		testutil.Equal(t, resolveStartupConfigBootstrap(&cfg, false, func() []string { return nil }), false, "无任何变更时不应写盘")
		testutil.Equal(t, cfg.McRoot, "", "探测无果不应改写 McRoot")
	})

	t.Run("配置存在+McRoot已设→不写盘且不探测", func(t *testing.T) {
		cfg := types.AppConfig{McRoot: "/mc/user"}
		calls := 0
		discover := func() []string { calls++; return []string{"/mc/other"} }
		testutil.Equal(t, resolveStartupConfigBootstrap(&cfg, false, discover), false, "配置完好时不应写盘")
		testutil.Equal(t, calls, 0, "McRoot 已设时不应探测（惰性）")
		testutil.Equal(t, cfg.McRoot, "/mc/user", "不应覆盖用户配置")
	})
}

// TestStorageSubdirRelPaths 注册表→存储子目录派生：声明序去重 + 空 StorageSubDir 跳过。
// ADR-092 两层路由：有 group 走 {group}/{subDir}，无 group 单级平铺。
func TestStorageSubdirRelPaths(t *testing.T) {
	t.Run("空列表返回空", func(t *testing.T) {
		testutil.Equal(t, len(storageSubdirRelPaths(nil)), 0, "nil 应返回空")
	})

	// 未登记 ID 时 GroupStorageRoot 回落为 ID 本身（registry 契约），
	// 故用幽灵 ID 隔离「跳过 / 顺序 / 去重」的纯逻辑，不受 resource_types.json 波动影响。
	t.Run("StorageSubDir为空跳过+声明序去重", func(t *testing.T) {
		got := storageSubdirRelPaths([]registry.ResourceType{
			{ID: "ghost-skip"},                      // 存量子目录为空 → 跳过（先判空，不走路由查询）
			{ID: "ghost-a", StorageSubDir: "sub-a"}, // 保留
			{ID: "ghost-b", StorageSubDir: "sub-b"}, // 保留：声明序在 a 之后
			{ID: "ghost-a", StorageSubDir: "sub-a"}, // 重复 → 只保留首次
		})
		testutil.Equal(t, got, []string{"ghost-a", "ghost-b"}, "派生结果")
	})

	// 真实注册表：与独立推导（用 GroupOf + StorageSubDir 而非 GroupStorageRoot）逐项对账，
	// 防「漏类型 / 顺序错 / 分组前缀丢」——两路独立推导同源则一致。
	t.Run("真实注册表与独立推导一致", func(t *testing.T) {
		reg := registry.LoadRegistry()
		var want []string
		seen := make(map[string]bool, len(reg.ResourceTypes))
		grouped := false
		for _, rt := range reg.ResourceTypes {
			if rt.StorageSubDir == "" {
				continue
			}
			rel := rt.StorageSubDir
			if g := registry.GroupOf(rt.ID); g != "" {
				rel = path.Join(g, rt.StorageSubDir)
				grouped = true
			}
			if seen[rel] {
				continue
			}
			seen[rel] = true
			want = append(want, rel)
		}
		testutil.Equal(t, grouped, true, "注册表应存在带 group 的类型（ADR-092 两层路由未生效？）")
		testutil.Equal(t, storageSubdirRelPaths(reg.ResourceTypes), want, "数量不符 / 逐位对账")
	})
}

// TestEnsureStorageSubdirs 落盘建目录：真实临时目录验证「建出来了」+ 幂等重入。
func TestEnsureStorageSubdirs(t *testing.T) {
	root := t.TempDir()
	rels := []string{"minecraft-mod/ysm", "mmd/EntityPlayer"}
	ensureStorageSubdirs(root, rels)
	for _, rel := range rels {
		info, err := os.Stat(filepath.Join(root, rel))
		testutil.NoError(t, err, "子目录 %s 未创建", rel) // 前置守卫：err==nil 时 info 才非 nil，下一行解引用安全
		testutil.Equal(t, info.IsDir(), true, "%s 不是目录", rel)
	}
	// 重复调用不得报错（MkdirAll 幂等）：第二次仍应静默通过
	ensureStorageSubdirs(root, rels)
}

// TestStorageSubdirPolicyFromRegistry 真实注册表派生结果固化：非空、无重复、全部为
// 相对路径（不含盘符/绝对前缀），保证 ServiceStartup 建目录清单与注册表同源。
func TestStorageSubdirPolicyFromRegistry(t *testing.T) {
	rels := storageSubdirRelPaths(registry.LoadRegistry().ResourceTypes)
	testutil.Equal(t, len(rels) == 0, false, "真实注册表应派生出至少一个存储子目录")
	seen := make(map[string]bool, len(rels))
	for _, rel := range rels {
		testutil.Equal(t, rel == "", false, "派生出空子目录路径")
		testutil.Equal(t, filepath.IsAbs(rel), false, "应为相对 FilesRoot 的子路径, got %q", rel)
		testutil.Equal(t, seen[rel], false, "派生结果重复: %q", rel)
		seen[rel] = true
	}
}
