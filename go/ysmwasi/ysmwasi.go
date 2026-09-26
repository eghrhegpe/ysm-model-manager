// Package ysmwasi wazero 纯 Go 宿主解码 .ysm（ADR-316：Node 子进程桥退役）。
//
// 内嵌 emscripten standalone 构建（-sSTANDALONE_WASM -fignore-exceptions，
// 构建 recipe 见 docs/knowledge/ysm-wasi.md），imports 闭集 = 10 个
// wasi_snapshot_preview1（wazero 内置）+ 4 个 env 垫片；解码走
// ysm_decode_to_memory 内存直出（零文件系统依赖），产物序列化格式：
//
//	[u32 count][u32 nameLen][u32 dataLen][name][data]*
//
// 异常语义（ADR-316 D2）：noeh 构建下畸形 .ysm 触发 parser abort → wazero
// 以 error 返回（可恢复，非进程崩溃）；happy path 零 throw。
package ysmwasi

import (
	"context"
	_ "embed"
	"encoding/binary"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
	wasi "github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
	"ysm-model-manager/go/ysm"
)

//go:embed YSMParser-mem-noeh.wasm
var wasmBinary []byte

const (
	// decodeTimeout 单次解码上限（对齐原 avatar.decodeTimeout 口径；wazero
	// Call 接受 context，超时可中断）
	decodeTimeout = 60 * time.Second
	// maxInput 输入 .ysm 上限（对齐原 decodeMaxInput 口径，>200MB 拒绝）
	maxInput = 200 << 20
	// maxOutput 产物总量上限（对齐原 decodeMaxOutput 口径，防解压炸弹）
	maxOutput = 200 << 20
)

// runtime/compiled 进程级单例：启动期 sync.Once 一次编译，运行期并发只读。
// 每次 Decode 实例化新 module（独占堆，避免跨调用内存膨胀），module 不并发共享。
var (
	mu       sync.Mutex
	runtime  wazero.Runtime
	compiled wazero.CompiledModule
	initErr  error
	once     sync.Once
)

// ensureInit 惰性初始化：建 runtime（默认 optimizing compiler；Android 等
// compiler 不支持平台 wazero 自动退 interpreter）+ wasi + 4 个 env 垫片 +
// 编译内嵌 wasm。
// WithStartFunctions 清空自动启动（standalone WASI command 的 _start 会跑
// CLI11 空参 main，-fignore-exceptions 下 throw=trap），实例化后手动调
// __wasm_call_ctors。
func ensureInit() error {
	once.Do(func() {
		r, c, err := newRuntime(context.Background(), wazero.NewRuntimeConfig())
		if err != nil {
			initErr = err
			return
		}
		runtime, compiled = r, c
	})
	return initErr
}

// newRuntime 建带垫片的 runtime 并编译内嵌 wasm（cfg 决定 compiler/interpreter；
// bench 测试用 interpreter 配置量化无 compiler 平台的解码耗时）。
func newRuntime(ctx context.Context, cfg wazero.RuntimeConfig) (wazero.Runtime, wazero.CompiledModule, error) {
	r := wazero.NewRuntimeWithConfig(ctx, cfg)
	if _, err := wasi.NewBuilder(r).Instantiate(ctx); err != nil {
		_ = r.Close(ctx)
		return nil, nil, fmt.Errorf("wasi 实例化: %w", err)
	}
	// emscripten libc 直译的 3 个 syscall 垫片 + 内存增长回调（noeh 构建
	// 的全部 env 依赖；getdents64 解码 happy path 不依赖，stub 返回 EOF）
	if _, err := r.NewHostModuleBuilder("env").
		NewFunctionBuilder().WithFunc(func(ctx context.Context, mod api.Module, fd, buf, count uint32) int32 {
		return 0
	}).Export("__syscall_getdents64").
		NewFunctionBuilder().WithFunc(sysGetcwd).
		Export("__syscall_getcwd").
		NewFunctionBuilder().WithFunc(func(ctx context.Context, mod api.Module, fd int32, path, buf, size uint32) int32 {
		return -22 // -EINVAL：不支持符号链接
	}).Export("__syscall_readlinkat").
		NewFunctionBuilder().WithFunc(func(ctx context.Context, mod api.Module, size uint32) {}).
		Export("emscripten_notify_memory_growth").
		Instantiate(ctx); err != nil {
		_ = r.Close(ctx)
		return nil, nil, fmt.Errorf("env 垫片: %w", err)
	}
	c, err := r.CompileModule(ctx, wasmBinary)
	if err != nil {
		_ = r.Close(ctx)
		return nil, nil, fmt.Errorf("wasm 编译: %w", err)
	}
	return r, c, nil
}

