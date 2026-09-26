// ===== repoaudit 共享包测试 =====
// 覆盖：空仓库审计 / 坏模型扣分 / 去重汇总（HealthReportFor）。
// 策略：临时目录 + 零配置,不触碰真实用户配置/缓存。
package repoaudit

import (
	"context"
	"errors"
	"fmt"
	"ysm-model-manager/go/internal/testutil"

	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"ysm-model-manager/go/types/registry"
)

func TestAudit_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	result, err := Audit(dir)
	if err != nil {
		t.Fatalf("Audit(empty) 应成功, got %v", err)
	}
	if result.Score != 100 {
		t.Errorf("空仓库分数应为 100, got %d", result.Score)
	}
	if result.Completeness.Checked != 0 {
		t.Errorf("空仓库不应有完整性检查, got %d", result.Completeness.Checked)
	}
	if result.Resources.TotalFiles != 0 {
		t.Errorf("空仓库文件数应为 0, got %d", result.Resources.TotalFiles)
	}
}

func TestAudit_BadModelLowersScore(t *testing.T) {
	dir := t.TempDir()
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "broken.ysm"), []byte("not json"))

	result, err := Audit(dir)
	if err != nil {
		t.Fatalf("Audit 应成功, got %v", err)
	}
	if result.Completeness.Checked != 1 || result.Completeness.Invalid != 1 {
		t.Errorf("坏模型应记为 1 无效, got checked=%d invalid=%d", result.Completeness.Checked, result.Completeness.Invalid)
	}
	if result.Score >= 100 {
		t.Errorf("坏模型应扣分（score<100）, got score=%d", result.Score)
	}
	if len(result.Warnings) == 0 {
		t.Error("坏模型应产生完整性警告")
	}
}

// ===== 锐评④：健康分判级单源（ScoreVerdict / Verdict 字段）=====

func TestScoreVerdict(t *testing.T) {
	cases := []struct {
		score int
		want  string
		why   string
	}{
		{100, VerdictGood, "满分"},
		{80, VerdictGood, "good 下边界（含）"},
		{79, VerdictOk, "good 边界外一档"},
		{60, VerdictOk, "ok 下边界（含）"},
		{59, VerdictBad, "ok 边界外一档"},
		{30, VerdictBad, "扣分下限"},
		{0, VerdictBad, "全仓审计失败时合并分为 0"},
		{-5, VerdictBad, "负分兜底（理论不可达，防越界判 good）"},
	}
	for _, c := range cases {
		if got := ScoreVerdict(c.score); got != c.want {
			t.Errorf("ScoreVerdict(%d) = %q, 期望 %q（%s）", c.score, got, c.want, c.why)
		}
	}
}

// TestCalculateAuditScore_Formula 钉死扣分公式：真实 Audit 依赖全局 texture_cache
// 状态（CacheFiles 在不同机器上不同），这里直接构造 DirAuditResult 做纯函数测试，
// 把「完整性比例折算 / 无效数 / 无缓存 / 超大文件 / 下限」五档扣分开合清楚。
func TestCalculateAuditScore_Formula(t *testing.T) {
	mk := func(pct float64, valid, invalid, total, cacheFiles int, largest int64) DirAuditResult {
		r := DirAuditResult{}
		r.Completeness.Percentage = pct
		r.Completeness.Valid = valid
		r.Completeness.Invalid = invalid
		r.Resources.TotalFiles = total
		r.Cache.CacheFiles = cacheFiles
		r.Resources.LargestSize = largest
		return r
	}
	const mb = 1024 * 1024
	cases := []struct {
		name string
		res  DirAuditResult
		want int
	}{
		{"满分（无缓存也不扣：TotalFiles=0）", mk(100, 0, 0, 0, 0, 0), 100},
		{"有资源但零缓存扣 20", mk(100, 5, 0, 5, 0, 0), 80},
		{"有资源有缓存不扣", mk(100, 5, 0, 5, 3, 0), 100},
		{"完整性 90% 扣 5", mk(90, 9, 0, 9, 3, 0), 95},
		{"1 个无效扣 5", mk(100, 9, 1, 10, 3, 0), 95},
		{"499MB 不触发超大扣分", mk(100, 1, 0, 1, 3, 499*mb), 100},
		{"501MB 扣 10", mk(100, 1, 0, 1, 3, 501*mb), 90},
		{
			"叠加：80% 完整性 + 4 无效 + 无缓存 + 超大",
			mk(80, 8, 4, 12, 0, 600*mb),
			100 - 10 - 20 - 20 - 10,
		},
		{"多问题叠加触底 scoreFloor=30", mk(50, 10, 20, 30, 0, 900*mb), 30},
	}
	for _, c := range cases {
		if got := calculateAuditScore(c.res); got != c.want {
			t.Errorf("%s: calculateAuditScore = %d, 期望 %d", c.name, got, c.want)
		}
	}
}

