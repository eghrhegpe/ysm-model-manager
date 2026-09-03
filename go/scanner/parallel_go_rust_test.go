//go:build rust_backend

package scanner

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"ysm-model-manager/go/rustbridge"
	"ysm-model-manager/go/types"
)

// TestScanEntries_GoRust_CrossEngineParity 锁定生产真实路径的**跨引擎一致性**：
//
// 现状（2026-09-03 实证）：Rust（scan_fast，经 rustbridge.Scan）是 win-amd64 / macOS / Linux
// 生产构建的**主扫描路径**（build/*/Taskfile.yml 均带 -tags rust_backend），Go（scanner.ScanEntries）
// 是其**兜底**（rust_backend.go:35 Rust 报错时静默回退 Go）。两端任一处分叉，后果是：
//  1. 跨平台不一致：win-arm64（仅 Go）vs win-amd64/mac/linux（Rust 主）扫出不同结果；
//  2. 同机瞬态分歧：Rust 偶发失败 → 静默 fallback Go → 同一文件两次扫描结果不同。
//
// 本测试在同一 fixture 上双引擎全量比对，锁死 walk 顺序无关后的**条目集合与逐字段契约**
// （Path 归一 / Ext / Name / Size / ModTime 毫秒 / Hash）。rust_backend_windows_test.go 锁的是
// Rust 内部（manifest vs jwalk，两条皆 Rust）；go/types/parity_test.go 锁的是三个纯谓词向量。
// 二者都不跑「真实 Go 扫描 vs 真实 Rust 扫描」的整树比对——本测试即补此洞。
//
// 范围说明：仅锁 scan_fast↔Go（生产 LIVE 路径）。scan_index_no_hash（scan.rs:30）刻意下钻
// .disabled 目录、属孤儿预留接口、bridge 不消费，其分叉边界由 rust-core/src/tests.rs 单测锁定，
// 不在本测试覆盖内。
func TestScanEntries_GoRust_CrossEngineParity(t *testing.T) {
	base := t.TempDir()
	registryJSON, err := json.Marshal(types.LoadRegistry())
	if err != nil {
		t.Fatalf("marshal registry: %v", err)
	}

	// 跨引擎 fixture：
	//  - hero.ysm            普通模型
	//  - official/ysm.json   模型目录
	//  - hidden.ysm.ban/     禁用目录（生产路径两端都必须跳过）
	//  - nested/sub.ysm      嵌套模型
	writeFile(t, filepath.Join(base, "hero.ysm"), "hero")
	mkDir(t, filepath.Join(base, "official"))
	writeFile(t, filepath.Join(base, "official", "ysm.json"), "{}")
	mkDir(t, filepath.Join(base, "hidden.ysm.ban"))
	writeFile(t, filepath.Join(base, "hidden.ysm.ban", "ghost.ysm"), "ghost")
	mkDir(t, filepath.Join(base, "nested"))
	writeFile(t, filepath.Join(base, "nested", "sub.ysm"), "sub")

	// Go 主扫描（兜底路径）
	goEntries := ScanEntries(base)

	// Rust 主扫描（生产 LIVE 路径，经 scan_fast）
	rustResp, err := rustbridge.Scan(base, registryJSON)
	if err != nil {
		t.Fatalf("rustbridge.Scan 失败: %v", err)
	}
	if len(rustResp.Errors) > 0 {
		t.Fatalf("rustbridge.Scan 返回扫描错误: %v", rustResp.Errors)
	}
	rustEntries := rustResp.Entries

	// 契约 1：两端都必须跳过 .disabled/.ban 禁用目录（ghost.ysm 不得出现）
	for _, e := range append(append([]types.ModelEntry{}, goEntries...), rustEntries...) {
		if strings.Contains(filepath.ToSlash(e.Path), ".ban") ||
			strings.Contains(filepath.ToSlash(e.Path), ".disabled") {
			t.Errorf("禁用目录模型泄漏到扫描结果: %s", e.Path)
		}
	}

	// 契约 2：条目集合与逐字段一致
	assertSameEntrySet(t, base, goEntries, rustEntries)
}

// assertSameEntrySet 将两端条目按「相对 base 的归一路径」建索引后比对。
// 两端 Path 均为基于 base 的绝对路径（Rust=root.join，Go=dir.join），统一 ToSlash 并裁掉 base 前缀，
// 得到与平台/分隔符无关的相对键。
func assertSameEntrySet(t *testing.T, base string, goEntries, rustEntries []types.ModelEntry) {
	t.Helper()
	baseSlash := filepath.ToSlash(base)

	index := func(entries []types.ModelEntry) map[string]types.ModelEntry {
		m := make(map[string]types.ModelEntry, len(entries))
		for _, e := range entries {
			rel := strings.TrimPrefix(filepath.ToSlash(e.Path), baseSlash+"/")
			if rel == filepath.ToSlash(e.Path) { // 已是相对路径，无需裁
				rel = filepath.ToSlash(e.Path)
			}
			if _, dup := m[rel]; dup {
				t.Errorf("同引擎内路径重复: %s", rel)
			}
			m[rel] = e
		}
		return m
	}

	goMap := index(goEntries)
	rustMap := index(rustEntries)

	if len(goMap) != len(rustMap) {
		t.Fatalf("条目数不一致: Go=%d Rust=%d\nGo=%v\nRust=%v",
			len(goMap), len(rustMap), keys(goMap), keys(rustMap))
	}

	// 集合相等（路径键完备）
	for rel := range goMap {
		if _, ok := rustMap[rel]; !ok {
			t.Errorf("Go 有而 Rust 缺: %s", rel)
		}
	}
	for rel := range rustMap {
		if _, ok := goMap[rel]; !ok {
			t.Errorf("Rust 有而 Go 缺: %s", rel)
		}
	}

	// 逐字段契约（walk 顺序无关，按相对键对齐）
	rels := make([]string, 0, len(goMap))
	for rel := range goMap {
		rels = append(rels, rel)
	}
	sort.Strings(rels)
	for _, rel := range rels {
		g := goMap[rel]
		r := rustMap[rel]
		if g.Ext != r.Ext {
			t.Errorf("Path %s: Ext Go=%q Rust=%q", rel, g.Ext, r.Ext)
		}
		if g.Name != r.Name {
			t.Errorf("Path %s: Name Go=%q Rust=%q", rel, g.Name, r.Name)
		}
		if g.Size != r.Size {
			t.Errorf("Path %s: Size Go=%d Rust=%d", rel, g.Size, r.Size)
		}
		if g.ModTime != r.ModTime {
			t.Errorf("Path %s: ModTime(ms) Go=%d Rust=%d", rel, g.ModTime, r.ModTime)
		}
		// Hash：扫描路径两端均不补哈希（scan_fast 语义），应为空且相等；
		// 任一侧若未来回填哈希而另一侧未填，此处立即告警（parity 护栏）。
		if g.Hash != r.Hash {
			t.Errorf("Path %s: Hash Go=%q Rust=%q（扫描路径不应出现哈希分叉）", rel, g.Hash, r.Hash)
		}
	}
}

func keys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("写文件 %s: %v", path, err)
	}
}

func mkDir(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0755); err != nil {
		t.Fatalf("建目录 %s: %v", path, err)
	}
}
