//go:build wasispike

// Package wasispike WASI 化解码器最小验证（spike，不进生产）：
// wazero 纯 Go 实例化 -sSTANDALONE_WASM 编译的 YSMParser，
// 直调 malloc / ysm_decode_to_memory 内存直出，绕过 Node.js 子进程。
// 验证点：①imports 零 JS 依赖（10 wasi + 4 env 垫片）；②内存直解产出完整产物列表。
//
// 2026-10-06 补 //go:build wasispike（技术债审计 docs/archive/tech-debt-audit-2026-10-06.md §11.1）：
// 使命已由 go/ysmwasi（ADR-316 生产化）承接，本包仅留作 wazero 直调参考实现。
// 此前无 build tag，默认 `go test ./go/...` 会编译到它（暴露 0% 覆盖率红灯）；
// 加 tag 后默认构建/测试跳过，手动跑需 `go run -tags wasispike ./go/wasispike`。
// 与 go/rustbridge 的 rust_backend tag 相反：rustbridge 是生产路径被 tag 隔离（CI 才跑），
// 本包是历史 spike 被 tag 隔离（仅手动参考）——两者语义不同，勿混用同一 tag。
package main

import (
	"context"
	"fmt"
	"os"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
	"github.com/tetratelabs/wazero/experimental"
	wasi "github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
)

func main() {
	if err := run(os.Args[1], os.Args[2]); err != nil {
		fmt.Fprintln(os.Stderr, "FAIL:", err)
		os.Exit(1)
	}
}

func run(wasmPath, ysmPath string) error {
	wasmBin, err := os.ReadFile(wasmPath)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(ysmPath)
	if err != nil {
		return err
	}

	ctx := context.Background()
	r := wazero.NewRuntimeWithConfig(ctx, wazero.NewRuntimeConfig().
		WithCoreFeatures(api.CoreFeaturesV2|experimental.CoreFeaturesExceptionHandling))
	defer func() { _ = r.Close(ctx) }()

	// wasi：本内存直出路径不再需要 preopen 文件系统，仅导入表需要 wasi 模块在场
	_, err = wasi.NewBuilder(r).Instantiate(ctx)
	if err != nil {
		return fmt.Errorf("wasi instantiate: %w", err)
	}
	modCfg := wazero.NewModuleConfig().
		WithStdout(os.Stdout).WithStderr(os.Stderr).
		WithStartFunctions() // 不自动跑 _start（CLI11 空参 throw=trap），ctor 手动调

	// emscripten libc 直译的 3 个 syscall 垫片 + 内存增长回调（全部 env 依赖）
	_, err = r.NewHostModuleBuilder("env").
		NewFunctionBuilder().WithFunc(sysGetdents64).Export("__syscall_getdents64").
		NewFunctionBuilder().WithFunc(sysGetcwd).Export("__syscall_getcwd").
		NewFunctionBuilder().WithFunc(sysReadlinkat).Export("__syscall_readlinkat").
		NewFunctionBuilder().WithFunc(func(ctx context.Context, mod api.Module, size uint32) {}).Export("emscripten_notify_memory_growth").
		Instantiate(ctx)
	if err != nil {
		return fmt.Errorf("env shims: %w", err)
	}

	mod, err := r.InstantiateWithConfig(ctx, wasmBin, modCfg)
	if err != nil {
		return fmt.Errorf("module instantiate: %w", err)
	}
	mem := mod.Memory()

	// 只跑全局 ctor，不调 _start/main
	if _, err := mod.ExportedFunction("__wasm_call_ctors").Call(ctx); err != nil {
		return fmt.Errorf("ctors: %w", err)
	}

	mallocFn, freeFn := mod.ExportedFunction("malloc"), mod.ExportedFunction("free")
	decodeFn := mod.ExportedFunction("ysm_decode_to_memory")
	detectFn := mod.ExportedFunction("ysm_detect_version")

	pIn, err := allocWrite(mem, mallocFn, data)
	if err != nil {
		return err
	}
	pOut, err := allocWrite(mem, mallocFn, make([]byte, 8))
	if err != nil {
		return err
	}

	ver, err := callI32(detectFn, pIn, uint64(len(data)))
	if err != nil {
		return err
	}
	fmt.Printf("detect_version=%d, input=%d bytes, 调 ysm_decode_to_memory...\n", ver, len(data))
	ret, err := callI32(decodeFn, pIn, uint64(len(data)), pOut)
	if err != nil {
		return fmt.Errorf("decode: %w", err)
	}
	if ret != 1 {
		return fmt.Errorf("decode 返回 %d", ret)
	}

	// 读回序列化块：[u32 count][u32 nameLen][u32 dataLen][name][data]*
	bufPtrRaw, ok := mem.Read(uint32(pOut), 4)
	if !ok {
		return fmt.Errorf("读回缓冲指针失败")
	}
	bufPtr32 := uint32(bufPtrRaw[0]) | uint32(bufPtrRaw[1])<<8 | uint32(bufPtrRaw[2])<<16 | uint32(bufPtrRaw[3])<<24
	countRaw, ok := mem.Read(bufPtr32, 4)
	if !ok {
		return fmt.Errorf("读回产物数失败")
	}
	bufPtr32_le := bufPtr32
	count32 := uint32(countRaw[0]) | uint32(countRaw[1])<<8 | uint32(countRaw[2])<<16 | uint32(countRaw[3])<<24
	w := bufPtr32_le + 4
	var total int64
	for i := uint32(0); i < count32; i++ {
		nb, _ := mem.Read(w, 4)
		db, _ := mem.Read(w+4, 4)
		n := uint32(nb[0]) | uint32(nb[1])<<8 | uint32(nb[2])<<16 | uint32(nb[3])<<24
		d := uint32(db[0]) | uint32(db[1])<<8 | uint32(db[2])<<16 | uint32(db[3])<<24
		w += 8
		name, _ := mem.Read(w, n)
		w += n + d
		total += int64(d)
		if i < 10 {
			fmt.Printf("   %s (%d bytes)\n", string(name), d)
		}
	}
	_, _ = freeFn.Call(ctx, uint64(bufPtr32_le))
	fmt.Printf("共 %d 个产物, %d bytes — wazero 纯 Go 内存直解成功\n", count32, total)
	return nil
}

