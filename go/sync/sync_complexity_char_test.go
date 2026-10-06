// ===== 4 个高复杂度函数（gocyclo 40/37/23/21）拆解的行为特征护栏 =====
// 录制于拆解之前：断言对象只有「返回计数 + logger(name/status/msg 子串) 序列 + 落地文件树」，
// 与内部实现形态无关——拆成 helper 后必须逐字复现。
// 补齐既有 22 个测试文件未覆盖的块：
//   - RelinkDir：仓库索引的备份尸体/空哈希跳过、快照收集的非模型文件过滤、
//     平铺复制失败、目录替换失败回滚（原实现仅靠通用用例间接覆盖）；
//   - SyncToggleStatus：仓库条目越出 filesRoot 时的纯文件名兜底、实例侧非支持扩展名跳过；
//   - PullResources：文件夹级分支的文件复制失败；
//   - SyncCustomToRepo：空源短路、同名去重跳过、复制失败记账。
package sync

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
)

// charEvent 一次 logger 回调的可移植投影：只留 basename 与 status/msg。
// src/dst 为绝对临时路径（含 t.TempDir 随机名），不入断言；size 在所有相关调用点恒 0。
type charEvent struct {
	name   string
	status string
	msg    string
}

// charSink 收集 logger 回调序列，保序（顺序即执行顺序，是行为等价的核心证据）。
type charSink struct {
	events []charEvent
}

func (s *charSink) logger() Logger {
	return func(name, _, _ string, _ int64, status, msg string) {
		s.events = append(s.events, charEvent{name: name, status: status, msg: msg})
	}
}

// digest 渲染为 "name:status;name:status"，供整序列硬断言。
func (s *charSink) digest() string {
	parts := make([]string, 0, len(s.events))
	for _, e := range s.events {
		parts = append(parts, e.name+":"+e.status)
	}
	return strings.Join(parts, ";")
}

// allMsgs 拼接全部 msg，供 strings.Contains 子串断言（msg 含绝对路径，不能整串比对）。
func (s *charSink) allMsgs() string {
	parts := make([]string, 0, len(s.events))
	for _, e := range s.events {
		parts = append(parts, e.msg)
	}
	return strings.Join(parts, " | ")
}

// writeCharFile 建父目录并写入内容（测试样板收敛，避免各处重复 MkdirAll+WriteFile）。
func writeCharFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

// readCharFile 读回文件内容并断言等于 want（零 I/O 意外时直接 Fatal）。
func readCharFile(t *testing.T, path, want string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取 %s 失败: %v", filepath.Base(path), err)
	}
	if string(data) != want {
		t.Errorf("%s 内容被改动: got %q want %q", filepath.Base(path), data, want)
	}
}

// TestChar_RelinkDir_RepoIndexSkipsCorpsesAndHashless 钉住仓库索引构建的过滤语义：
// 备份尸体条目（ADR-296 D3）与空哈希条目都不得成为重链源；同时钉住快照收集阶段
// 对非模型文件（notes.txt）的过滤——它不产生 dirSnaps 条目、主循环也因空哈希跳过。
func TestChar_RelinkDir_RepoIndexSkipsCorpsesAndHashless(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst")
	if err := os.MkdirAll(customDir, 0755); err != nil {
		t.Fatal(err)
	}
	realRepo := filepath.Join(repoRoot, "real.ysm")
	writeCharFile(t, realRepo, "payload")
	corpse := filepath.Join(repoRoot, "ghost.ysm.relink-bak-1", "m.ysm")
	writeCharFile(t, corpse, "corpse")
	noHash := filepath.Join(repoRoot, "nohash.ysm")
	writeCharFile(t, noHash, "nh")
	customModel := filepath.Join(customDir, "ysm.json")
	writeCharFile(t, customModel, "stale")
	notes := filepath.Join(customDir, "notes.txt")
	writeCharFile(t, notes, "notes")

	scanFn := func(dir string) []types.ModelEntry {
		if dir == repoRoot {
			return []types.ModelEntry{
				{Name: "ysm.json", Path: corpse, Hash: "h1"},   // 备份尸体 → 不得入索引
				{Name: "nohash.ysm", Path: noHash, Hash: ""},   // 空哈希 → 不得入索引
				{Name: "ysm.json", Path: realRepo, Hash: "h1"}, // 唯一合法重链源
			}
		}
		return []types.ModelEntry{
			{Name: "ysm.json", Path: customModel, Hash: "h1"}, // 平铺在 customDir 根层
			{Name: "notes.txt", Path: notes, Hash: ""},        // 非模型文件 + 空哈希
		}
	}

	sink := &charSink{}
	count, err := RelinkDir(customDir, repoRoot, "ysm", "hardlink", scanFn, sink.logger())
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}
	if count != 1 {
		t.Errorf("count = %d, want 1（仅 ysm.json 一条走平铺重链）", count)
	}
	if got := sink.digest(); got != "" {
		t.Errorf("重链成功不记 logger，实际 %q", got)
	}
	// 平铺分支的落地物：CopyFileLocked(srcPath, customDir) 保留仓库侧 basename
	readCharFile(t, filepath.Join(customDir, "real.ysm"), "payload")
	// 备份尸体目录必须原样保留（它只是被剔出索引，不是被清理）
	readCharFile(t, corpse, "corpse")
	readCharFile(t, notes, "notes")
}