// sysGetcwd 返回 preopen 目录 "/output" 作为 cwd（parser 内相对路径兜底；
// 内存直出下无真实文件系统，固定值仅为满足 libc 调用约定）。
func sysGetcwd(ctx context.Context, mod api.Module, buf, size uint32) int32 {
	const cwd = "/output\x00"
	if uint32(len(cwd)) > size || !mod.Memory().WriteString(buf, cwd) {
		return -75 // -ERANGE
	}
	return int32(len(cwd)) - 1
}

// moduleCfg 实例化配置：WithStartFunctions 清空自动启动（standalone WASI
// command 的 _start 会跑 CLI11 空参 main，-fignore-exceptions 下 throw=trap），
// 实例化后由 Decode 手动调 __wasm_call_ctors。
var moduleCfg = wazero.NewModuleConfig().WithStartFunctions()

// Decode 解码 .ysm 字节为文件列表（ysm.DecodedFile.Path 为产物相对路径）。
// 输入超限/超时/parser abort/产物超限均返回 error（调用方决定降级策略）。
func Decode(ysmData []byte) ([]ysm.DecodedFile, error) {
	if len(ysmData) > maxInput {
		return nil, fmt.Errorf("输入 .ysm 过大: %d bytes (上限 %d)", len(ysmData), maxInput)
	}
	if err := ensureInit(); err != nil {
		return nil, fmt.Errorf("wasm 初始化: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), decodeTimeout)
	defer cancel()

	mu.Lock()
	defer mu.Unlock()
	return decodeWith(ctx, runtime, compiled, ysmData)
}

// decodeWith 在给定 runtime/编译产物上执行单次解码（调用方持锁/限并发）。
// bench 测试用 interpreter runtime 复用此路径，保证与生产 Decode 同构。
func decodeWith(ctx context.Context, rt wazero.Runtime, cm wazero.CompiledModule, ysmData []byte) ([]ysm.DecodedFile, error) {
	mod, err := rt.InstantiateModule(ctx, cm, moduleCfg)
	if err != nil {
		return nil, fmt.Errorf("module 实例化: %w", err)
	}
	defer mod.Close(ctx) //nolint:errcheck // 实例级资源销毁，失败无补救

	mem := mod.Memory()
	mallocFn, freeFn := mod.ExportedFunction("malloc"), mod.ExportedFunction("free")
	decodeFn := mod.ExportedFunction("ysm_decode_to_memory")
	ctorFn := mod.ExportedFunction("__wasm_call_ctors")
	if mallocFn == nil || freeFn == nil || decodeFn == nil || ctorFn == nil {
		return nil, errors.New("wasm 导出缺失（malloc/free/ysm_decode_to_memory/__wasm_call_ctors）")
	}

	if _, err := ctorFn.Call(ctx); err != nil {
		return nil, fmt.Errorf("ctor: %w", err)
	}

	inPtr, err := mallocFn.Call(ctx, uint64(len(ysmData)))
	if err != nil {
		return nil, fmt.Errorf("malloc(输入): %w", err)
	}
	if !mem.Write(uint32(inPtr[0]), ysmData) {
		return nil, fmt.Errorf("写入输入 %d bytes 失败", len(ysmData))
	}

	// 输出槽：ysm_decode_to_memory(data,size,out_ptr) 的 out_ptr 为
	// 指针的指针——bridge 把产物缓冲地址写进这个 4 字节槽
	outSlot, err := mallocFn.Call(ctx, 4)
	if err != nil {
		return nil, fmt.Errorf("malloc(输出槽): %w", err)
	}
	if !mem.Write(uint32(outSlot[0]), []byte{0, 0, 0, 0}) {
		return nil, errors.New("初始化输出槽失败")
	}

	ret, err := decodeFn.Call(ctx, inPtr[0], uint64(len(ysmData)), outSlot[0])
	if err != nil {
		// noeh 构建：畸形输入 → parser abort → trap；wazero 返回 error 可恢复。
		// 无 C++ 异常文本，调用方按「解码失败」降级（环形日志接线在 internal/app）。
		return nil, fmt.Errorf("decode trap（畸形输入或 parser abort）: %w", err)
	}
	slotBytes, ok := mem.Read(uint32(outSlot[0]), 4)
	if !ok {
		return nil, errors.New("读取输出槽失败")
	}
	outPtr := binary.LittleEndian.Uint32(slotBytes)
	_ = ret
	if outPtr == 0 {
		return nil, errors.New("decode 返回空指针（解析失败）")
	}

	files, err := readOutBuf(ctx, mem, freeFn, outPtr)
	if err != nil {
		return nil, err
	}
	// 归还输入缓冲（module 即将销毁，失败不影响正确性）
	_, _ = freeFn.Call(ctx, inPtr[0])
	return files, nil
}

// readOutBuf 解析产物缓冲 [u32 count][u32 nameLen][u32 dataLen][name][data]*，
// 边界校验 + 总量护栏，读完归还 free。
func readOutBuf(ctx context.Context, mem api.Memory, freeFn api.Function, outPtr uint32) ([]ysm.DecodedFile, error) {
	head, ok := mem.Read(outPtr, 4)
	if !ok {
		return nil, errors.New("产物缓冲头不可读")
	}
	count := binary.LittleEndian.Uint32(head)
	if count == 0 {
		return nil, errors.New("decode 产物为空（0 个文件）")
	}
	if count > 1<<16 {
		return nil, fmt.Errorf("decode 产物文件数异常: %d", count)
	}

	var files []ysm.DecodedFile
	var total int
	pos := outPtr + 4
	for i := uint32(0); i < count; i++ {
		hdr, ok := mem.Read(pos, 8)
		if !ok {
			return nil, fmt.Errorf("产物 #%d 头不可读", i)
		}
		nameLen := binary.LittleEndian.Uint32(hdr)
		dataLen := binary.LittleEndian.Uint32(hdr[4:])
		if nameLen == 0 || nameLen > 4096 {
			return nil, fmt.Errorf("产物 #%d 名长异常: %d", i, nameLen)
		}
		total += int(nameLen) + int(dataLen)
		if total > maxOutput {
			return nil, fmt.Errorf("产物总量超限 (>%d bytes)", maxOutput)
		}
		pos += 8
		nameBytes, ok := mem.Read(pos, nameLen)
		if !ok {
			return nil, fmt.Errorf("产物 #%d 名不可读", i)
		}
		dataBytes, ok := mem.Read(pos+nameLen, dataLen)
		if !ok {
			return nil, fmt.Errorf("产物 #%d 内容不可读", i)
		}
		files = append(files, ysm.DecodedFile{
			Path: string(nameBytes),
			Data: append([]byte(nil), dataBytes...),
		})
		pos += nameLen + dataLen
	}
	if freeFn != nil {
		_, _ = freeFn.Call(ctx, uint64(outPtr))
	}
	return files, nil
}

// Close 释放进程级 runtime（测试隔离用；生产随进程退出）。
func Close(ctx context.Context) {
	mu.Lock()
	defer mu.Unlock()
	if runtime != nil {
		_ = runtime.Close(ctx)
		runtime, compiled = nil, nil
		once = sync.Once{}
	}
}