func callI32(fn api.Function, args ...uint64) (uint32, error) {
	ret, err := fn.Call(context.Background(), args...)
	if err != nil {
		return 0, err
	}
	return uint32(ret[0]), nil
}

func allocWrite(mem api.Memory, malloc api.Function, data []byte) (uint64, error) {
	ptr, err := malloc.Call(context.Background(), uint64(len(data)))
	if err != nil {
		return 0, fmt.Errorf("malloc: %w", err)
	}
	p := ptr[0]
	if len(data) > 0 && !mem.Write(uint32(p), data) {
		return 0, fmt.Errorf("write %d bytes @%d", len(data), p)
	}
	return p, nil
}

// ---- emscripten libc syscall 垫片（最小实现，内存直出路径不触文件系统） ----

// sysGetdents64 目录枚举 stub：返回 0（EOF）
func sysGetdents64(ctx context.Context, mod api.Module, fd, buf, count uint32) int32 {
	return 0
}

// sysGetcwd 返回 "/output" 兜底
func sysGetcwd(ctx context.Context, mod api.Module, buf, size uint32) int32 {
	cwd := "/output\x00"
	if uint32(len(cwd)) > size || !mod.Memory().WriteString(buf, cwd) {
		return -75 // -ERANGE
	}
	return int32(len(cwd)) - 1
}

// sysReadlinkat 最小 stub：不支持符号链接，返回 -EINVAL
func sysReadlinkat(ctx context.Context, mod api.Module, fd int32, path, buf, size uint32) int32 {
	return -22
}
