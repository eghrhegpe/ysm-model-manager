// Package ysmwebview ADR-317：Android WebView 桥解码请求管理器。
//
// Android 上 wazero 只有 interpreter（同 V3 样本 33s vs WebView V8 ~1.1s，见
// docs/knowledge/ysm-wasi.md 三路基准），解码委托给 app 内 WebView 的前端
// YSMParser wasm 执行。本包只管请求簿记（id/channel/超时/就绪态），协议：
//
//	Go  →前端  Event "ysm-decode-request"  (id, data 原始 .ysm 字节)
//	前端→Go    绑定 ResolveYsmDecode(id, gzip(JSON files)→base64, errMsg)
//
// 纯 Go、零 Wails 依赖（emit 函数注入），wazero 兜底路径见 internal/app。
package ysmwebview

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"ysm-model-manager/go/ysm"
)

// MaxInput 桥接解码输入上限：超出直接回退 wazero（Android 实际模型远小于此，
// 上限只为防 Emit 超大 payload 拖垮事件通道；桌面 spike 实测 32MB 无截断）。
const MaxInput = 32 << 20

// ErrNotReady 前端 listener 未就绪（未挂/非 Android/前端未启动）。
var ErrNotReady = errors.New("ysm-webview: 前端解码桥未就绪")

// ErrTimeout 前端解码超时（未在时限内回传）。
var ErrTimeout = errors.New("ysm-webview: 前端解码超时")

// filesPayload 前端回传的解码产物（data 为 base64），与 frontend
// src/backend/ysm-decode-bridge.ts 的 payload 结构保持镜像（改动须两侧同步）。
type filesPayload struct {
	Files []ysm.DecodedFile `json:"files"`
}

// DecodedFile 的 JSON 形态：Data []byte 由 encoding/json 自动 base64 编解码
// （ysm.DecodedFile 无 json tag，Data 走默认 base64）。

type decodeResult struct {
	files []ysm.DecodedFile
	err   error
}

// Bridge 桥接请求管理器。并发安全：每个请求独立 id + buffered channel。
type Bridge struct {
	mu      sync.Mutex
	pending map[int64]chan decodeResult
	next    int64
	ready   atomic.Bool
	emit    func(name string, id int64, data []byte)
}

// New 构造桥。emit 为 Go→前端事件发射函数（internal/app 注入 a.app.Event.Emit
// 闭包；测试注入捕获桩）。
func New(emit func(name string, id int64, data []byte)) *Bridge {
	return &Bridge{pending: make(map[int64]chan decodeResult), emit: emit}
}

// SetEmit 运行期接事件发射函数（App.SetApp 时注入；mu 保证与 Decode 无数据竞争）。
func (b *Bridge) SetEmit(emit func(name string, id int64, data []byte)) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.emit = emit
}

// MarkReady 前端 listener 挂好后调用（绑定 MarkYsmDecodeBridgeReady）。
func (b *Bridge) MarkReady() { b.ready.Store(true) }

// Ready 报告前端桥是否就绪。
func (b *Bridge) Ready() bool { return b.ready.Load() }

// Decode 发起一次桥接解码并阻塞等待结果。
// 未就绪/超时/前端报错均返回 error，由调用方决定回退 wazero。
func (b *Bridge) Decode(data []byte, timeout time.Duration) ([]ysm.DecodedFile, error) {
	b.mu.Lock()
	if !b.ready.Load() || b.emit == nil {
		b.mu.Unlock()
		return nil, ErrNotReady
	}
	if len(data) > MaxInput {
		b.mu.Unlock()
		return nil, errors.New("ysm-webview: 输入超出桥接上限")
	}
	if b.pending == nil {
		b.pending = make(map[int64]chan decodeResult)
	}
	b.next++
	id := b.next
	ch := make(chan decodeResult, 1)
	b.pending[id] = ch
	emit := b.emit
	b.mu.Unlock()

	emit("ysm-decode-request", id, data)

	select {
	case res := <-ch:
		return res.files, res.err
	case <-time.After(timeout):
		b.mu.Lock()
		delete(b.pending, id)
		b.mu.Unlock()
		return nil, ErrTimeout
	}
}

// Resolve 接收前端回传（绑定 ResolveYsmDecode 的落点）。
// payload 为 gzip(JSON filesPayload) 的 base64；errMsg 非空表示前端侧失败。
func (b *Bridge) Resolve(id int64, payload string, errMsg string) error {
	b.mu.Lock()
	ch, ok := b.pending[id]
	delete(b.pending, id)
	b.mu.Unlock()
	if !ok {
		return errors.New("ysm-webview: 未知或已超时的请求 id")
	}

	if errMsg != "" {
		ch <- decodeResult{err: errors.New(errMsg)}
		return nil
	}
	files, err := parsePayload(payload)
	ch <- decodeResult{files: files, err: err}
	return err
}

// parsePayload 解 gzip+base64+JSON → 文件列表。
func parsePayload(payload string) ([]ysm.DecodedFile, error) {
	raw, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return nil, errors.New("ysm-webview: payload base64 解码失败: " + err.Error())
	}
	gz, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		return nil, errors.New("ysm-webview: payload gzip 解压失败: " + err.Error())
	}
	var p filesPayload
	if err := json.NewDecoder(gz).Decode(&p); err != nil {
		return nil, errors.New("ysm-webview: payload JSON 解析失败: " + err.Error())
	}
	return p.Files, nil
}
