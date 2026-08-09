// ===== RuntimeBuffer 运行时日志环形缓冲单测（P3 补测：原 runtime.go 零测试覆盖）=====
package logs

import (
	"testing"
	"time"
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