// TestChar_RelinkDir_FlatCopyFailureLogged 钉住平铺分支的失败记账：
// CopyFileLocked 失败（仓库侧源缺失）→ 记一条 failed「relink 失败」、count 不增、
// 实例侧原文件毫发无损（不因失败而丢文件）。
func TestChar_RelinkDir_FlatCopyFailureLogged(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst")
	if err := os.MkdirAll(repoRoot, 0755); err != nil {
		t.Fatal(err)
	}
	customModel := filepath.Join(customDir, "ysm.json")
	writeCharFile(t, customModel, "keep")
	ghost := filepath.Join(repoRoot, "ghostdir", "ysm.json") // 目录不存在 → CopyFileLocked 失败

	scanFn := func(dir string) []types.ModelEntry {
		if dir == repoRoot {
			return []types.ModelEntry{{Name: "ysm.json", Path: ghost, Hash: "h1"}}
		}
		return []types.ModelEntry{{Name: "ysm.json", Path: customModel, Hash: "h1"}}
	}

	sink := &charSink{}
	count, err := RelinkDir(customDir, repoRoot, "ysm", "hardlink", scanFn, sink.logger())
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}
	if count != 0 {
		t.Errorf("count = %d, want 0", count)
	}
	if got := sink.digest(); got != "ysm.json:failed" {
		t.Errorf("logger 序列 = %q, want \"ysm.json:failed\"", got)
	}
	if msg := sink.allMsgs(); !strings.Contains(msg, "relink 失败") {
		t.Errorf("应为 relink 失败，实际 %q", msg)
	}
	readCharFile(t, customModel, "keep")
}

// TestChar_RelinkDir_DirReplaceFailureRollsBack 钉住目录级替换的失败回滚路径
// （原实现覆盖最薄的块）：rename 备份 → InstallDirLocked 失败 → 删半成品 →
// 回滚 rename → 记一条 failed。断言「原目录与内容完整归来 + 无备份残留 + count 不增」。
func TestChar_RelinkDir_DirReplaceFailureRollsBack(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst")
	if err := os.MkdirAll(repoRoot, 0755); err != nil {
		t.Fatal(err)
	}
	sub := filepath.Join(customDir, "sub")
	writeCharFile(t, filepath.Join(sub, "keep.txt"), "keep")
	customModel := filepath.Join(sub, "ysm.json")
	writeCharFile(t, customModel, "old")
	ghost := filepath.Join(repoRoot, "ghostdir", "ysm.json") // srcDir 缺失 → InstallDirLocked 失败

	scanFn := func(dir string) []types.ModelEntry {
		if dir == repoRoot {
			return []types.ModelEntry{{Name: "ysm.json", Path: ghost, Hash: "h1"}}
		}
		return []types.ModelEntry{{Name: "ysm.json", Path: customModel, Hash: "h1"}}
	}

	sink := &charSink{}
	count, err := RelinkDir(customDir, repoRoot, "ysm", "hardlink", scanFn, sink.logger())
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}
	if count != 0 {
		t.Errorf("count = %d, want 0", count)
	}
	if got := sink.digest(); got != "ysm.json:failed" {
		t.Errorf("logger 序列 = %q, want \"ysm.json:failed\"", got)
	}
	if msg := sink.allMsgs(); !strings.Contains(msg, "relink 失败") {
		t.Errorf("应为 relink 失败，实际 %q", msg)
	}
	// 回滚把整目录原样搬回：目录与其中内容都必须在
	readCharFile(t, filepath.Join(sub, "keep.txt"), "keep")
	readCharFile(t, customModel, "old")
	if matches, _ := filepath.Glob(filepath.Join(customDir, "*.relink-bak-*")); len(matches) != 0 {
		t.Errorf("回滚后不应残留备份目录: %v", matches)
	}
	// 半成品目录（dstBase/<srcDir basename>）必须被清理，不得留下空的 ghostdir
	if _, err := os.Stat(filepath.Join(customDir, "ghostdir")); err == nil {
		t.Error("半成品目录 customDir/ghostdir 应被回滚删除")
	}
}

