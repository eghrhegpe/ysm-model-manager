//go:build ignore

package main

import (
	"context"
	"fmt"
	"os"

	"github.com/tetratelabs/wazero"
)

func main() {
	data, err := os.ReadFile("C:\\Users\\zhujieling11\\YSMParser-main\\build-wasi\\YSMParser.wasm")
	if err != nil {
		fmt.Println("❌ 读取 WASM 失败:", err)
		os.Exit(1)
	}

	ctx := context.Background()
	r := wazero.NewRuntime(ctx)
	defer r.Close(ctx)

	m, err := r.CompileModule(ctx, data)
	if err != nil {
		fmt.Println("❌ 编译 WASM 失败:", err)
		os.Exit(1)
	}

	fmt.Println("=== 导出函数 ===")
	for _, fn := range m.ExportedFunctions() {
		name := fn.Name()
		if name == "" {
			name = "(unnamed)"
		}
		fmt.Printf("  %s %v → %v\n", name, fn.ParamTypes(), fn.ResultTypes())
	}

	fmt.Println("\n=== 导入函数 ===")
	hasWasi := false
	hasEnv := false
	for _, fn := range m.ImportedFunctions() {
		mod := fn.ModuleName()
		if mod == "" {
			mod = "(empty)"
		}
		name := fn.Name()
		if name == "" {
			name = "(unnamed)"
		}
		if mod == "wasi_snapshot_preview1" {
			hasWasi = true
		}
		if mod == "env" {
			hasEnv = true
		}
		fmt.Printf("  %s.%s %v → %v\n", mod, name, fn.ParamTypes(), fn.ResultTypes())
	}

	fmt.Println("\n=== 结论 ===")
	if hasEnv {
		fmt.Println("❌ 仍有 env.xxx Emscripten 依赖，wazero 无法直接运行")
	} else if hasWasi {
		fmt.Println("✅ 仅依赖 WASI，wazero 可直接运行！")
	} else {
		fmt.Println("⚠️  既无 WASI 也无 Emscripten 依赖（纯计算模块？）")
	}
}
