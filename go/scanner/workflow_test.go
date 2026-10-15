package scanner

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"testing"

	"ysm-model-manager/go/types/registry"
)

// TestGenerateIndexWorkflow_ExtListMatchesRegistry 锁定 CI workflow 与注册表口径：
// workflow 内嵌 Go 脚本的扩展名过滤必须覆盖 registry.AllExts() 全集（.json 单独
// 走 ysm.json 白名单路径）——原手抄清单是注册表之外的第三份平行实现，注册表
// 新增扩展后 CI 重生成索引会静默漏收新类型（code_review 2026-09-06 #4）。
func TestGenerateIndexWorkflow_ExtListMatchesRegistry(t *testing.T) {
	wf := buildGenerateIndexWorkflow()
	for _, ext := range registry.AllExts() {
		if ext == ".json" {
			continue // .json 仅放行 ysm.json，单独判定路径
		}
		if !strings.Contains(wf, `"`+ext+`"`) {
			t.Errorf("workflow 缺注册表扩展 %s——CI 索引会漏收该类型", ext)
		}
	}
	// 禁用后缀恢复与 ysm.json 白名单逻辑必须仍在（防注入清单时顺手删了判定链）
	if !strings.Contains(wf, ".disabled") || !strings.Contains(wf, ".ban") {
		t.Error("workflow 缺 .disabled/.ban 恢复逻辑")
	}
	if !strings.Contains(wf, `"ysm.json"`) {
		t.Error("workflow 缺 ysm.json 白名单")
	}
	// .github 排除口径必须与 Go 侧扫描一致
	if !strings.Contains(wf, ".github") {
		t.Error("workflow 缺 .github 目录排除")
	}
}

// TestGenerateIndexWorkflow_YsmJSONCheckUsesOriginalPath 防「ysm.json 白名单基准写错变量」回归：
// 存量 bug——判定取 filepath.Base(restored)，而普通 ysm.json 无禁用后缀时 restored 是空串
// → filepath.Base("") == "." → 恒不等于 ysm.json → CI 产出的 index.json **不含任何普通
// ysm.json 组条目**（应用内 GenerateRepoIndex 含它们 → 用户点「生成索引」提交后创意工坊
// 静默缺条目）。本用例锁住致病写法不再出现（端到端对账见 MatchesScanEntries）。
func TestGenerateIndexWorkflow_YsmJSONCheckUsesOriginalPath(t *testing.T) {
	wf := buildGenerateIndexWorkflow()
	if strings.Contains(wf, "filepath.Base(restored)") {
		t.Error("ysm.json 判定不得以 restored 为基准（普通 ysm.json 时 restored 为空串 → 全部组条目丢失）")
	}
	if !strings.Contains(wf, "filepath.Base(p)") {
		t.Error("ysm.json 判定须以原路径 p 的 base 为基准")
	}
	// 目录级跳过口径（与 Go 侧 ScanEntries 同步的四项）——判**整条代码行**而非任意文本：
	// 早前用裸片段（".recycle"/".relink-bak-"）会被同文件的中文注释满足，删掉整个跳过分支
	// 也照样绿（自满足断言，2026-10 reviewer 复核指正）。整行判据含谓词与 filepath.SkipDir，
	// 且注释里不可能出现（注释里写不出 `if … { return filepath.SkipDir }` 这种可执行形态）。
	const skipDirLine = `if lowerName == ".recycle" || d.Name() == ".github" || strings.Contains(lowerName, ".relink-bak-") || strings.HasSuffix(lowerName, ".disabled") || strings.HasSuffix(lowerName, ".ban") { return filepath.SkipDir }`
	if !strings.Contains(wf, skipDirLine) {
		t.Errorf("模板缺目录级跳过整行判据（删掉该分支即 CI 把回收站/relink 尸体/禁用载体当活跃条目收进索引）:\n%s", skipDirLine)
	}
	// 条目 Name 口径：ysm.json 组条目须取父目录名（与应用内 buildRepoIndexEntries 同源），
	// 防 CI 回写一份 name 不同的 index.json 与用户提交来回互改。
	if !strings.Contains(wf, "filepath.Base(filepath.Dir(p))") {
		t.Error("模板缺 ysm.json 组条目的父目录名推导（与应用内口径漂移 → 两侧互改 index.json）")
	}
}