// TestChar_SyncToggleStatus_RepoOutsideFilesRoot_BaseNameFallback 钉住仓库索引的
// 纯文件名兜底（Path 越出 filesRoot 前缀时）：实例侧同名文件位于子目录（relKey 为
// sub/ysm.json，路径维度必然 miss）、内容又不同（哈希维度 miss），只有 basename
// 兜底能把它关联到仓库的禁用状态。
func TestChar_SyncToggleStatus_RepoOutsideFilesRoot_BaseNameFallback(t *testing.T) {
	base := t.TempDir()
	repoDir := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst")
	if err := os.MkdirAll(repoDir, 0755); err != nil {
		t.Fatal(err)
	}
	// 仓库条目落在 filesRoot 之外（模拟注入的异构 scanFn 结果）
	outsideRepo := filepath.Join(base, "elsewhere", "ysm.json.ban")
	writeCharFile(t, outsideRepo, "AAAA")
	customModel := filepath.Join(customDir, "sub", "ysm.json")
	writeCharFile(t, customModel, "BBBB") // 内容不同 → 哈希兜底必 miss

	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{{Name: "ysm.json.ban", Path: outsideRepo, Hash: computeHash(outsideRepo)}}
	}

	sink := &charSink{}
	disable, enable, err := SyncToggleStatus(customDir, repoDir, scanFn)
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}
	if disable != 1 || enable != 0 {
		t.Errorf("disable/enable = %d/%d, want 1/0（basename 兜底命中禁用）", disable, enable)
	}
	if _, err := os.Stat(customModel + ".disabled"); err != nil {
		t.Errorf("子目录同名文件应被禁用: %v", err)
	}
	if got := sink.digest(); got != "" {
		t.Errorf("成功 rename 不记 logger，实际 %q", got)
	}
}

// TestChar_SyncToggleStatus_UnsupportedExtSkipped 钉住实例目录清单收集的扩展名过滤：
// notes.txt 入不了 fileInfos，任何匹配/改名都不碰它；已同步的 ysm.json 也不动。
func TestChar_SyncToggleStatus_UnsupportedExtSkipped(t *testing.T) {
	base := t.TempDir()
	repoDir := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst")
	repoFile := filepath.Join(repoDir, "ysm.json")
	writeCharFile(t, repoFile, "same")
	customModel := filepath.Join(customDir, "ysm.json")
	writeCharFile(t, customModel, "same")
	notes := filepath.Join(customDir, "notes.txt")
	writeCharFile(t, notes, "notes")

	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{{Name: "ysm.json", Path: repoFile, Hash: computeHash(repoFile)}}
	}

	sink := &charSink{}
	disable, enable, err := SyncToggleStatus(customDir, repoDir, scanFn)
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}
	if disable != 0 || enable != 0 {
		t.Errorf("disable/enable = %d/%d, want 0/0（无状态差异）", disable, enable)
	}
	readCharFile(t, notes, "notes")
	readCharFile(t, customModel, "same")
	if got := sink.digest(); got != "" {
		t.Errorf("logger 序列 = %q, want \"\"", got)
	}
}

