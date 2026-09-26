package ysmwasi

import (
	"bytes"
	"os"
	"testing"
)

// TestImportsClosedSet 契约测试（ADR-316 D3）：内嵌 wasm 的导入集是闭集，
// 上游 Parser 更新若引入新导入（libc syscall / env 函数），本测试先红再修——
// 防「happy path 闭集」悄悄漂移成运行期 trap。
// 期望闭集：4 个 env 垫片（Go 侧实现）+ 10 个 wasi_snapshot_preview1。
func TestImportsClosedSet(t *testing.T) {
	got := parseWasmImports(t, wasmBinary)
	want := map[string]int{
		"env":                    4,  // Go 垫片：getdents64/getcwd/readlinkat + notify_memory_growth
		"wasi_snapshot_preview1": 10, // wazero 内置
	}
	if len(got) == 0 {
		t.Fatal("导入集为空（解析器失真或 wasm 损坏）")
	}
	if len(got["env"]) != want["env"] {
		t.Errorf("env 导入数漂移: got %v, 期望恰好 4 个", got["env"])
	}
	if len(got["wasi_snapshot_preview1"]) != want["wasi_snapshot_preview1"] {
		t.Errorf("wasi 导入数漂移: got %v, 期望恰好 10 个", got["wasi_snapshot_preview1"])
	}
	for mod := range got {
		if mod != "env" && mod != "wasi_snapshot_preview1" {
			t.Errorf("未知导入模块 %q（上游 Parser 引入了新 env 依赖？）", mod)
		}
	}
}

// parseWasmImports 最小 wasm 二进制解析：只走 section 1 (import)，
// 产出 module -> []name。若上游重编 wasm 后格式变化，测试红提示人工核对。
func parseWasmImports(t *testing.T, bin []byte) map[string][]string {
	t.Helper()
	r := bytes.NewReader(bin)
	readByte := func() byte {
		b, _ := r.ReadByte()
		return b
	}
	readU32 := func() uint32 {
		var v uint32
		var shift uint
		for {
			b := readByte()
			v |= uint32(b&0x7f) << shift
			if b&0x80 == 0 {
				return v
			}
			shift += 7
		}
	}
	magic := make([]byte, 4)
	if _, err := r.Read(magic); err != nil || string(magic) != "\x00asm" {
		t.Fatalf("非 wasm 魔数: %q", magic)
	}
	_ = readByte() // 版本字节 1/4（wasm 版本固定 u32 LE，此处魔数已验，版本略过）
	readByte()
	readByte()
	readByte()
	imports := map[string][]string{}
	for r.Len() > 0 {
		secID := readByte()
		size := readU32()
		body := make([]byte, size)
		if _, err := r.Read(body); err != nil {
			t.Fatalf("section 读取失败: %v", err)
		}
		if secID != 2 { // 仅 import section（wasm 规范：1=type, 2=import）
			continue
		}
		br := bytes.NewReader(body)
		readB := func() byte {
			b, _ := br.ReadByte()
			return b
		}
		readV := func() uint32 {
			var v uint32
			var shift uint
			for {
				b := readB()
				v |= uint32(b&0x7f) << shift
				if b&0x80 == 0 {
					return v
				}
				shift += 7
			}
		}
		count := readV()
		for i := uint32(0); i < count; i++ {
			ml := readV()
			mod := make([]byte, ml)
			_, _ = br.Read(mod)
			nl := readV()
			nm := make([]byte, nl)
			_, _ = br.Read(nm)
			kind := readB() // 0=func, 1=table, 2=memory, 3=global
			switch kind {
			case 0:
				_ = readV() // type index
			case 1:
				_ = readB()
				_ = readV()
				if readB() == 1 {
					_ = readV()
				}
			case 2:
				_ = readB()
				if readB() == 1 {
					_ = readV()
				}
			case 3:
				_ = readB()
				_ = readB()
			}
			imports[string(mod)] = append(imports[string(mod)], string(nm))
		}
	}
	return imports
}

// TestDecode_InputTooLarge 护栏：超限输入在进入 wasm 前拒绝
func TestDecode_InputTooLarge(t *testing.T) {
	big := make([]byte, maxInput+1)
	if _, err := Decode(big); err == nil {
		t.Fatal("超限输入应返回 error")
	}
}

// TestDecode_Malformed 畸形输入：noeh 构建下 parser abort → wazero error，
// 必须可恢复返回（不 panic、不崩进程）——ADR-316 D2 的核心验证点
func TestDecode_Malformed(t *testing.T) {
	for name, data := range map[string][]byte{
		"空":          {},
		"全零":         make([]byte, 64),
		"垃圾字节":       bytes.Repeat([]byte{0xDE, 0xAD, 0xBE, 0xEF}, 32),
		"截断魔数":       []byte("YSM"),
		"超长伪数据(1MB)": bytes.Repeat([]byte{0x01}, 1<<20),
	} {
		files, err := Decode(data)
		if err == nil {
			t.Errorf("%s 输入应返回 error，得到 %d 个文件", name, len(files))
		}
	}
}

// TestDecode_RealFixture 真实样本冒烟（默认跳过，CI 无加密样本）：
// YSMWASI_TEST_FIXTURE=<.ysm 路径> go test ./go/ysmwasi/ -run TestDecode_RealFixture -v
func TestDecode_RealFixture(t *testing.T) {
	path := os.Getenv("YSMWASI_TEST_FIXTURE")
	if path == "" {
		t.Skip("未设置 YSMWASI_TEST_FIXTURE，跳过真实样本冒烟")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取样本: %v", err)
	}
	files, err := Decode(data)
	if err != nil {
		t.Fatalf("解码失败: %v", err)
	}
	if len(files) == 0 {
		t.Fatal("产物为空")
	}
	t.Logf("解码 %d 个产物:", len(files))
	var total int
	for _, f := range files {
		total += len(f.Data)
		t.Logf("  %s (%d bytes)", f.Path, len(f.Data))
	}
	t.Logf("共 %d bytes", total)
}

// TestConcurrency 并发解码：module 每次实例化独占堆，并发调用不得串数据/死锁
func TestConcurrency(t *testing.T) {
	const n = 4
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		go func() {
			_, err := Decode(bytes.Repeat([]byte{0x00}, 128))
			errs <- err
		}()
	}
	for i := 0; i < n; i++ {
		if err := <-errs; err == nil {
			t.Error("垃圾输入应返回 error（此处只验证并发路径不 panic/不死锁）")
		}
	}
}
