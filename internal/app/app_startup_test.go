package app

import (
	"os"
	"path"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
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
			if got := isWindowOffscreen(tc.x, tc.y); got != tc.wantOffscr {
				t.Fatalf("isWindowOffscreen(%d, %d) = %v, want %v", tc.x, tc.y, got, tc.wantOffscr)
			}
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
		if !resolveStartupConfigBootstrap(&cfg, true, discover) {
			t.Fatal("配置缺失应要求写盘")
		}
		if calls != 1 {
			t.Fatalf("McRoot 为空应探测 1 次，实际 %d", calls)
		}
		if cfg.McRoot != "/mc/one" {
			t.Fatalf("应取探测结果首个，got %q", cfg.McRoot)
		}
	})

	t.Run("配置存在+McRoot空+探测到→写盘并补齐", func(t *testing.T) {
		cfg := types.AppConfig{}
		if !resolveStartupConfigBootstrap(&cfg, false, func() []string { return []string{"/mc/found"} }) {
			t.Fatal("McRoot 由空补上应要求写盘")
		}
		if cfg.McRoot != "/mc/found" {
			t.Fatalf("McRoot = %q, want /mc/found", cfg.McRoot)
		}
	})

	t.Run("配置存在+McRoot空+探测无果→不写盘", func(t *testing.T) {
		cfg := types.AppConfig{}
		if resolveStartupConfigBootstrap(&cfg, false, func() []string { return nil }) {
			t.Fatal("无任何变更时不应写盘")
		}
		if cfg.McRoot != "" {
			t.Fatalf("探测无果不应改写 McRoot，got %q", cfg.McRoot)
		}
	})

	t.Run("配置存在+McRoot已设→不写盘且不探测", func(t *testing.T) {
		cfg := types.AppConfig{McRoot: "/mc/user"}
		calls := 0
		discover := func() []string { calls++; return []string{"/mc/other"} }
		if resolveStartupConfigBootstrap(&cfg, false, discover) {
			t.Fatal("配置完好时不应写盘")
		}
		if calls != 0 {
			t.Fatalf("McRoot 已设时不应探测（惰性），实际调用 %d 次", calls)
		}
		if cfg.McRoot != "/mc/user" {
			t.Fatalf("不应覆盖用户配置，got %q", cfg.McRoot)
		}
	})
}

// TestStorageSubdirRelPaths 注册表→存储子目录派生：声明序去重 + 空 StorageSubDir 跳过。
// ADR-092 两层路由：有 group 走 {group}/{subDir}，无 group 单级平铺。
func TestStorageSubdirRelPaths(t *testing.T) {
	t.Run("空列表返回空", func(t *testing.T) {
		if got := storageSubdirRelPaths(nil); len(got) != 0 {
			t.Fatalf("nil 应返回空，got %v", got)
		}
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
		want := []string{"ghost-a", "ghost-b"}
		if len(got) != len(want) {
			t.Fatalf("派生结果: got %v, want %v", got, want)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("第 %d 位: got %q, want %q（全量 got=%v）", i, got[i], want[i], got)
			}
		}
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
		if !grouped {
			t.Fatal("注册表应存在带 group 的类型（ADR-092 两层路由未生效？）")
		}
		got := storageSubdirRelPaths(reg.ResourceTypes)
		if len(got) != len(want) {
			t.Fatalf("数量不符: got %d %v, want %d %v", len(got), got, len(want), want)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("第 %d 位: got %q, want %q", i, got[i], want[i])
			}
		}
	})
}

// TestEnsureStorageSubdirs 落盘建目录：真实临时目录验证「建出来了」+ 幂等重入。
func TestEnsureStorageSubdirs(t *testing.T) {
	root := t.TempDir()
	rels := []string{"minecraft-mod/ysm", "mmd/EntityPlayer"}
	ensureStorageSubdirs(root, rels)
	for _, rel := range rels {
		info, err := os.Stat(filepath.Join(root, rel))
		if err != nil {
			t.Fatalf("子目录 %s 未创建: %v", rel, err)
		}
		if !info.IsDir() {
			t.Fatalf("%s 不是目录", rel)
		}
	}
	// 重复调用不得报错（MkdirAll 幂等）：第二次仍应静默通过
	ensureStorageSubdirs(root, rels)
}

// TestStorageSubdirPolicyFromRegistry 真实注册表派生结果固化：非空、无重复、全部为
// 相对路径（不含盘符/绝对前缀），保证 ServiceStartup 建目录清单与注册表同源。
func TestStorageSubdirPolicyFromRegistry(t *testing.T) {
	rels := storageSubdirRelPaths(registry.LoadRegistry().ResourceTypes)
	if len(rels) == 0 {
		t.Fatal("真实注册表应派生出至少一个存储子目录")
	}
	seen := make(map[string]bool, len(rels))
	for _, rel := range rels {
		if rel == "" {
			t.Fatal("派生出空子目录路径")
		}
		if filepath.IsAbs(rel) {
			t.Fatalf("应为相对 FilesRoot 的子路径，got 绝对路径 %q", rel)
		}
		if seen[rel] {
			t.Fatalf("派生结果重复: %q", rel)
		}
		seen[rel] = true
	}
}