// TestChar_PullResources_DirLevelCopyFailure 钉住文件夹级拉取分支的文件复制失败：
// 目标位置被同名**目录**占据（globalDir 侧的非模型目录不成同步单元 → 实例侧文件
// 判为 extra），fsutil.CopyFile 落不去 → 记 failed「拉取失败」+ 返回 ErrPartialSync。
func TestChar_PullResources_DirLevelCopyFailure(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	targetDir := filepath.Join(base, "inst")
	if err := os.MkdirAll(globalDir, 0755); err != nil {
		t.Fatal(err)
	}
	extra := filepath.Join(targetDir, "x.ysm")
	writeCharFile(t, extra, "extra")
	// 同名目录占据目标路径（内含非模型文件 → 不被目级扫描收为同步单元）
	writeCharFile(t, filepath.Join(globalDir, "x.ysm", "readme.txt"), "r")

	sink := &charSink{}
	count, err := PullResources("ysm", globalDir, targetDir, sink.logger())
	if err == nil {
		t.Fatal("目标被目录占据时复制必失败，应返回 ErrPartialSync")
	}
	if !errors.Is(err, ErrPartialSync) {
		t.Errorf("应为 ErrPartialSync，实际 %v", err)
	}
	if count != 0 {
		t.Errorf("count = %d, want 0", count)
	}
	if got := sink.digest(); got != "x.ysm:failed" {
		t.Errorf("logger 序列 = %q, want \"x.ysm:failed\"", got)
	}
	if msg := sink.allMsgs(); !strings.Contains(msg, "拉取失败") {
		t.Errorf("应为拉取失败，实际 %q", msg)
	}
	readCharFile(t, extra, "extra")
}

// TestChar_SyncCustomToRepo_EmptySourceIsNoop 钉住空源短路：不建索引、不落地、不记账。
func TestChar_SyncCustomToRepo_EmptySourceIsNoop(t *testing.T) {
	base := t.TempDir()
	customDir := filepath.Join(base, "inst")
	repoDir := filepath.Join(base, "repo")
	if err := os.MkdirAll(customDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(repoDir, 0755); err != nil {
		t.Fatal(err)
	}
	sink := &charSink{}
	count, err := SyncCustomToRepo(customDir, repoDir, func(string) []types.ModelEntry { return nil }, sink.logger())
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}
	if count != 0 {
		t.Errorf("count = %d, want 0", count)
	}
	if got := sink.digest(); got != "" {
		t.Errorf("logger 序列 = %q, want \"\"", got)
	}
}

// TestChar_SyncCustomToRepo_SkipAndFailureAccounting 钉住收编循环的三态记账：
// 同名去重 skip（不计数、不复制）、复制失败 failed（不计数）、成功 success（计数）。
// 断言仓库侧落地物只有成功那条 —— 失败条目不得留下半成品。
func TestChar_SyncCustomToRepo_SkipAndFailureAccounting(t *testing.T) {
	base := t.TempDir()
	customDir := filepath.Join(base, "inst")
	repoDir := filepath.Join(base, "repo")
	if err := os.MkdirAll(repoDir, 0755); err != nil {
		t.Fatal(err)
	}
	dupName := filepath.Join(customDir, "ysm.json")
	writeCharFile(t, dupName, "dup")
	ghost := filepath.Join(customDir, "ghost.ysm")
	okFile := filepath.Join(customDir, "ok.ysm")
	writeCharFile(t, okFile, "ok")
	repoExisting := filepath.Join(repoDir, "ysm.json")
	writeCharFile(t, repoExisting, "repo-copy")

	scanFn := func(dir string) []types.ModelEntry {
		if dir == repoDir {
			return []types.ModelEntry{{Name: "ysm.json", Path: repoExisting, Hash: "hOther"}}
		}
		return []types.ModelEntry{
			{Name: "ysm.json", Path: dupName, Hash: "h2"}, // 同名 → 跳过
			{Name: "ghost.ysm", Path: ghost, Hash: "h3"},  // 源缺失 → 复制失败
			{Name: "ok.ysm", Path: okFile, Hash: "h4"},    // 落地成功
		}
	}

	sink := &charSink{}
	count, err := SyncCustomToRepo(customDir, repoDir, scanFn, sink.logger())
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}
	if count != 1 {
		t.Errorf("count = %d, want 1", count)
	}
	want := "ysm.json:skipped;ghost.ysm:failed;ok.ysm:success"
	if got := sink.digest(); got != want {
		t.Errorf("logger 序列 = %q, want %q", got, want)
	}
	msg := sink.allMsgs()
	for _, sub := range []string{"仓库已存在同名文件，跳过", "复制失败", "已复制到仓库"} {
		if !strings.Contains(msg, sub) {
			t.Errorf("logger 消息应含 %q，实际 %q", sub, msg)
		}
	}
	readCharFile(t, repoExisting, "repo-copy") // 同名既有文件不得被覆盖
	readCharFile(t, filepath.Join(repoDir, "ok.ysm"), "ok")
	if _, err := os.Stat(filepath.Join(repoDir, "ghost.ysm")); err == nil {
		t.Error("复制失败的条目不应在仓库留下文件")
	}
}
