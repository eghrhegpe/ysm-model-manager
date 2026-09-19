package cli

// maid_geometry_test.go — 「按类型提升的候选」必须过几何验证（2026-09-19 修复）。
//
// 立因（一个用户可见的假阴性，外加修它的路上埋着的真退化）：
//
//  1. **假阴性**：`perfTypeManifest` 曾声称「只有 YSM 有 CLI 分析链路」，于是
//     `cliAnalyzable("maid-model") == false`——自动挑首个模型（scanFirstModel）、`--target all`、
//     以及用户在面板里显式选「女仆」跑基准，全都被判 `unsupported` 并拒绝采集，提示
//     「CLI 无解析器」。这句是假的：TLM 女仆包 `.zip` 走 `go/geometry` 的 maid L0 清单链路
//     （detectMaidNs / collectMaidManifest / resolveL0），与 YSM 容器同一个 parseBedrockFromZip
//     入口、同样 7 段阶段链（用户在真实仓库实测：961 bones / 7 textures / 4696 cubes）。
//     本文件锁「登记」这一半：女仆包能被真采集。
//
//  2. **只登记清单会让用户结果更差**（故必须成对修）：用户的 14 个 maid 条目全在 `maid-model\`
//     目录下（按 location 归 maid-model），其中 `atri_sound_pack-1.0.0.zip` 是音效包——
//     类型判对了，条目里却没有几何。而 gui-flow 的 scanSummaryByType 只按类型提升首个条目、
//     不校验分析结果，音效包又按路径字典序排在女仆包里最前 → 用户会从今天的「分析 ysm 得 350
//     骨骼」退化成「❌ 分析失败」，并丢掉 ④⑤⑥。本文件锁「顺延」这一半：提升的候选若解析不出
//     几何就换下一个，且如实说明换了谁。
//
// 夹具用 archive/zip 现造（仓库里没有 maid 夹具；`go/geometry/archive_maid_l0_test.go` 有一份
// 同形的最小 maid 包 schema，但 `_test.go` 不可跨包 import，故本包自造一份小 builder）。

import (
	"archive/zip"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/texture_cache"
	"ysm-model-manager/internal/app"
)

// maidMiniGeoJSON 最小合法 bedrock geometry（1 骨骼 1 立方块）——只求「解析得出几何」，
// 不追求覆盖 schema（那是 go/geometry 的职责）。
const maidMiniGeoJSON = `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"reimu","texture_width":64,"texture_height":32},"bones":[{"name":"body","pivot":[0,0,0],"cubes":[{"origin":[0,0,0],"size":[8,8,8],"uv":[0,0],"texture":0}]}]}]}`

// maidZipEntry zip 内单条目。用切片而非 map：map 遍历序不可复现，而 L0 清单解析对条目顺序敏感。
type maidZipEntry struct {
	name string
	body string
}