// extractWorkflowGenIndex 抽出自 `cat > genindex.go << 'GOEOF'` heredoc 起、至终止行止的
// Go 源，并按 YAML 块标量规则剥掉公共缩进（run: | 的块缩进由首行决定，模板字符串里
// 带的正是这层缩进；不剥则抽出的源码首行带前导空格——Go 允许缩进，但可读性差且
// 与 CI 真实执行形态不符）。
func extractWorkflowGenIndex(t *testing.T, wf string) string {
	t.Helper()
	const begin = "cat > genindex.go << 'GOEOF'"
	const end = "GOEOF"
	lines := strings.Split(wf, "\n")
	start := -1
	for i, l := range lines {
		if strings.TrimSpace(l) == begin {
			start = i + 1
			break
		}
	}
	if start < 0 {
		t.Fatalf("workflow 内找不到 heredoc 起始行 %q", begin)
	}
	indent := ""
	for _, l := range lines[start:] {
		if strings.TrimSpace(l) != "" {
			indent = l[:len(l)-len(strings.TrimLeft(l, " "))]
			break
		}
	}
	body := []string{}
	closed := false
	for _, l := range lines[start:] {
		if strings.TrimSpace(l) == end {
			closed = true
			break
		}
		body = append(body, strings.TrimPrefix(l, indent))
	}
	if !closed {
		t.Fatal("workflow 内 heredoc 未闭合（缺终止行）")
	}
	return strings.Join(body, "\n")
}