// TestAudit_RealFiles_ScoreExact 真实文件落盘 → 精确分值钉死（用户明确要求覆盖
// 「真实文件的情况」）。缓存扣分项从 Audit 实际返回的 Cache.CacheFiles 推出，
// 使断言在全新沙盒与已有缓存的开发机上同样确定。
func TestAudit_RealFiles_ScoreExact(t *testing.T) {
	dir := t.TempDir()
	// 10 个有效 + 2 个无效 .ysm：完整性 10/12 ≈ 83.33% → 扣 int(16.67*0.5)=8；无效 2 → 扣 10
	for i := 0; i < 10; i++ {
		name := filepath.Join(dir, fmt.Sprintf("ok%d.ysm", i))
		testutil.WriteTestFileBytes(t, name,
			[]byte(`{"format_version":"1.16.0","minecraft:geometry":[]}`))
	}
	for i := 0; i < 2; i++ {
		name := filepath.Join(dir, fmt.Sprintf("bad%d.ysm", i))
		testutil.WriteTestFileBytes(t, name, []byte(`{"foo":"bar"}`))
	}

	res, err := Audit(dir)
	if err != nil {
		t.Fatalf("Audit 应成功, got %v", err)
	}
	if res.Completeness.Checked != 12 || res.Completeness.Valid != 10 || res.Completeness.Invalid != 2 {
		t.Fatalf("完整性统计错位: checked=%d valid=%d invalid=%d",
			res.Completeness.Checked, res.Completeness.Valid, res.Completeness.Invalid)
	}

	cacheDed := 0
	if res.Cache.CacheFiles == 0 {
		cacheDed = 20
	}
	want := 100 - int((100-res.Completeness.Percentage)*0.5) - 2*5 - cacheDed
	if res.Score != want {
		t.Errorf("Score = %d, 按公式期望 %d（pct=%.2f cacheFiles=%d）",
			res.Score, want, res.Completeness.Percentage, res.Cache.CacheFiles)
	}
	// 判级必须与分数同源一致（前端只读 verdict，二者背离即为缺陷）
	if v := ScoreVerdict(res.Score); v != ScoreVerdict(want) {
		t.Errorf("verdict 派生不一致: score=%d v=%s, want=%d v=%s", res.Score, v, want, ScoreVerdict(want))
	}
}

// TestHealthReportFor_VdictFilled HealthReportFor 必须带 verdict（否则前端
// parseHealthReport 直接判为畸形报告）
func TestHealthReportFor_VerdictFilled(t *testing.T) {
	dir := t.TempDir()
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "ok.ysm"),
		[]byte(`{"format_version":"1.16.0","minecraft:geometry":[]}`))

	rep, err := HealthReportFor(dir)
	if err != nil {
		t.Fatalf("HealthReportFor 应成功, got %v", err)
	}
	if rep.Verdict != ScoreVerdict(rep.Score) {
		t.Errorf("Verdict = %q, 期望 %q（score=%d）", rep.Verdict, ScoreVerdict(rep.Score), rep.Score)
	}
	switch rep.Verdict {
	case VerdictGood, VerdictOk, VerdictBad:
	default:
		t.Errorf("Verdict = %q 不在值域 {good,ok,bad}", rep.Verdict)
	}
}

