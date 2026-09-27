package ysmwebview

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"ysm-model-manager/go/ysm"
)

// makePayload 构造前端回传形态的 payload（gzip(JSON{files})→base64）
func makePayload(t *testing.T, files []ysm.DecodedFile) string {
	t.Helper()
	raw, err := json.Marshal(filesPayload{Files: files})
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	if _, err := w.Write(raw); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

func waitForReady(t *testing.T, b *Bridge) {
	t.Helper()
	b.MarkReady()
	if !b.Ready() {
		t.Fatal("MarkReady 后 Ready 应为 true")
	}
}

// 请求-回传全链路：emit 触发 → Resolve 回传 → Decode 拿到文件
func TestDecode_RoundTrip(t *testing.T) {
	idCh := make(chan int64, 1)
	var gotData []byte
	b := New(func(name string, id int64, data []byte) {
		if name != "ysm-decode-request" {
			t.Errorf("事件名 = %q", name)
		}
		idCh <- id
		gotData = data
	})
	waitForReady(t, b)

	want := []ysm.DecodedFile{{Path: "ysm.json", Data: []byte(`{"a":1}`)}}
	done := make(chan struct{})
	go func() {
		defer close(done)
		if err := b.Resolve(<-idCh, makePayload(t, want), ""); err != nil {
			t.Errorf("Resolve: %v", err)
		}
	}()

	files, err := b.Decode([]byte("ysm-bytes"), 5*time.Second)
	<-done
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	if len(files) != 1 || string(files[0].Data) != `{"a":1}` {
		t.Fatalf("files = %+v", files)
	}
	if string(gotData) != "ysm-bytes" {
		t.Fatalf("emit 携带的数据不匹配: %q", gotData)
	}
}

// 未就绪（前端 listener 未挂/非 Android）→ 快速失败，调用方回退 wazero
func TestDecode_NotReady(t *testing.T) {
	b := New(func(string, int64, []byte) {})
	_, err := b.Decode([]byte("x"), time.Second)
	if !errors.Is(err, ErrNotReady) {
		t.Fatalf("err = %v, want ErrNotReady", err)
	}
}

// 超时 → 报错且 pending 清理（后续同 id Resolve 不串扰）
func TestDecode_Timeout(t *testing.T) {
	b := New(func(string, int64, []byte) {})
	waitForReady(t, b)
	_, err := b.Decode([]byte("x"), 30*time.Millisecond)
	if !errors.Is(err, ErrTimeout) {
		t.Fatalf("err = %v, want ErrTimeout", err)
	}
	// 超时后 Resolve 迟到结果应报未知 id，不 panic
	if err := b.Resolve(999, makePayload(t, nil), ""); err == nil {
		t.Fatal("未知 id Resolve 应报错")
	}
}

// 前端报错语义：errMsg 非空 → Decode 返回该错误
func TestDecode_FrontendError(t *testing.T) {
	idCh := make(chan int64, 1)
	b := New(func(_ string, id int64, _ []byte) { idCh <- id })
	waitForReady(t, b)
	go func() {
		if err := b.Resolve(<-idCh, "", "wasm boom"); err != nil {
			t.Errorf("Resolve: %v", err)
		}
	}()
	_, err := b.Decode([]byte("x"), 5*time.Second)
	if err == nil || err.Error() != "wasm boom" {
		t.Fatalf("err = %v, want 前端错误原样透传", err)
	}
}

// 并发请求互不串扰（每请求独立 id + channel）。
// 分发端确定性回显：emit 同步在请求者 goroutine 内触发，分发 goroutine 拿
// (id, data) 后用 data 原样构产物回传，天然一一对应。
func TestDecode_Concurrent(t *testing.T) {
	reqCh := make(chan struct {
		id   int64
		data []byte
	}, 64)
	b := New(func(_ string, id int64, data []byte) {
		reqCh <- struct {
			id   int64
			data []byte
		}{id, data}
	})
	waitForReady(t, b)
	dispatchDone := make(chan struct{})
	go func() {
		defer close(dispatchDone)
		for req := range reqCh {
			if err := b.Resolve(req.id, makePayload(t, []ysm.DecodedFile{{Path: "x", Data: req.data}}), ""); err != nil {
				t.Errorf("Resolve %d: %v", req.id, err)
			}
		}
	}()
	const n = 8
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			files, err := b.Decode([]byte{byte(i)}, 5*time.Second)
			if err != nil {
				t.Errorf("Decode %d: %v", i, err)
				return
			}
			if len(files) != 1 || files[0].Data[0] != byte(i) {
				t.Errorf("请求 %d 结果串扰: %+v", i, files)
			}
		}()
	}
	wg.Wait()
	close(reqCh)
	<-dispatchDone
}

// Resolve 带 gzip 的空文件集也须成功（不 panic，返回非 nil）
func TestResolve_EmptyFiles(t *testing.T) {
	idCh := make(chan int64, 1)
	b := New(func(_ string, id int64, _ []byte) { idCh <- id })
	waitForReady(t, b)
	go func() {
		if err := b.Resolve(<-idCh, makePayload(t, []ysm.DecodedFile{}), ""); err != nil {
			t.Errorf("Resolve: %v", err)
		}
	}()
	files, err := b.Decode([]byte("x"), 5*time.Second)
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	if files == nil {
		t.Fatal("空文件集应返回非 nil 切片")
	}
}
