// specgen 渲染对齐对比用：读 Bedrock geometry JSON → threejs.Build() → stdout
// 用法: go run ./tests/port-verification/cmd/specgen <geometry.json>
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/threejs"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: specgen <geometry.json>")
		os.Exit(1)
	}
	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, "read:", err)
		os.Exit(1)
	}
	model := geometry.ParseBedrockGeometry(data)
	if model == nil {
		fmt.Fprintln(os.Stderr, "ParseBedrockGeometry 失败")
		os.Exit(1)
	}
	spec, err := threejs.Build(*model)
	if err != nil {
		fmt.Fprintln(os.Stderr, "threejs.Build:", err)
		os.Exit(1)
	}
	// 美化输出（对比脚本需要确定性键序）
	var v any
	if err := json.Unmarshal([]byte(spec), &v); err != nil {
		fmt.Fprintln(os.Stderr, "unmarshal:", err)
		os.Exit(1)
	}
	out, _ := json.MarshalIndent(v, "", "  ")
	fmt.Println(string(out))
}