// TestGenerateIndexWorkflow_MatchesScanEntries 锁「CI 重生成索引 == 应用内生成索引」不变量：
// 把内嵌模板里的 genindex.go 真跑一遍（最小 stub：临时目录当仓库），与
// buildRepoIndexEntries(ScanEntries(dir)) 逐条对账 **path + name 成对相等**（无放宽项）。
// 防三类回归：① 普通 ysm.json 组条目被 restored 空串判定丢弃；② 模板漏掉 Go 侧
// ScanEntries 的目录级跳过（.recycle / .relink-bak-<ts> / 目录级 .disabled|.ban / .github）
// → 回收站副本、relink 尸体、禁用载体被当活跃条目写进 CI 索引；③ 条目 name 口径漂移
// （ysm.json 组条目须取父目录名）——CI 修复后会真产出并 commit index.json，name 不同即
// 与用户侧提交来回互改、工坊列表把组条目显示成 "ysm.json"（reviewer 2026-10 复核）。
// 断言口径是集合相等而非快照：条目顺序是实现细节，不钉。
// 全等成立的前提是两侧同源：本用例夹具特意含 GroupA/ysm.json（父目录名）与仓库根级
// ysm.json（父目录退化 = 仓库夹名）两类容易漂移的形态，故无「只比 path」的例外类目。
func TestGenerateIndexWorkflow_MatchesScanEntries(t *testing.T) {
	if _, err := exec.LookPath("go"); err != nil {
		t.Skipf("无 go 可执行文件，跳过模板端到端对账: %v", err)
	}
	fixture := t.TempDir()
	fixtureFiles := []string{
		"ysm.json",                                     // 根级 ysm.json：父目录退化 = 仓库夹名（两侧都必须取夹名而非 "."）
		"GroupA/ysm.json",                              // 缺陷主角：普通 ysm.json 组条目（name 取父目录名 GroupA）
		"GroupA/model.geo.json",                        // 同目录非入口 json：两侧都应排除
		"GroupB/model.ysm",                             // 常规模型
		"GroupB/model.ysm.disabled",                    // 文件级禁用：恢复扩展名后仍收，name 用盘上全名
		"GroupC/ysm.json.disabled",                     // 禁用态入口文件：恢复后收，name 用盘上全名（非父目录）
		".recycle/GroupD/ysm.json",                     // 回收站副本：两侧都跳
		".recycle/GroupD/model.ysm",                    // 同上
		"GroupE.disabled/ysm.json",                     // 目录级禁用载体：两侧都跳整棵子树
		"GroupE.disabled/model.ysm",                    // 同上
		"GroupF.relink-bak-1700000000/GroupG/ysm.json", // relink 尸体子树：两侧都跳
		".github/workflows/generate-index.yml",         // workflow 自身：两侧都跳
		"readme.txt",                                   // 非支持扩展名
	}
	for _, rel := range fixtureFiles {
		p := filepath.Join(fixture, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatalf("MkdirAll(%s): %v", p, err)
		}
		if err := os.WriteFile(p, []byte("{}"), 0o644); err != nil {
			t.Fatalf("WriteFile(%s): %v", p, err)
		}
	}

	// Go 侧基准（应用内 GenerateRepoIndex 的条目口径，不经磁盘 index.json）
	type item struct{ Path, Name string }
	want := []item{}
	for _, e := range buildRepoIndexEntries(ScanEntries(fixture), fixture) {
		want = append(want, item{Path: e.Path, Name: e.Name})
	}
	sort.Slice(want, func(i, j int) bool { return want[i].Path < want[j].Path })
	// 防「两侧同错、对账空绿」：基准自身必须含被缺陷丢掉的普通 ysm.json 组条目，
	// 且其 name 必须是父目录名（规范化时若被改成文件名，这里先红）
	// （GroupA/model.geo.json 是反向对照：同目录非入口 json 两侧都必须排除，不在此列）
	for _, must := range []item{
		{Path: "GroupA/ysm.json", Name: "GroupA"},
		{Path: "GroupB/model.ysm", Name: "model.ysm"},
		{Path: "GroupB/model.ysm.disabled", Name: "model.ysm.disabled"},
		{Path: "GroupC/ysm.json.disabled", Name: "ysm.json.disabled"},
		{Path: "ysm.json", Name: filepath.Base(fixture)},
	} {
		if !slices.Contains(want, must) {
			t.Fatalf("Go 侧基准缺 %+v（夹具或 ScanEntries 口径异常）: %+v", must, want)
		}
	}

	// 真跑模板内嵌的 CI 脚本
	genSrc := extractWorkflowGenIndex(t, buildGenerateIndexWorkflow())
	genDir := t.TempDir()
	genPath := filepath.Join(genDir, "genindex.go")
	if err := os.WriteFile(genPath, []byte(genSrc), 0o644); err != nil {
		t.Fatalf("写出抽取的 genindex.go: %v", err)
	}
	cmd := exec.Command("go", "run", genPath)
	cmd.Dir = fixture
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("模板内嵌 CI 脚本执行失败: %v\n%s", err, out)
	}
	raw, err := os.ReadFile(filepath.Join(fixture, "index.json"))
	if err != nil {
		t.Fatalf("CI 未产出 index.json: %v", err)
	}
	var ci []struct {
		Path string `json:"path"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(raw, &ci); err != nil {
		t.Fatalf("index.json 解析失败: %v", err)
	}
	got := make([]item, 0, len(ci))
	for _, e := range ci {
		got = append(got, item{Path: e.Path, Name: e.Name})
	}
	sort.Slice(got, func(i, j int) bool { return got[i].Path < got[j].Path })

	if !slices.Equal(want, got) {
		t.Errorf("CI 索引与应用内扫描口径漂移（path+name 逐条对账）：\n  应用内 = %+v\n  CI    = %+v", want, got)
	}
	if !slices.Contains(got, item{Path: "GroupA/ysm.json", Name: "GroupA"}) {
		t.Error("缺陷回归：CI 索引的普通 ysm.json 组条目缺失或 name 未取父目录名")
	}
}