// TestAudit_StructuralInvalid 结构损坏但可解析 JSON——校验加严后应判无效（防完整性假绿）
func TestAudit_StructuralInvalid(t *testing.T) {
	dir := t.TempDir()
	// 合法 JSON 但无 format_version/minecraft:geometry/bones 字段
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "bad.ysm"), []byte(`{"foo": "bar"}`))

	result, err := Audit(dir)
	if err != nil {
		t.Fatalf("Audit 应成功, got %v", err)
	}
	if result.Completeness.Valid != 0 || result.Completeness.Invalid != 1 {
		t.Errorf("缺 format_version 的 JSON 应判无效, got valid=%d invalid=%d",
			result.Completeness.Valid, result.Completeness.Invalid)
	}

	// 对照组：含 format_version 的合法模型
	dir2 := t.TempDir()
	testutil.WriteTestFileBytes(t, filepath.Join(dir2, "ok.ysm"), []byte(`{"format_version":"1.16.0","minecraft:geometry":[]}`))
	result2, err := Audit(dir2)
	if err != nil {
		t.Fatalf("Audit(ok) 应成功, got %v", err)
	}
	if result2.Completeness.Valid != 1 || result2.Completeness.Invalid != 0 {
		t.Errorf("含 format_version 应判有效, got valid=%d invalid=%d",
			result2.Completeness.Valid, result2.Completeness.Invalid)
	}
}

// TestAudit_NestedDir 嵌套子目录遍历（文件夹型模型仓库常见布局）
// TestAudit_NestedDir 嵌套目录应统计 2 个文件
func TestAudit_NestedDir(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "模型A", "textures")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "模型A", "model.json"), []byte(`{"format_version":"1.16.0","minecraft:geometry":[]}`))
	testutil.WriteTestFileBytes(t, filepath.Join(sub, "tex.png"), []byte("png"))

	result, err := Audit(dir)
	if err != nil {
		t.Fatalf("Audit 应成功, got %v", err)
	}
	if result.Resources.TotalFiles != 2 {
		t.Errorf("嵌套目录应统计 2 个文件, got %d", result.Resources.TotalFiles)
	}
	if result.Completeness.Valid != 1 {
		t.Errorf("嵌套内合法 model.json 应判有效, got valid=%d", result.Completeness.Valid)
	}
}

// TestAudit_ByTypeLocationRouting 仓库体检 ByType 统计走 location 路由：
// mmd/PMX 目录下 zip 模型包归 EntityPlayer（此前纯 Classify(".zip") last-wins
// 归 DefaultMorph——217 个 PMX 包误统计，2026-08-23 同源修复）。
func TestAudit_ByTypeLocationRouting(t *testing.T) {
	dir := t.TempDir()
	pmxDir := filepath.Join(dir, "mmd", "PMX", "2.大学学姐")
	if err := os.MkdirAll(pmxDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// 模型包 zip + 表情 vpd + 裸 pmx（写最小合法 zip 内容即可，审计不校验内容）
	testutil.WriteTestFileBytes(t, filepath.Join(pmxDir, "角色包.zip"), []byte("PK\x03\x04"))
	testutil.WriteTestFileBytes(t, filepath.Join(pmxDir, "表情.vpd"), []byte("vpd"))
	testutil.WriteTestFileBytes(t, filepath.Join(pmxDir, "角色.pmx"), []byte("pmx"))

	result, err := Audit(dir)
	if err != nil {
		t.Fatalf("Audit 应成功, got %v", err)
	}
	if result.Resources.ByType["EntityPlayer"] != 3 {
		t.Errorf("mmd/PMX 下 3 个文件应全归 EntityPlayer, ByType=%v", result.Resources.ByType)
	}
	if result.Resources.ByType["DefaultMorph"] != 0 {
		t.Errorf("zip 不应误归 DefaultMorph, ByType=%v", result.Resources.ByType)
	}
}

// TestAudit_SymlinkRoot 符号链接根目录应报错（防审计穿透到仓库外）
func TestAudit_SymlinkRoot(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 需管理员权限创建符号链接，跳过")
	}
	dir := t.TempDir()
	outside := t.TempDir()
	testutil.WriteTestFileBytes(t, filepath.Join(outside, "secret.json"), []byte(`{"format_version":"1.16.0"}`))
	link := filepath.Join(dir, "link")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("无法创建符号链接: %v", err)
	}

	_, err := Audit(link)
	if err == nil {
		t.Error("符号链接根目录应报错")
	}
	if !strings.Contains(err.Error(), "符号链接") {
		t.Errorf("错误应说明符号链接, got: %v", err)
	}
}

