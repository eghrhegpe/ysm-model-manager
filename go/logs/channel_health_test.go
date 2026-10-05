// ===== go/logs 元失败层单测（ADR-322 D1 通道健康锁存位 / D3 分区裁剪）=====
//
// 与既有 logs_test.go / logs_extra_test.go 的分工：那两个文件锁「写入路径不回归」
// （裁剪上限、字段截断、.corrupt 备份、防抖落盘），本文件锁**本 ADR 新引入的
// 两条语义**：① 通道失效是可查询状态；② 元失败证据不被业务日志整类挤没。
// 二者都是「不写测试就可能被无声改回原状」的性质，故单独立文件。
package logs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
)

// ====== D1：通道健康锁存位 ======

// TestLogger_Health_MemoryStateByConfigDirEmpty 平台数据根缺失 → 内存态，
// 健康位必须报不健康 + memory-state 机器码（这是最常见的元失败形态：
// Android 沙盒不可用时 logger 静默退化为只在内存，重启即失）
func TestLogger_Health_MemoryStateByConfigDirEmpty(t *testing.T) {
	l := NewLogger("")
	h := l.Health()
	if h.PersistOK {
		t.Fatal("内存态 logger 的 PersistOK 应为 false")
	}
	if h.Reason != types.ChannelReasonMemoryState {
		t.Errorf("Reason = %q, 期望 %q", h.Reason, types.ChannelReasonMemoryState)
	}
}

// TestLogger_Health_HealthyAfterNewLogger 正常构造（可落盘目录）→ 健康
func TestLogger_Health_HealthyAfterNewLogger(t *testing.T) {
	h := NewLogger(t.TempDir()).Health()
	if !h.PersistOK {
		t.Fatalf("落盘态 logger 应健康, got %+v", h)
	}
	if h.Reason != "" {
		t.Errorf("健康时 Reason 应为空串, got %q", h.Reason)
	}
}

// TestLogger_Health_SaveFailureLatches 落盘失败（目录被占用成文件）→ 健康位翻转；
// 随后修好环境再写成功也不自动回弹（锁存语义，防 UI 红条随写入闪烁）
func TestLogger_Health_SaveFailureLatches(t *testing.T) {
	dir := t.TempDir()
	// 用「已存在的文件」占住日志路径的父目录名 → save 里 MkdirAll 必失败
	blocker := filepath.Join(dir, "blocker")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	l := NewLogger(dir) // NewLogger 自身 MkdirAll(dir) 成功（dir 存在），故初始健康
	if !l.Health().PersistOK {
		t.Fatal("NewLogger 成功构造时应健康")
	}
	// 改 path 到 blocker 之下 → save 时 MkdirAll(blocker) 因其是文件而失败
	l.path = filepath.Join(blocker, "logs.json")
	l.Add("m", "s", "d", 0, "ok", "")
	l.Flush()
	h := l.Health()
	if h.PersistOK {
		t.Fatal("落盘失败后 PersistOK 应翻转 false")
	}
	if h.Reason != types.ChannelReasonMkdirFailed {
		t.Errorf("Reason = %q, 期望 %q", h.Reason, types.ChannelReasonMkdirFailed)
	}
	// 锁存：修好路径再写成功，仍不自动回弹
	l.path = filepath.Join(dir, "logs.json")
	l.Add("m2", "s", "d", 0, "ok", "")
	l.Flush()
	if l.Health().PersistOK {
		t.Error("健康位应锁存不自动回弹（一次失败即视为曾经不可靠）")
	}
	// 显式复位点：Clear 成功落盘后恢复健康
	l.Clear()
	if !l.Health().PersistOK {
		t.Errorf("Clear（显式复位点）成功后应恢复健康, got %+v", l.Health())
	}
}

// TestLogger_Health_ClearDoesNotRescueMemoryState 内存态 Clear 的 save 是 no-op，
// 不得谎报健康（否则「清空日志」这个用户操作会把红条骗掉）
func TestLogger_Health_ClearDoesNotRescueMemoryState(t *testing.T) {
	l := NewLogger("")
	l.Add("m", "s", "d", 0, "ok", "")
	l.Clear()
	if l.Health().PersistOK {
		t.Error("内存态 Clear 不得复位健康位（save 为 no-op）")
	}
}

// TestLogger_Health_ZeroValueLogger 直构 &Logger{}（未走 NewLogger 初始化，
// path 未知）→ 报不健康：结构体未声明自己可落盘就不得声称可用（宁可误报不漏报）
func TestLogger_Health_ZeroValueLogger(t *testing.T) {
	h := (&Logger{}).Health()
	if h.PersistOK {
		t.Error("零值 Logger 应报不健康（path 未知）")
	}
}

