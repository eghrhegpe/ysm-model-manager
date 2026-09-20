// ===== RuntimeBuffer 运行时日志环形缓冲单测（P3 补测：原 runtime.go 零测试覆盖）=====
package logs

import (
	"testing"
	"time"

	"ysm-model-manager/go/types"
)

func TestRuntimeBuffer_WriteAndGetAll(t *testing.T) {
	b := NewRuntimeBuffer(200)
	n, err := b.Write([]byte("hello\n"))
	if err != nil || n != 6 {
		t.Fatalf("Write 应返回 len(p)/nil，实际 %d/%v", n, err)
	}
	all := b.GetAll()
	if len(all) != 1 {
		t.Fatalf("应 1 条，实际 %d", len(all))
	}
	if all[0].Message != "hello\n" {
		t.Errorf("消息保留原始换行: %q", all[0].Message)
	}
	// 时间戳为 Unix 毫秒（近 1s 内）
	if ts := all[0].Timestamp; ts <= 0 || time.Since(time.UnixMilli(ts)) > time.Second {
		t.Errorf("时间戳非当前毫秒: %d", ts)
	}
}

func TestRuntimeBuffer_RingOverflow(t *testing.T) {
	b := NewRuntimeBuffer(3)
	for i := 0; i < 6; i++ {
		if _, err := b.Write([]byte("msg")); err != nil {
			t.Fatal(err)
		}
	}
	all := b.GetAll()
	if len(all) != 3 {
		t.Fatalf("超容量应保留 3 条，实际 %d", len(all))
	}
	// 丢弃最旧：应保留后 3 条（P3 清理：去掉未使用的循环索引）
	for _, lg := range all {
		if lg.Message != "msg" {
			t.Fatalf("消息被篡改: %q", lg.Message)
		}
	}
}

func TestRuntimeBuffer_CapacityFallback(t *testing.T) {
	// cap<=0 回退 200
	b := NewRuntimeBuffer(0)
	if b.cap != 200 {
		t.Fatalf("cap<=0 应回退 200，实际 %d", b.cap)
	}
	b2 := NewRuntimeBuffer(-5)
	if b2.cap != 200 {
		t.Fatalf("负 cap 应回退 200，实际 %d", b2.cap)
	}
}

func TestRuntimeBuffer_GetAllIsCopy(t *testing.T) {
	b := NewRuntimeBuffer(10)
	if _, err := b.Write([]byte("a")); err != nil {
		t.Fatal(err)
	}
	all := b.GetAll()
	// 外部修改副本不影响内部
	all[0].Message = "tampered"
	again := b.GetAll()
	if again[0].Message != "a" {
		t.Error("GetAll 应返回副本，外部篡改不应影响内部")
	}
}

func TestRuntimeBuffer_Clear(t *testing.T) {
	b := NewRuntimeBuffer(10)
	if _, err := b.Write([]byte("x")); err != nil {
		t.Fatal(err)
	}
	b.Clear()
	if all := b.GetAll(); len(all) != 0 {
		t.Fatalf("Clear 后应为空，实际 %d 条", len(all))
	}
}

// ===== ADR-289：tag 提取与级别推断 =====

func TestRuntimeBuffer_TagExtraction(t *testing.T) {
	cases := []struct {
		name string
		in   string
		tag  string
	}{
		{"标准前缀", "[watcher] 已启动: /root\n", "watcher"},
		{"带连字符", "[config-migrate] 迁移失败: boom\n", "config-migrate"},
		{"带下划线", "[texture_cache] 淘汰删除失败\n", "texture_cache"},
		{"无前缀", "裸日志没有 tag\n", ""},
		{"前缀不在开头", "  [latent] 前导空格不算\n", ""},
		{"空方括号", "[] 空 tag 应留空\n", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			b := NewRuntimeBuffer(10)
			if _, err := b.Write([]byte(c.in)); err != nil {
				t.Fatal(err)
			}
			got := b.GetAll()[0]
			if got.Tag != c.tag {
				t.Errorf("Tag = %q, 期望 %q（Message 必须原样保留）", got.Tag, c.tag)
			}
			// 关键不变量：提取是纯附加，Message 一字不改（前端仍展示原文）
			if got.Message != c.in {
				t.Errorf("Message 被改动: %q", got.Message)
			}
		})
	}
}

func TestRuntimeBuffer_LevelInference(t *testing.T) {
	cases := []struct {
		name  string
		in    string
		level types.LogLevel
	}{
		{"panic → fatal", "[conc] worker panic: bad\n", types.LevelFatal},
		{"失败 → error", "[installer] 安装文件 x 失败: boom\n", types.LevelError},
		{"error 英文 → error", "[proxy] websocket error: reset\n", types.LevelError},
		{"无法 → error", "[storage] 无法创建目录\n", types.LevelError},
		{"警告 → warn", "[sync] 警告: 冲突处理未在锁内\n", types.LevelWarn},
		{"WARN 标记 → warn", "[types][WARN] 注册表含重复 id\n", types.LevelWarn},
		{"⚠️ → warn", "[spec] ⚠️ 骨骼 %q 无 pivot\n", types.LevelWarn},
		{"截断 → warn", "[geometry] 达到物化封顶, 截断\n", types.LevelWarn},
		{"正常 → info", "[watcher] 自动同步完成: 禁用 3 启用 2\n", types.LevelInfo},
		{"裸日志 → info", "纯文本无级别线索\n", types.LevelInfo},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			b := NewRuntimeBuffer(10)
			if _, err := b.Write([]byte(c.in)); err != nil {
				t.Fatal(err)
			}
			if got := b.GetAll()[0].Level; got != c.level {
				t.Errorf("Level = %q, 期望 %q", got, c.level)
			}
		})
	}
}

// 优先级：fatal/error 高于 warn——同一行既有「失败」又有「警告」时应取更严重的
func TestRuntimeBuffer_LevelPriority(t *testing.T) {
	b := NewRuntimeBuffer(10)
	if _, err := b.Write([]byte("[sync] 警告: 同步失败\n")); err != nil {
		t.Fatal(err)
	}
	if got := b.GetAll()[0].Level; got != types.LevelError {
		t.Errorf("error 应优先于 warn，实际 %q", got)
	}
}