// 命中率相关测试已移至 repoaudit_cache_hitrate_test.go（2026-09 真命中率实现后，
// 原「字段已删除勿复活」的 TestAudit_NoCacheHitRate 随之退役）。

// （.disabled/.ban，大小写不敏感）——此前前端 oldest 页自建正则数禁用，
// 口径双轨，现统一由 Go 审计产出（resources.banned）。
func TestAudit_BannedCount(t *testing.T) {
	dir := t.TempDir()
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "a.ysm"), []byte(`{"format_version":"1.16.0","minecraft:geometry":[]}`))
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "b.ysm.disabled"), []byte(`{"format_version":"1.16.0","minecraft:geometry":[]}`))
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "c.ysm.ban"), []byte(`{"format_version":"1.16.0","minecraft:geometry":[]}`))
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "d.ysm.BAN"), []byte(`{"format_version":"1.16.0","minecraft:geometry":[]}`))

	result, err := Audit(dir)
	if err != nil {
		t.Fatalf("Audit 应成功, got %v", err)
	}
	if result.Resources.Banned != 3 {
		t.Errorf("3 个禁用文件（.disabled/.ban/.BAN）应记 banned=3, got %d", result.Resources.Banned)
	}
	if result.Resources.TotalFiles != 4 {
		t.Errorf("禁用文件仍应计入总文件数, got %d", result.Resources.TotalFiles)
	}
}

func TestHealthReportFor_IncludesDedup(t *testing.T) {
	dir := t.TempDir()
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "a.ysm"), []byte("same content"))
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "b.ysm"), []byte("same content"))
	// 第三个文件相同 → 2 组多余
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "c.ysm"), []byte("same content"))

	report, err := HealthReportFor(dir)
	if err != nil {
		t.Fatalf("HealthReportFor 应成功, got %v", err)
	}
	if report.Dedup.Groups != 1 {
		t.Errorf("应有 1 个去重组, got %d", report.Dedup.Groups)
	}
	if report.Dedup.ExtraFiles != 2 {
		t.Errorf("应有 2 个多余文件, got %d", report.Dedup.ExtraFiles)
	}
	if report.Dedup.Reclaim <= 0 {
		t.Errorf("可回收字节应 > 0, got %d", report.Dedup.Reclaim)
	}
	if report.Score <= 0 || report.Score > 100 {
		t.Errorf("分数应在 1-100, got %d", report.Score)
	}
}

func TestHealthReportFor_ErrOnMissingDir(t *testing.T) {
	_, err := HealthReportFor(filepath.Join(t.TempDir(), "nope"))
	if err == nil {
		t.Error("不存在的目录应报错")
	}
}

// TestIsModelFileValid_SizeLimit 钉住完整性校验的读取上限（R34 P3-4 修复）：
// 超过 modelFileReadLimit 的 .json/.ysm 必须判无效——防数 GB 恶意/损坏文件
// 全量载入内存（与 go/ysm readFileLimited、fsutil.ReadLimitedEntry 同族口径）。
// 经包级 var 注入小 limit，避免测试真写 50MB 文件。
func TestIsModelFileValid_SizeLimit(t *testing.T) {
	dir := t.TempDir()
	// 合法 JSON，但体积超过下方注入的临时上限
	big := []byte(`{"format_version":"1.16.0","pad":"` + strings.Repeat("a", 4096) + `"}`)
	bigPath := filepath.Join(dir, "big.json")
	if err := os.WriteFile(bigPath, big, 0o644); err != nil {
		t.Fatal(err)
	}

	orig := modelFileReadLimit
	modelFileReadLimit = 8 // 字节级上限：合法 JSON 也超限
	defer func() { modelFileReadLimit = orig }()

	if isModelFileValid(bigPath, ".json") {
		t.Error("超限文件即使 JSON 合法也应判无效（防无界载入内存）")
	}

	// 对照组：恢复默认上限后同一文件应判有效
	modelFileReadLimit = orig
	if !isModelFileValid(bigPath, ".json") {
		t.Error("默认上限内合法 JSON 应判有效")
	}
}

