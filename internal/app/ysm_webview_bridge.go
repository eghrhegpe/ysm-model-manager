package app

// ADR-317：Android WebView 桥解码装配。Android 无 wazero optimizing compiler
// （interpreter 同样本 33s），桥就绪后解码委托前端 YSMParser wasm（V8 JIT ~1.1s）；
// 桥未就绪/失败/超限一律回退 wazero 内存直解（桌面主路径不变，CLI 无前端天然走兜底）。
// 请求簿记在 go/ysmwebview（纯 Go、零 Wails 依赖，可独立单测）。

import (
	"ysm-model-manager/go/ysmwebview"
)

// ysmDecodeBridge 全仓唯一桥实例（wasm_decoder.go 解码选择器消费）。
var ysmDecodeBridge = ysmwebview.New(nil)

// MarkYsmDecodeBridgeReady 前端 listener 挂好后调用（frontend/src/backend/ysm-decode-bridge.ts）。
func (a *App) MarkYsmDecodeBridgeReady() { ysmDecodeBridge.MarkReady() }

// ResolveYsmDecode 前端解码回传（payload=gzip(JSON files)→base64；errMsg 非空=前端失败）。
func (a *App) ResolveYsmDecode(id int64, payload string, errMsg string) {
	_ = ysmDecodeBridge.Resolve(id, payload, errMsg)
}
