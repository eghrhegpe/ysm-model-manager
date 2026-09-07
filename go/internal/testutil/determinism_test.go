package testutil

import (
	"path/filepath"
	"reflect"
	"sort"
	"testing"
	"time"
)

func TestSortedKeys_Ordered(t *testing.T) {
	m := map[string]int{"z": 1, "a": 2, "m": 3, "b": 4}
	got := SortedKeys(m)
	want := []string{"a", "b", "m", "z"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("SortedKeys = %v, want %v", got, want)
	}
	if !sort.StringsAreSorted(got) {
		t.Fatalf("SortedKeys 返回未排序: %v", got)
	}
}

func TestSortedKeys_Empty(t *testing.T) {
	if got := SortedKeys(map[string]string{}); len(got) != 0 {
		t.Fatalf("空 map 应返回空切片, got %v", got)
	}
}

func TestSortedKeys_Deterministic(t *testing.T) {
	// 同一 map 多次遍历 key 序随机，但 SortedKeys 输出必须恒定（flaky 根除点）。
	m := map[string]string{"gamma": "1", "alpha": "2", "beta": "3", "delta": "4", "epsilon": "5"}
	first := SortedKeys(m)
	for i := 0; i < 20; i++ {
		if got := SortedKeys(m); !reflect.DeepEqual(got, first) {
			t.Fatalf("SortedKeys 不稳定: 第 %d 次 = %v, 首次 = %v", i, got, first)
		}
	}
}

func TestWithFixedClock_ReturnsFixed(t *testing.T) {
	now := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	var clock = func() time.Time { return time.Now() }
	WithFixedClock(t, &clock, now)
	if got := clock(); !got.Equal(now) {
		t.Fatalf("冻结后 clock() = %v, want %v", got, now)
	}
}

func TestWithFixedClock_RestoresAfterCleanup(t *testing.T) {
	// t.Cleanup 在子测试结束后执行：内层冻结 → 外层验证已恢复。
	fixed := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	var clock = func() time.Time { return time.Now() }
	t.Run("inner", func(t *testing.T) {
		WithFixedClock(t, &clock, fixed)
		if got := clock(); !got.Equal(fixed) {
			t.Fatalf("冻结后 clock() = %v, want %v", got, fixed)
		}
	})
	// 子测试 Cleanup 已恢复为原时钟（time.Now，几乎不可能恰好等于 fixed）。
	if got := clock(); got.Equal(fixed) {
		t.Fatalf("Cleanup 未恢复原时钟: clock() 仍 = %v", got)
	}
}

func TestCleanAbsPath_PosixStyle(t *testing.T) {
	// POSIX 风格段拼接：/repo/mmd/PMX/角色包.zip → 平台原生（Windows 下 \repo\...）
	got := CleanAbsPath(t, "/repo", "mmd", "PMX", "角色包.zip")
	want := filepath.Clean(filepath.Join("/repo", "mmd", "PMX", "角色包.zip"))
	if got != want {
		t.Fatalf("CleanAbsPath = %q, want %q", got, want)
	}
}

func TestCleanAbsPath_NormalizesSlashes(t *testing.T) {
	// 冗余分隔符/当前目录段被 filepath.Clean 归一化。
	got := CleanAbsPath(t, "/repo", "mmd//PMX", ".")
	want := filepath.Clean(filepath.Join("/repo", "mmd", "PMX"))
	if got != want {
		t.Fatalf("CleanAbsPath 未归一化: %q, want %q", got, want)
	}
}
