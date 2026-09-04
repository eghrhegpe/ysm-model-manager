package sync

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// ===== SyncToggleStatus 匹配顺序契约（锐评 #7）=====
// 原实现每个实例文件先全量 SHA256（大整合包 × 800ms 防抖持锁哈希饿死安装），
// 且「hash 优先于 relKey」在仓库同内容多位置场景下按内容而非目录树判定。
// 翻转后 relKey（路径对应）→ hash（内容对应，relKey miss 兜底）→ 纯文件名。

// newToggleEnv 构造 SyncToggleStatus 测试标准环境：base/repo/custom 三目录，
// 返回 base 与 repoDir/customDir（对齐 sync_boundary_test.go 同款样板，
// 收敛共享避免 jscpd 复制粘贴债务）。
func newToggleEnv(t *testing.T) (base, repoDir, customDir string) {
	t.Helper()
	base = t.TempDir()
	repoDir = filepath.Join(base, "repo")
	customDir = filepath.Join(base, "custom")
	_ = os.MkdirAll(repoDir, 0755)
	_ = os.MkdirAll(customDir, 0755)
	return base, repoDir, customDir
}

// TestSyncToggleStatus_RelKeyMiss_FallsBackToHash 改名场景回归：
// 实例文件被改名（relKey 与仓库脱钩）时，hash 兜底必须仍能关联到仓库被禁用的
// 同内容文件并禁用——翻转顺序不得破坏「改名后仍跟随仓库启禁」的原语义。
func TestSyncToggleStatus_RelKeyMiss_FallsBackToHash(t *testing.T) {
	_, repoDir, customDir := newToggleEnv(t)

	// repo: model.ysm.ban（已禁用）；实例侧用户把同名文件改名为 mymodel.ysm（仍启用）
	repoFile := filepath.Join(repoDir, "model.ysm.ban")
	if err := os.WriteFile(repoFile, []byte("AAA"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(customDir, "mymodel.ysm"), []byte("AAA"), 0644); err != nil {
		t.Fatal(err)
	}

	hash := computeHash(repoFile)
	if hash == "" {
		t.Fatal("测试前置失败：仓库文件 hash 为空")
	}
	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{
			{Name: "model.ysm.ban", Path: repoFile, Hash: hash},
		}
	}

	disable, enable, err := SyncToggleStatus(customDir, repoDir, scanFn)
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}
	if disable != 1 {
		t.Errorf("改名文件应经 hash 兜底被禁用，disable = %d, want 1", disable)
	}
	if enable != 0 {
		t.Errorf("enable = %d, want 0", enable)
	}
	if _, err := os.Stat(filepath.Join(customDir, "mymodel.ysm.disabled")); err != nil {
		t.Errorf("mymodel.ysm 应被禁用为 .disabled: %v", err)
	}
}

// TestSyncToggleStatus_RelKeyWinsOverHash 仓库同内容多位置场景：
// repo/model_a.ysm（启用）与 repo/model_b.ysm.ban（禁用）内容相同（hash 相同）。
// 实例 custom/model_a.ysm 内容同 repo/model_a——relKey 语义下它显然对应启用状态；
// 原 hash 优先实现会因 repoHash 被 model_b.ban 覆盖为 true 而误禁 model_a
// （同内容文件 model_b 被禁 → 连带禁掉目录树上无关的 model_a）。翻转后 relKey
// 优先，按目录树对应关系判定，不误禁。
func TestSyncToggleStatus_RelKeyWinsOverHash(t *testing.T) {
	_, repoDir, customDir := newToggleEnv(t)

	// 两个仓库文件同内容 A：model_a 启用、model_b 禁用
	repoA := filepath.Join(repoDir, "model_a.ysm")
	repoB := filepath.Join(repoDir, "model_b.ysm.ban")
	if err := os.WriteFile(repoA, []byte("AAA"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(repoB, []byte("AAA"), 0644); err != nil {
		t.Fatal(err)
	}
	// 实例 model_a.ysm 内容同仓库 model_a
	if err := os.WriteFile(filepath.Join(customDir, "model_a.ysm"), []byte("AAA"), 0644); err != nil {
		t.Fatal(err)
	}

	hash := computeHash(repoA)
	if hash == "" || hash != computeHash(repoB) {
		t.Fatal("测试前置失败：两仓库文件应同 hash")
	}
	// 条目顺序固定：model_a 先写 repoHash（false），model_b.ban 后写覆盖（true）
	// ——原 hash 优先实现会读到 true → 误禁 model_a
	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{
			{Name: "model_a.ysm", Path: repoA, Hash: hash},
			{Name: "model_b.ysm.ban", Path: repoB, Hash: hash},
		}
	}

	disable, enable, err := SyncToggleStatus(customDir, repoDir, scanFn)
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}
	if disable != 0 {
		t.Errorf("relKey 对应启用状态，不应误禁 model_a，disable = %d, want 0", disable)
	}
	if enable != 0 {
		t.Errorf("enable = %d, want 0", enable)
	}
	if _, err := os.Stat(filepath.Join(customDir, "model_a.ysm.disabled")); err == nil {
		t.Error("model_a.ysm 不应被禁用（relKey 对应仓库启用文件）")
	}
}
