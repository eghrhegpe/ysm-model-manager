// 对抗测试：tags.Store 路径/标签安全边界——NUL 字节、控制字符、超长、JSON 注入
package tags

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// =====================================================================
// NUL / 控制字符注入
// =====================================================================

// ---------- 1. NUL 字节在 modelPath 中 ----------
func TestStore_SetTags_NULInPath(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)
	// 路径中嵌入 NUL——Linux 上可截断，Windows 上 os 拒绝
	path := filepath.Join(tmpDir, "safe.ysm") + "\x00" + "..\\evil.json"
	err := store.SetTags(path, []string{"test"})
	if err == nil {
		// 未拒绝 → 标签数据内也决不允许出现 NUL key
		store.mu.RLock()
		_, exists := store.data[path]
		store.mu.RUnlock()
		if exists {
			t.Fatalf("BUG(NUL-1): SetTags 接受含 NUL 的路径，tags 内存在该 key")
		}
		t.Fatalf("BUG(NUL-1): SetTags 未报错即接受含 NUL 的路径(path=%q)", path)
	}
	t.Logf("守卫: SetTags NUL 路径被拒绝: %v", err)
}

// ---------- 1b. NUL 字节在 modelPath 中（AddTag/RemoveTag 同 SetTags 安全边界）----------
func TestStore_AddTag_NULInPath(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)
	path := filepath.Join(tmpDir, "safe.ysm") + "\x00" + "..\\evil.json"
	if err := store.AddTag(path, "test"); err == nil {
		t.Fatal("AddTag 应拒绝含 NUL 的 modelPath（与 SetTags 同一安全边界）")
	}
	// 拒绝后不写入内存数据，避免后续 save 落盘 NUL key
	store.mu.RLock()
	_, exists := store.data[path]
	store.mu.RUnlock()
	if exists {
		t.Fatal("AddTag 含 NUL 路径不应写入存储")
	}
}

func TestStore_RemoveTag_NULInPath(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)
	if err := store.SetTags("/m", []string{"x"}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(tmpDir, "safe.ysm") + "\x00" + "..\\evil.json"
	if err := store.RemoveTag(path, "x"); err == nil {
		t.Fatal("RemoveTag 应拒绝含 NUL 的 modelPath（与 SetTags 同一安全边界）")
	}
	// 拒绝后原数据不受影响
	store.mu.RLock()
	tags := store.data["/m"]
	store.mu.RUnlock()
	if len(tags) != 1 || tags[0] != "x" {
		t.Fatalf("RemoveTag 拒绝 NUL 路径后原数据被破坏: %v", tags)
	}
}

// ---------- 2. NUL 字节在 tag 中 ----------
func TestStore_SetTags_NULInTag(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)
	err := store.SetTags("model.ysm", []string{"safe\x00malicious"})
	store.mu.RLock()
	tags := store.data["model.ysm"]
	store.mu.RUnlock()
	if err == nil {
		// 接受路径 → 标签必须已被 trimTag 剔除 NUL
		for _, tag := range tags {
			if strings.Contains(tag, "\x00") {
				t.Fatalf("BUG(INFO-NUL-TAG): tags 内存在含 NUL 的标签")
			}
		}
		t.Log("守卫: trimTag 已剔除 NUL 字节")
	} else {
		t.Logf("守卫: SetTags NUL 标签被拒绝: %v", err)
	}
}

// ---------- 3. 换行符注入 tag（JSON 破坏）----------
func TestStore_SetTags_NewlineInTag(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)
	// 换行符注入——破坏 JSON 结构，导致后续 load 失败
	err := store.SetTags("model.ysm", []string{"safe\ntag2"})
	store.mu.RLock()
	tags := store.data["model.ysm"]
	store.mu.RUnlock()
	if err == nil {
		// 接受路径 → 标签必须已被 trimTag 剔除换行
		for _, tag := range tags {
			if strings.Contains(tag, "\n") {
				t.Fatalf("BUG(INFO-NEWLINE): tags 内存在含换行的标签")
			}
		}
		t.Log("守卫: trimTag 已剔除换行符")
	} else {
		t.Logf("守卫: SetTags 换行标签被拒绝: %v", err)
	}
}

// ---------- 4. 超长标签 ----------
func TestStore_SetTags_ExtremelyLongTag(t *testing.T) {
	tmpDir := t.TempDir()
	store := NewStore(tmpDir)
	longTag := strings.Repeat("a", 100000)
	err := store.SetTags("model.ysm", []string{longTag})
	store.mu.RLock()
	tags := store.data["model.ysm"]
	store.mu.RUnlock()
	if err == nil {
		// 接受路径 → 标签必须已被截断至 maxTagLen
		for _, tag := range tags {
			if len(tag) > maxTagLen {
				t.Fatalf("BUG(INFO-LONG): 标签超长未截断, len=%d", len(tag))
			}
		}
		if len(tags) > 0 {
			t.Logf("守卫: 标签已截断至 %d 字符", len(tags[0]))
		}
	} else {
		t.Logf("守卫: SetTags 超长标签被拒绝: %v", err)
	}
}

// ---------- 5. 空 configDir ----------
// 空 configDir 内存态契约（SetTags 报错 + 绝不落相对路径 tags.json）由
// tags_extra_test.go TestNewStore_EmptyConfigDirMemoryMode 全量断言，
// 原零断言探针已删除（2026-09 测试锐评核实：该测试纯 log 无断言且完全重叠）。

// ---------- 6. configDir 含 NUL ----------
func TestStore_NULInConfigDir(t *testing.T) {
	tmpDir := t.TempDir()
	badDir := tmpDir + "\x00" + "..\\evil"
	store := NewStore(badDir)
	err := store.SetTags("model.ysm", []string{"test"})
	if err == nil {
		// 接受路径 → 保存后 tags.json 决不允许落入当前工作目录。
		// persist 为无锁落盘入口（2026-09 重构后 save 拆分为 commit+persist），
		// 此处直接触发落盘路径即可验证「NUL configDir 不污染 CWD」。
		_ = store.persist([]byte("{}"))
		if _, statErr := os.Stat("tags.json"); statErr == nil {
			os.Remove("tags.json")
			t.Fatalf("BUG(INFO-NUL-CFG): NUL configDir 导致 tags.json 写入当前目录")
		}
	}
	t.Log("守卫: NUL configDir 未污染当前目录")
}
