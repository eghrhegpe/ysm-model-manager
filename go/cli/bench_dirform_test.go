package cli

// bench_dirform_test.go — 目录式模型（解包 YSM 目录）在基准测试里的行为锁（2026-09-17，ADR-262 切片 C）。
//
// 背景（实测发现的三个问题，本文件逐条锁死）：
//  1. 传**目录路径**时 `os.ReadFile` 直接失败，且失败原因被 `avgBenchStages` 丢弃、`stageStatus(0ms)`
//     又把它判成 ok → 全链路失败的 bench 在 JSON 载荷里看起来**全绿**（假绿比红更危险）。
//  2. 目录式模型的入参约定是 `<dir>/ysm.json`（scanner.go 把 ysm.json 条目的 Path 保持文件路径、
//     Name 取父目录名；fileops / avatar / importer / app_model 全体用 IsYsmEntryJSON 判定），
//     但 perf 入口没做归一化 → 仓库 fixtures（全是解包目录）与真实解包模型都喂不进来。
//  3. `detectModelFormat(".../ysm.json")` 走扩展名表返回 "JSON"，与 `identity.rtype = ysm`
//     在同一份报告里互相打架。

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"ysm-model-manager/internal/app"
)

func TestResolveBenchModelTarget(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	entry := filepath.Join(dir, "ysm.json")
	if err := os.WriteFile(entry, []byte("{}"), 0o644); err != nil {
		t.Fatalf("写夹具失败: %v", err)
	}

	got, form, err := resolveBenchModelTarget(dir)
	if err != nil || got != entry || form != "dir" {
		t.Errorf("目录应折叠为 <dir>/ysm.json(d/P): got=%q form=%q err=%v", got, form, err)
	}
	got, form, err = resolveBenchModelTarget(entry)
	if err != nil || got != entry || form != "file" {
		t.Errorf("文件路径应原样透传(file): got=%q form=%q err=%v", got, form, err)
	}

	// 缺 ysm.json 的目录 → 明确报错，而不是静默退化成 ① 读盘失败
	if _, _, err := resolveBenchModelTarget(t.TempDir()); err == nil {
		t.Error("目录内无 ysm.json 应报错")
	}
	if _, _, err := resolveBenchModelTarget(filepath.Join(dir, "nope.ysm")); err == nil {
		t.Error("不存在的路径应报错")
	}
}

// TestStagesToJSON_FailedStageBeatsMsGrading 失败优先于耗时分级（假绿回归锁）：
// 失败阶段常是 0ms，只按 ms 分级会被判 ok，载荷于是「全绿」。
func TestStagesToJSON_FailedStageBeatsMsGrading(t *testing.T) {
	t.Parallel()
	avg := []singleBenchStage{
		{Name: "① 文件读取", Duration: 0, Notes: "❌ 失败: boom", Failed: true},
	}
	stages, _ := stagesToJSON(avg)
	if len(stages) != 1 {
		t.Fatalf("应输出 1 条, got %d", len(stages))
	}
	if stages[0].Status != "failed" {
		t.Errorf("失败阶段不得因 0ms 被判 ok, got status=%q", stages[0].Status)
	}
	if stages[0].Note == "" {
		t.Error("失败原因不得在载荷里丢失")
	}
}

// TestAvgBenchStages_KeepsNotesBytesFailed 平均环节不得吞掉诊断信息（原实现只留 Duration）。
func TestAvgBenchStages_KeepsNotesBytesFailed(t *testing.T) {
	t.Parallel()
	d := func(ms int64) time.Duration { return time.Duration(ms) * time.Millisecond }
	all := [][]singleBenchStage{
		{{Name: "① 清单读取", Duration: d(10), Bytes: 100, Notes: "❌ 失败: 目录不能 ReadFile", Failed: true}},
		{{Name: "① 清单读取", Duration: d(20), Bytes: 300, Notes: "✅ ok"}},
	}
	avg := avgBenchStages(all)
	if len(avg) != 1 {
		t.Fatalf("应按阶段名归并成 1 条, got %d", len(avg))
	}
	got := avg[0]
	if got.Duration != d(15) {
		t.Errorf("耗时取平均: got %v want 15ms", got.Duration)
	}
	if got.Bytes != 200 {
		t.Errorf("字节数取平均: got %d want 200", got.Bytes)
	}
	if !got.Failed {
		t.Error("任一次迭代失败 → 阶段应标记 Failed")
	}
	if got.Notes != "❌ 失败: 目录不能 ReadFile" {
		t.Errorf("应保留首个非空 Notes, got %q", got.Notes)
	}
}

// TestSingleBench_DirFormFixture 目录式 fixture 端到端：传目录与传 ysm.json 等价。
// 夹具 = tests/fixtures/ysm/shen-fengling（ADR-054 的极简目录样本，1.6KB）。
func TestSingleBench_DirFormFixture(t *testing.T) {
	root := filepath.Join("..", "..", "tests", "fixtures", "ysm")
	dir := filepath.Join(root, "shen-fengling")
	entry := filepath.Join(dir, "ysm.json")

	for _, target := range []string{dir, entry} {
		ctx := &CmdContext{App: &app.App{}, FilesRoot: root}
		var runErr error
		out := captureOutput(t, func() {
			runErr = runSingleBenchJSON(ctx, target, 1, "", "", 50)
		})
		if runErr != nil {
			t.Fatalf("target=%s: runSingleBenchJSON 报错: %v", target, runErr)
		}
		var p singleBenchJSON
		if err := json.Unmarshal([]byte(out), &p); err != nil {
			t.Fatalf("载荷不是 JSON: %v\n%s", err, out)
		}
		if p.Model != entry {
			t.Errorf("target=%s: 应归一化为 <dir>/ysm.json, got %q", target, p.Model)
		}
		if p.Identity.Form != "dir" {
			t.Errorf("target=%s: identity.form 应为 dir, got %q", target, p.Identity.Form)
		}
		if p.Identity.Rtype != "ysm" || p.Identity.RtypeLabel != "YSM 模型" {
			t.Errorf("target=%s: 目录式类别应为 ysm/YSM 模型, got %q/%q",
				target, p.Identity.Rtype, p.Identity.RtypeLabel)
		}
		// 3：format 不得与 rtype 打架（旧实现按扩展名报 JSON）
		if p.Format != "YSM" {
			t.Errorf("target=%s: ysm.json 的 format 应为 YSM, got %q", target, p.Format)
		}
		// 清单字节数不代表模型体量
		if p.SizeBytes != 0 {
			t.Errorf("target=%s: 目录式模型 size_bytes 应为 0（清单一角）, got %d", target, p.SizeBytes)
		}
		// 目录式也能跑满链路（① 清单读取 + ② ~ ⑦）
		if len(p.Stages) < 6 {
			t.Errorf("target=%s: 目录式模型应跑满阶段链, got %d 阶段: %+v", target, len(p.Stages), p.Stages)
		}
		if len(p.Stages) > 0 && p.Stages[0].Name != "① 清单读取" {
			t.Errorf("target=%s: 首阶段应如实标为清单读取, got %q", target, p.Stages[0].Name)
		}
		for _, s := range p.Stages {
			if s.Status == "failed" {
				t.Errorf("target=%s: 阶段不应失败: %+v", target, s)
			}
			if s.Note == "" {
				t.Errorf("target=%s: 阶段 %s 的 Note 不应为空（平均环节丢失诊断信息）", target, s.Name)
			}
		}
	}
}
