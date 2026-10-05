package ysmwasi

import (
	"context"
	"encoding/binary"
	"testing"

	"github.com/tetratelabs/wazero"
)

// TestReadOutBuf_ErrorPaths 定向补测 readOutBuf 的错误分支（2026-10-06 技术债审计
// P1：把 go/ysmwasi 覆盖率从 33.3% 补到 50% 以上）。原 33.3% 的主因不是 Decode 主路径
// 缺测（TestDecode_Malformed / TestConcurrency 已覆盖），而是 readOutBuf 的
// count=0 / count 超界 / nameLen 异常 / 总量超限 / 头不可读 等护栏分支零覆盖——
// 这些正是 ADR-316「解压炸弹防滥用」的核心防线，值得独立测试锁定。
//
// 用真实 wazero module（ensureInit 已编译）实例化后拿 mem/malloc/free，往内存写
// 畸形产物布局调 readOutBuf，断言返回 error——比 mock api.Memory 更真实，且
// 覆盖 malloc/write 的完整调用链。
func TestReadOutBuf_ErrorPaths(t *testing.T) {
	if err := ensureInit(); err != nil {
		t.Skipf("wasm 初始化失败（无内嵌 wasm 或工具链问题）: %v", err)
	}
	ctx := context.Background()
	mod, err := runtime.InstantiateModule(ctx, compiled, moduleCfg)
	if err != nil {
		t.Fatalf("实例化 module: %v", err)
	}
	defer mod.Close(ctx)
	mem := mod.Memory()
	freeFn := mod.ExportedFunction("free")
	mallocFn := mod.ExportedFunction("malloc")

	le32 := func(v uint32) []byte {
		b := make([]byte, 4)
		binary.LittleEndian.PutUint32(b, v)
		return b
	}
	// alloc 分配 n 字节内存并写入 buf，返回起始指针（模拟 decodeWith 里 malloc+write 输出槽）
	alloc := func(buf []byte) uint32 {
		t.Helper()
		r, err := mallocFn.Call(ctx, uint64(len(buf)))
		if err != nil {
			t.Fatalf("malloc %d bytes: %v", len(buf), err)
		}
		ptr := uint32(r[0])
		if !mem.Write(ptr, buf) {
			t.Fatalf("写入 %d bytes 到 mem[%d] 失败", len(buf), ptr)
		}
		return ptr
	}

	cases := []struct {
		name string
		buf  []byte
	}{
		{"count=0（空产物）", le32(0)},
		{"count 超 65536 上限", le32(1<<16 + 1)},
		{"nameLen=0", append(le32(1), le32(0)...)},
		{"nameLen=4097 超上限", append(le32(1), le32(4097)...)},
		{"dataLen 超总量护栏", append(append(append(le32(1), le32(1)...), le32(uint32(maxOutput))...), 0)},
	}
	for _, c := range cases {
		ptr := alloc(c.buf)
		if _, err := readOutBuf(ctx, mem, freeFn, ptr); err == nil {
			t.Errorf("%s: 应返回 error，得到 nil", c.name)
		}
	}

	// happy path：count=1, nameLen=1("a"), dataLen=2("bc") → 应成功解析
	happy := append(append(append(append(le32(1), le32(1)...), le32(2)...), 'a'), 'b', 'c')
	ptr := alloc(happy)
	files, err := readOutBuf(ctx, mem, freeFn, ptr)
	if err != nil {
		t.Fatalf("happy path 不应报错: %v", err)
	}
	if len(files) != 1 || files[0].Path != "a" || string(files[0].Data) != "bc" {
		t.Fatalf("happy path 解析异常: %+v（期望 1 个文件 Path=a Data=bc）", files)
	}
}

// TestDecodeWith_NilExports 补测 decodeWith 的「wasm 导出缺失」分支——用一个不含
// malloc/free/ysm_decode_to_memory 的极小 wasm module 实例化后调 decodeWith，
// 断言返回 error（覆盖 ysmwasi.go:149-151 的导出缺失护栏）。
func TestDecodeWith_NilExports(t *testing.T) {
	// 合法空 wasm module（仅 magic+version，零 section、零导出）→ 实例化成功后
	// ExportedFunction 全部返回 nil → 必触发 decodeWith 的「导出缺失」护栏
	empty := []byte{
		0x00, 0x61, 0x73, 0x6d, // magic
		0x01, 0x00, 0x00, 0x00, // version
	}
	ctx := context.Background()
	rt := wazero.NewRuntimeWithConfig(ctx, wazero.NewRuntimeConfig())
	defer rt.Close(ctx)
	cm, err := rt.CompileModule(ctx, empty)
	if err != nil {
		t.Fatalf("编译空 wasm: %v", err)
	}
	if _, err := decodeWith(ctx, rt, cm, []byte("hello")); err == nil {
		t.Fatal("导出缺失的 module 应返回 error")
	}
}

// TestDecodeWith_InstErr 补测 decodeWith 的「module 实例化失败」分支——用带导出但
// 内存/导出缺失的 module 或故意传不匹配数据触发实例化/调用失败。
// 简单可靠做法：传超长输入触发 wasm 内 malloc 失败或 decode trap（畸形输入）。
func TestDecodeWith_MalformedTrap(t *testing.T) {
	if err := ensureInit(); err != nil {
		t.Skipf("wasm 初始化失败: %v", err)
	}
	ctx := context.Background()
	// 直接调 decodeWith 复用生产路径（等同 Decode 内部），畸形数据 → decode trap
	if _, err := decodeWith(ctx, runtime, compiled, []byte{0xDE, 0xAD, 0xBE, 0xEF}); err == nil {
		t.Fatal("畸形输入 decodeWith 应返回 error（parser abort → trap）")
	}
}