// writeZip 现造一个 zip。
func writeZip(t *testing.T, path string, entries []maidZipEntry) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("建目录失败: %v", err)
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatalf("建 zip 失败: %v", err)
	}
	defer f.Close()
	w := zip.NewWriter(f)
	for _, e := range entries {
		ww, err := w.Create(e.name)
		if err != nil {
			t.Fatalf("写 zip 条目 %s 失败: %v", e.name, err)
		}
		if _, err := ww.Write([]byte(e.body)); err != nil {
			t.Fatalf("写 zip 条目 %s 失败: %v", e.name, err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatalf("收尾 zip 失败: %v", err)
	}
}

// writeMaidPack 造一个「真有几何」的女仆包，落在 `<root>/maid-model/单女仆/` 下——
// 复现用户仓库的真实目录形态（条目按 location 归 maid-model）。
func writeMaidPack(t *testing.T, root, name string) string {
	t.Helper()
	path := filepath.Join(root, "maid-model", "单女仆", name)
	writeZip(t, path, []maidZipEntry{
		{"assets/touhou/maid_model.json",
			`{"pack_name":"测试女仆包","model":[{"name":"reimu","model":"models/reimu.geo.json","texture":"textures/reimu.png"}]}`},
		{"assets/touhou/models/reimu.geo.json", maidMiniGeoJSON},
		{"assets/touhou/textures/reimu.png", "MAID-PNG"},
	})
	return path
}

// writeSoundPack 造一个「按目录归属是 maid-model、却没有几何」的音效包——实测
// atri_sound_pack-1.0.0.zip 正是这类（✅ 0 bones / 1 texture），且按路径序排在女仆包里最前。
func writeSoundPack(t *testing.T, root, name string) string {
	t.Helper()
	path := filepath.Join(root, "maid-model", "单女仆", name)
	writeZip(t, path, []maidZipEntry{{"assets/touhou/sound.json", `{"sound":"not-a-model"}`}})
	return path
}

// maidFlowApp 造一个带会话根的 app。两处必要性：
//   - AnalyzeBedrockModel 有 isPathInRootOrSelf 路径守卫，临时目录不在用户真实配置的 FilesRoot
//     下会被拒（静默返回空模型，测试会得到「假空」）——故与 CLI 的 `--files-root` 同法走
//     SetSessionFilesRoot（仅内存覆写，不落盘）；
//   - 用 app.NewApp 而非零值 `&app.App{}`：ScanModelEntries 会写操作日志，零值 app 的 logger 为 nil
//     （App.AddOpLog → logs.(*Logger).addOp 空指针）。
func maidFlowApp(t *testing.T, root string) *app.App {
	t.Helper()
	a := app.NewApp()
	a.SetSessionFilesRoot(root)
	return a
}

// TestSingleBench_MatrixByRtype_MaidModelCollected 登记收益：女仆包能被 CLI 采集。
// 原假阴性下这条会拿到 `cli_analyzable=false` + `unsupported=1`（面板显式选「女仆」被拒绝采集，
// 理由「CLI 无解析器」——而这句是假的）。
func TestSingleBench_MatrixByRtype_MaidModelCollected(t *testing.T) {
	root := t.TempDir()
	pack := writeMaidPack(t, root, "yingbai_arknights_pack-1.0.5.zip")
	ctx := &CmdContext{App: &app.App{}, FilesRoot: root}
	spec := perfTargetSpec{Target: perfTargetRtype, Order: perfOrderPath, Rtype: "maid-model", MaxModels: 5, Iterations: 1}

	var err error
	out := captureOutput(t, func() { err = runSingleBenchMatrixJSON(ctx, spec) })
	if err != nil {
		t.Fatalf("矩阵模式报错: %v", err)
	}
	var m singleBenchMatrixJSON
	if err := json.Unmarshal([]byte(out), &m); err != nil {
		t.Fatalf("矩阵载荷不是 JSON: %v\n%s", err, out)
	}
	if m.Spec.Rtype != "maid-model" || !m.Spec.CliAnalyzable {
		t.Errorf("spec 应回显 maid-model 且 cli_analyzable=true: %+v", m.Spec)
	}
	if m.Spec.Unsupported != 0 || m.Spec.Analyzed != 1 {
		t.Errorf("女仆包应被真采集（unsupported=0 / analyzed=1）: %+v", m.Spec)
	}
	if len(m.Models) != 1 {
		t.Fatalf("应出 1 条采集记录: %d", len(m.Models))
	}
	if got := m.Models[0].Identity.Rtype; got != "maid-model" {
		t.Errorf("身份块 rtype 应为 maid-model: %+v", m.Models[0].Identity)
	}
	if len(m.Models[0].Stages) != 7 {
		t.Errorf("女仆包应跑满 7 段阶段链: %d %+v", len(m.Models[0].Stages), m.Models[0].Stages)
	}

	// 自动挑选池的收益：scanBenchTargets 的空 rtype 形态（= scanFirstModel 的候选池）现在含女仆
	// （此前 cliAnalyzable("maid-model")=false，整类被 filterAnalyzable 排除）。
	targets := scanBenchTargets(root, "", 10)
	if len(targets) != 1 || targets[0] != pack {
		t.Errorf("自动挑选池应含女仆包（原假阴性把它整类排除）: %v", targets)
	}
}

// TestGUIFlow_PromotionSkipsCandidateWithoutGeometry 核心：按类型提升的候选若解析不出几何就顺延。
// 场景完全复刻用户仓库：同目录两个 maid 包，路径序第一个是音效包（0 骨骼），第二个才是真模型。
func TestGUIFlow_PromotionSkipsCandidateWithoutGeometry(t *testing.T) {
	withTempCache(t)
	root := t.TempDir()
	sound := writeSoundPack(t, root, "a_sound_pack-1.0.0.zip")
	pack := writeMaidPack(t, root, "b_maid_pack-1.0.0.zip")
	// 预先给**真包**的纹理哈希写入缓存：④ 若命中缓存，就证明它算的是真包的哈希。
	// 这是「④ 必须跑在真正分析成功的 targetModel 上」的可观测判据——顺延只换 ③ 而 ④ 仍拿
	// 首个候选去算，是「换了一半」的隐蔽缺陷（描述里看不出路径）。
	packHash, hashErr := texture_cache.TextureHash(pack)
	if hashErr != nil {
		t.Fatalf("真包纹理哈希失败: %v", hashErr)
	}
	if writeErr := texture_cache.WriteCached(packHash, []byte("ktx2-payload")); writeErr != nil {
		t.Fatalf("写缓存失败: %v", writeErr)
	}
	ctx := &CmdContext{App: maidFlowApp(t, root), FilesRoot: root, Args: []string{"--verbose"}}

	out := captureOutput(t, func() { _ = runGUIFlow(ctx) })

	byName := flowStageNames(t, ctx)
	// 前提（防夹具失真）：② 提升的首个候选确实是那个音效包，否则本用例没测到顺延。
	if scan, ok := byName["② 模型扫描"]; !ok {
		t.Fatalf("② 阶段必须存在: %+v", byName)
	} else if !strings.Contains(strings.Join(scan.Desc, "\n"), filepath.Base(sound)) {
		t.Fatalf("夹具前提不成立：② 提升的首个候选应是音效包 %q: %+v", filepath.Base(sound), scan.Desc)
	}

	three, ok := byName["③ 模型分析"]
	if !ok {
		t.Fatal("③ 阶段必须存在")
	}
	if three.Status != "✅" {
		t.Fatalf("顺延后 ③ 应成功（首个候选无几何，第二个才是真模型）: %+v\n输出:\n%s", three, out)
	}
	joined := strings.Join(three.Desc, "\n")
	if !strings.Contains(joined, "骨骼: 1") {
		t.Errorf("③ 报告的应是**第二个**模型（真有骨骼），而不是空包: %s", joined)
	}
	if !strings.Contains(joined, filepath.Base(pack)) {
		t.Errorf("③ 应点名真正被分析的文件 %q: %s", filepath.Base(pack), joined)
	}
	// 顺延必须如实说明，不静默换模型
	if !strings.Contains(joined, "跳过") || !strings.Contains(joined, filepath.Base(sound)) {
		t.Errorf("③ 应如实说明跳过了哪个候选（%q）: %s", filepath.Base(sound), joined)
	}

	// ④⑤⑥ 必须跑在**真正分析成功**的那个 targetModel 上
	for _, name := range derivedPhaseNames {
		if _, ok := byName[name]; !ok {
			t.Errorf("%s 必须照常产出（它派生自真分析结果，不得因顺延而丢）: %+v", name, byName)
		}
	}
	// ④ 的具体判据：真包的哈希已入缓存 → 必须报「缓存命中」；若 ④ 仍拿首个候选算哈希，这里会红。
	if four, ok := byName["④ 纹理缓存"]; !ok {
		t.Fatalf("④ 阶段必须存在: %+v", byName)
	} else if !strings.Contains(strings.Join(four.Desc, "\n"), "缓存命中") {
		t.Errorf("④ 应算的是真包的哈希（缓存已预置，应命中）——顺延后 targetModel 必须一起更新: %+v", four.Desc)
	}
}

// TestGUIFlow_AllCandidatesWithoutGeometryStaysDataFailure 反向护栏：全部候选都没几何时，
// ③ 仍是失败态，且**不得**把「这条条目里没有几何」说成「CLI 没有该类型的解析链路」——
// 那是把数据问题谎报成能力边界（用户会以为换个工具才能测）。
func TestGUIFlow_AllCandidatesWithoutGeometryStaysDataFailure(t *testing.T) {
	withTempCache(t)
	root := t.TempDir()
	writeSoundPack(t, root, "a_sound_pack-1.0.0.zip")
	ctx := &CmdContext{App: maidFlowApp(t, root), FilesRoot: root, Args: []string{}}

	out := captureOutput(t, func() { _ = runGUIFlow(ctx) })

	byName := flowStageNames(t, ctx)
	three, ok := byName["③ 模型分析"]
	if !ok {
		t.Fatal("③ 阶段必须存在")
	}
	if three.Status != "❌" {
		t.Fatalf("所有候选都解析不出几何时应如实标失败: %+v\n输出:\n%s", three, out)
	}
	joined := strings.Join(three.Desc, "\n")
	if !strings.Contains(joined, "分析失败") {
		t.Errorf("单候选时保留原文案「分析失败」（与今天一致）: %s", joined)
	}
	for _, bad := range []string{"能力边界", "CLI 不模拟", "3D adapter", "解析器只在", "没有该类型的解析链路"} {
		if strings.Contains(joined, bad) {
			t.Errorf("不得把「条目没有几何」谎报成能力边界（命中 %q）: %s", bad, joined)
		}
	}
	for _, name := range derivedPhaseNames {
		if extra, ok := byName[name]; ok {
			t.Errorf("%s 不得产出（③ 没有真数据）: %+v", name, extra)
		}
	}
}

// TestGUIFlow_ExplicitModelNoFallback `--model` 显式指定时**不做顺延**：用户点名要那个模型，
// 换成别的就是答非所问（它无几何时由 ③ 如实报失败）。
func TestGUIFlow_ExplicitModelNoFallback(t *testing.T) {
	withTempCache(t)
	root := t.TempDir()
	sound := writeSoundPack(t, root, "a_sound_pack-1.0.0.zip")
	pack := writeMaidPack(t, root, "b_maid_pack-1.0.0.zip") // 真有几何的候选：顺延被禁时一次都不该被碰
	ctx := &CmdContext{
		App:       maidFlowApp(t, root),
		FilesRoot: root,
		Args:      []string{"--model", sound, "--verbose"},
	}

	out := captureOutput(t, func() { _ = runGUIFlow(ctx) })

	byName := flowStageNames(t, ctx)
	three, ok := byName["③ 模型分析"]
	if !ok {
		t.Fatal("③ 阶段必须存在")
	}
	if three.Status != "❌" {
		t.Fatalf("--model 点名了空包 → ③ 应如实失败，不得顺延: %+v\n输出:\n%s", three, out)
	}
	joined := strings.Join(three.Desc, "\n")
	if !strings.Contains(joined, sound) {
		t.Errorf("③ 应点名用户显式指定的文件: %s", joined)
	}
	if strings.Contains(joined, filepath.Base(pack)) {
		t.Errorf("--model 显式指定时不得偷偷换成别的候选: %s", joined)
	}
	for _, name := range derivedPhaseNames {
		if _, ok := byName[name]; ok {
			t.Errorf("--model 指定的包无几何 → %s 不得产出: %+v", name, byName[name])
		}
	}
}

// TestScanFirstModel_SkipsCandidateWithoutGeometry 同一陷阱的另两个入口（`perf-snapshot` 的
// resolveTargetModel 与 `health --bench`）也必须过几何验证：它们把返回值**直接喂进
// runSingleModelBench**，挑到音效包就是「空模型数据当实测」（与类型白名单同一条诚实红线）。
func TestScanFirstModel_SkipsCandidateWithoutGeometry(t *testing.T) {
	root := t.TempDir()
	writeSoundPack(t, root, "a_sound_pack-1.0.0.zip")
	pack := writeMaidPack(t, root, "b_maid_pack-1.0.0.zip")
	if got := scanFirstModel(maidFlowApp(t, root), root); got != pack {
		t.Errorf("首个候选无几何时应顺延到真有几何的候选: got %q want %q", got, pack)
	}

	// 只有无几何候选时如实返回空串（不得把空模型当「首个可基准模型」）
	only := t.TempDir()
	writeSoundPack(t, only, "a_sound_pack-1.0.0.zip")
	if got := scanFirstModel(maidFlowApp(t, only), only); got != "" {
		t.Errorf("只有无几何的候选时应返回空, got %q", got)
	}
}
