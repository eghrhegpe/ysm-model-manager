//go:build ignore

package main

import (
	"context"
	"fmt"
	"os"

	"github.com/tetratelabs/wazero"
)

func main() {
	data, err := os.ReadFile("frontend/dist/wasm/YSMParser.wasm")
	if err != nil {
		fmt.Println("读取 WASM 失败:", err)
		os.Exit(1)
	}

	ctx := context.Background()
	r := wazero.NewRuntime(ctx)
	defer r.Close(ctx)

	m, err := r.CompileModule(ctx, data)
	if err != nil {
		fmt.Println("编译 WASM 失败:", err)
		os.Exit(1)
	}

	fmt.Println("=== 导出函数 ===")
	for _, fn := range m.ExportedFunctions() {
		name := fn.Name()
		if name == "" {
			name = "(unnamed)"
		}
		fmt.Println(" ", name, fn.ParamTypes(), fn.ResultTypes())
	}

	fmt.Println("\n=== 导入函数 ===")
	for _, fn := range m.ImportedFunctions() {
		mod := fn.ModuleName()
		if mod == "" {
			mod = "(empty module)"
		}
		name := fn.Name()
		if name == "" {
			name = "(unnamed)"
		}
		fmt.Printf("  %s.%s %v %v\n", mod, name, fn.ParamTypes(), fn.ResultTypes())
	}
}