// ====== D3：分区裁剪 ======

// TestTrimRing_PlainOnlyKeepsTail 纯业务流量：口径与原「丢最旧」逐字一致
// （既有 TestLogger_CapAt500 / TestLogger_Load_Over500Trim 依赖此语义）
func TestTrimRing_PlainOnlyKeepsTail(t *testing.T) {
	ring := make([]types.ImportLog, 600)
	for i := range ring {
		ring[i] = types.ImportLog{Operation: "import", ModelName: string(rune('a' + i%26))}
	}
	// trimRing 就地左移（复用 backing），故先记下原第 101 条的指纹再裁
	want := ring[100].ModelName
	got := trimRing(ring, 500, isUIOpLog)
	if len(got) != 500 {
		t.Fatalf("应裁到 500 条, got %d", len(got))
	}
	if got[0].ModelName != want {
		t.Errorf("应保留最末 500 条: got[0].ModelName = %q, 期望 %q", got[0].ModelName, want)
	}
}

// TestTrimRing_ProtectedSurvivesPlainStorm 核心病灶用例：400 条业务日志
// 之后灌 200 条界面日记，业务流水不得把界面分区整类挤没（元失败风暴
// 挤掉 import 诊断 = ADR-322 §1 缺口 5）
func TestTrimRing_ProtectedSurvivesPlainStorm(t *testing.T) {
	ring := make([]types.ImportLog, 0, 700)
	for i := 0; i < 400; i++ {
		ring = append(ring, types.ImportLog{Operation: "import"})
	}
	for i := 0; i < 200; i++ {
		ring = append(ring, types.ImportLog{Operation: uiOp})
	}
	got := trimRing(ring, 500, isUIOpLog)
	ui, imp := 0, 0
	for _, e := range got {
		if e.Operation == uiOp {
			ui++
		} else {
			imp++
		}
	}
	if len(got) != 500 {
		t.Fatalf("总量应仍为 500, got %d", len(got))
	}
	if ui == 0 {
		t.Error("界面日记分区被业务日志整类挤没了（受保护配额失效）")
	}
	if ui > 500/protectedShareNum {
		t.Errorf("界面日记 %d 条超出配额 %d（保护不等于无限）", ui, 500/protectedShareNum)
	}
	if imp == 0 {
		t.Error("业务日志被全部挤掉（配额分配失衡）")
	}
}

// TestTrimRing_ProtectedTrimsWhenAloneOverQuota 受保护分区自身超配额时照样裁
// 最旧（否则一次 5000 条的日记风暴能把环撑爆并永久占位）
func TestTrimRing_ProtectedTrimsWhenAloneOverQuota(t *testing.T) {
	ring := make([]types.ImportLog, 0, 600)
	for i := 0; i < 600; i++ {
		ring = append(ring, types.ImportLog{Operation: uiOp})
	}
	got := trimRing(ring, 500, isUIOpLog)
	if len(got) != 500 {
		t.Fatalf("应裁到 500 条, got %d", len(got))
	}
}

// TestTrimRing_KeepsOldestProtectedWhenBothOverQuota 两类都超配额时的淘汰顺序：
// 各自丢最旧，而不是「先淘汰受保护类」或「全丢最旧尾段」
func TestTrimRing_KeepsOldestProtectedWhenBothOverQuota(t *testing.T) {
	ring := make([]types.ImportLog, 0, 600)
	for i := 0; i < 300; i++ {
		ring = append(ring, types.ImportLog{Operation: "import", ModelName: "old"})
	}
	for i := 0; i < 300; i++ {
		ring = append(ring, types.ImportLog{Operation: uiOp, ModelName: "ui"})
	}
	got := trimRing(ring, 500, isUIOpLog)
	// 配额 375/125：各丢最旧 25 条
	if got[0].ModelName != "old" {
		t.Error("业务类最旧条目应被优先淘汰")
	}
	if got[len(got)-1].ModelName != "ui" {
		t.Error("业务类应保留到环尾（未受保护类不因异类超限而被多丢）")
	}
}