// TestClassifyWith_RebuildOnRegistrySwap 钉住 Classify/ClassifyWith 缓存随
// 注册表实例失效重建（code_review 963d4d36 #7 补测试）：
// 与 go/types/extensions_map_test.go 同款范式——SetRegistryPath 切换后，
// 缓存必须以新实例指针为 key 重建，否则 stale ext→rtype 映射被永久服务。
// 防回归点：若未来误用「一次性构建不再比对 reg」，切注册表后本测试会红。
func TestClassifyWith_RebuildOnRegistrySwap(t *testing.T) {
	dir := t.TempDir()
	reg1 := filepath.Join(dir, "r1.json")
	if err := os.WriteFile(reg1, []byte(`{"resourceTypes":[{"id":"alpha","extensions":[".aaa"],"hashable":true,"storageSubDir":"alpha"}]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	reg2 := filepath.Join(dir, "r2.json")
	if err := os.WriteFile(reg2, []byte(`{"resourceTypes":[{"id":"beta","extensions":[".bbb"],"hashable":true,"storageSubDir":"beta"}]}`), 0o644); err != nil {
		t.Fatal(err)
	}

	registry.SetRegistryPath(reg1)
	defer registry.SetRegistryPath("")
	regA := registry.LoadRegistry()
	if got := ClassifyWith(regA, ".aaa"); got != "alpha" {
		t.Fatalf("reg1 下 ClassifyWith('.aaa') 应为 alpha, got %q", got)
	}
	if got := ClassifyWith(regA, ".bbb"); got != "other" {
		t.Fatalf("reg1 下 ClassifyWith('.bbb') 应为 other, got %q", got)
	}

	// 切换注册表 → 缓存必须随新实例重建（新指针 → 缓存失效）
	registry.SetRegistryPath(reg2)
	regB := registry.LoadRegistry()
	if got := ClassifyWith(regB, ".bbb"); got != "beta" {
		t.Fatalf("切到 reg2 后 ClassifyWith('.bbb') 应为 beta（缓存需随实例重建）, got %q", got)
	}
	if got := ClassifyWith(regB, ".aaa"); got != "other" {
		t.Fatalf("切到 reg2 后 ClassifyWith('.aaa') 应为 other, got %q", got)
	}

	// 无参 Classify 入口（内部 LoadRegistry）与传 reg 变体口径一致
	if got := Classify(".bbb"); got != "beta" {
		t.Fatalf("切到 reg2 后 Classify('.bbb') 应为 beta, got %q", got)
	}

	// 旧实例指针（regA）调用：全局缓存槽已被 regB 占用 → 以 regA 重建并服务
	// regA 自有内容（.aaa→alpha，自洽）——缓存颠簸但不错判
	if got := ClassifyWith(regA, ".aaa"); got != "alpha" {
		t.Fatalf("旧实例 regA 判 '.aaa' 应以 regA 内容重建返回 alpha, got %q", got)
	}
	// 颠簸后回切 regB 仍正确（每次构建以传入 reg 为准，不误服务对方 stale 映射）
	if got := ClassifyWith(regB, ".bbb"); got != "beta" {
		t.Fatalf("颠簸后 regB 判 '.bbb' 仍应 beta, got %q", got)
	}
	if got := ClassifyWith(regB, ".aaa"); got != "other" {
		t.Fatalf("颠簸后 regB 判 '.aaa' 应 other（regB 未声明 .aaa）, got %q", got)
	}
}

// TestHealthReportForCtx_PreCancelled ADR-314：预取消 ctx 确定性验证——walk 首个
// 检查点即中止，错误链可 errors.Is 判定（不依赖时序竞态）。
func TestHealthReportForCtx_PreCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.ysm"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := HealthReportForCtx(ctx, dir)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("预取消 ctx 应返回 context.Canceled 链, got %v", err)
	}
}
