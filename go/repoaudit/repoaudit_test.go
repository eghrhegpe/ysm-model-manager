// ===== repoaudit 共享包测试 =====
// 覆盖：空仓库审计 / 坏模型扣分 / 去重汇总（HealthReportFor）。
// 策略：临时目录 + 零配置,不触碰真实用户配置/缓存。
package repoaudit

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
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
	writeFile(t, filepath.Join(dir, "broken.ysm"), []byte("not json"))

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

// TestAudit_StructuralInvalid 结构损坏但可解析 JSON——校验加严后应判无效（防完整性假绿）
func TestAudit_StructuralInvalid(t *testing.T) {
	dir := t.TempDir()
	// 合法 JSON 但无 format_version/minecraft:geometry/bones 字段
	writeFile(t, filepath.Join(dir, "bad.ysm"), []byte(`{"foo": "bar"}`))

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
	writeFile(t, filepath.Join(dir2, "ok.ysm"), []byte(`{"format_version":"1.16.0","minecraft:geometry":[]}`))
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
	writeFile(t, filepath.Join(dir, "模型A", "model.json"), []byte(`{"format_version":"1.16.0","minecraft:geometry":[]}`))
	writeFile(t, filepath.Join(sub, "tex.png"), []byte("png"))

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
	writeFile(t, filepath.Join(pmxDir, "角色包.zip"), []byte("PK\x03\x04"))
	writeFile(t, filepath.Join(pmxDir, "表情.vpd"), []byte("vpd"))
	writeFile(t, filepath.Join(pmxDir, "角色.pmx"), []byte("pmx"))

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
	writeFile(t, filepath.Join(outside, "secret.json"), []byte(`{"format_version":"1.16.0"}`))
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

// TestAudit_BannedCount 禁用文件统计走 types.IsDisableSuffix 单一口径
// （.disabled/.ban，大小写不敏感）——此前前端 oldest 页自建正则数禁用，
// 口径双轨，现统一由 Go 审计产出（resources.banned）。
func TestAudit_BannedCount(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "a.ysm"), []byte(`{"format_version":"1.16.0","minecraft:geometry":[]}`))
	writeFile(t, filepath.Join(dir, "b.ysm.disabled"), []byte(`{"format_version":"1.16.0","minecraft:geometry":[]}`))
	writeFile(t, filepath.Join(dir, "c.ysm.ban"), []byte(`{"format_version":"1.16.0","minecraft:geometry":[]}`))
	writeFile(t, filepath.Join(dir, "d.ysm.BAN"), []byte(`{"format_version":"1.16.0","minecraft:geometry":[]}`))

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
	writeFile(t, filepath.Join(dir, "a.ysm"), []byte("same content"))
	writeFile(t, filepath.Join(dir, "b.ysm"), []byte("same content"))
	// 第三个文件相同 → 2 组多余
	writeFile(t, filepath.Join(dir, "c.ysm"), []byte("same content"))

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

// writeFile 写文件（超小内容,一次写盘）
func writeFile(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("写文件 %s 失败: %v", path, err)
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

	types.SetRegistryPath(reg1)
	defer types.SetRegistryPath("")
	regA := types.LoadRegistry()
	if got := ClassifyWith(regA, ".aaa"); got != "alpha" {
		t.Fatalf("reg1 下 ClassifyWith('.aaa') 应为 alpha, got %q", got)
	}
	if got := ClassifyWith(regA, ".bbb"); got != "other" {
		t.Fatalf("reg1 下 ClassifyWith('.bbb') 应为 other, got %q", got)
	}

	// 切换注册表 → 缓存必须随新实例重建（新指针 → 缓存失效）
	types.SetRegistryPath(reg2)
	regB := types.LoadRegistry()
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