// TestTrimRing_LimitLE0Unlimited limit<=0 视作不限（NewRuntimeBuffer 兜底给
// DefaultRuntimeCap，但直构零 cap 的测试/未来调用点不得被裁成空）
func TestTrimRing_LimitLE0Unlimited(t *testing.T) {
	ring := []types.ImportLog{{Operation: "import"}, {Operation: uiOp}}
	if got := trimRing(ring, 0, isUIOpLog); len(got) != 2 {
		t.Errorf("limit=0 应原样返回, got %d", len(got))
	}
	if got := trimRing(ring, -1, isUIOpLog); len(got) != 2 {
		t.Errorf("limit=-1 应原样返回, got %d", len(got))
	}
}

// TestTrimRing_ZeroesTailSlot 尾槽清零：左移淘汰后环不得继续引用已淘汰条目的
// string 字段（长 ErrorMsg 在环里被长期持有是真实内存滞留）
func TestTrimRing_ZeroesTailSlot(t *testing.T) {
	ring := make([]types.ImportLog, 0, 4)
	ring = append(ring, types.ImportLog{Operation: "import", ErrorMsg: "长消息-将被淘汰"})
	ring = append(ring, types.ImportLog{Operation: "import"})
	ring = append(ring, types.ImportLog{Operation: "import"})
	got := trimRing(ring, 2, isUIOpLog)
	if len(got) != 2 {
		t.Fatalf("应裁到 2 条, got %d", len(got))
	}
	// backing 数组容量仍是 4：读原始尾槽须已被清零
	if back := ring[:cap(ring)][2]; back.ErrorMsg != "" {
		t.Errorf("尾槽应清零, got %+v（仍持有已淘汰条目的引用）", back)
	}
}

// ====== D3：runtime 环 meta 分区 ======

// TestRuntimeBuffer_MetaSurvivesStorm [meta] 前缀条目在普通日志风暴中保底不裁
func TestRuntimeBuffer_MetaSurvivesStorm(t *testing.T) {
	b := NewRuntimeBuffer(20) // 配额 15 / 5，构造混合态
	for i := 0; i < 40; i++ {
		if _, err := b.Write([]byte("[watcher] 业务日志 ")); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := b.Write([]byte("[meta] 写入日志文件失败: disk full")); err != nil {
		t.Fatal(err)
	}
	all := b.GetAll()
	found := false
	for _, e := range all {
		if e.Tag == metaTag {
			found = true
		}
	}
	if len(all) != 20 {
		t.Fatalf("应裁到 20 条, got %d", len(all))
	}
	if !found {
		t.Error("[meta] 元失败条目被普通日志挤掉了（受保护分区失效）")
	}
}

// TestRuntimeBuffer_MetaTagMustAnchorLineStart [meta] 出现在消息中段不算
// 受保护条目（与 runtimeTagRe 的 ^ 锚定同源：否则业务消息里提一句
// "[meta]" 就能白占受保护配额）
func TestRuntimeBuffer_MetaTagMustAnchorLineStart(t *testing.T) {
	b := NewRuntimeBuffer(20)
	// 中段 [meta] 写在**最旧**位：若它被判为受保护条目就会在 40 条普通日志后存活，
	// 故「是否仍在场」直接反证分区谓词是否锚定行首
	if _, err := b.Write([]byte("业务消息里提到 [meta] 字样")); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 40; i++ {
		if _, err := b.Write([]byte("[watcher] 业务日志 ")); err != nil {
			t.Fatal(err)
		}
	}
	all := b.GetAll()
	if len(all) != 20 {
		t.Fatalf("应裁到 20 条, got %d", len(all))
	}
	for _, e := range all {
		if strings.Contains(e.Message, "提到 [meta]") {
			t.Errorf("中段 [meta] 不应被判为受保护条目, 但它留在了环里: Tag=%q", e.Tag)
		}
	}
}

// TestRuntimeBuffer_MetaLevelInferred [meta] 通道失败文案应被推为 error/warn 级
// （元失败不是「跳过」级别——用户需要按错误级别筛选看到它）
func TestRuntimeBuffer_MetaLevelInferred(t *testing.T) {
	b := NewRuntimeBuffer(20)
	if _, err := b.Write([]byte("[meta] 写入日志文件失败: disk full")); err != nil {
		t.Fatal(err)
	}
	got := b.GetAll()
	if len(got) != 1 {
		t.Fatalf("应 1 条, got %d", len(got))
	}
	if got[0].Tag != metaTag {
		t.Fatalf("Tag = %q, 期望 %q", got[0].Tag, metaTag)
	}
	if got[0].Level != types.LevelError {
		t.Errorf("Level = %q, 期望 error（关键词「失败」命中）", got[0].Level)
	}
}
