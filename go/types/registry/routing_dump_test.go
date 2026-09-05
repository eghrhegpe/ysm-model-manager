package types_test

import (
	"fmt"
	"testing"

	"ysm-model-manager/go/types"
)

// TestDumpRouting 诊断：打印每个资源类型算出的存储路由
// （group / storageSubDir / GroupStorageRoot）。
// 用于核对两层路由 FilesRoot/{group}/{storageSubDir} 是否如预期，
// 排查"目录扁平散开（只建 storageSubDir 单层）"问题。
func TestDumpRouting(t *testing.T) {
	reg := types.LoadRegistry()
	fmt.Println("=== 注册表路由诊断（编译态 / root resource_types.json）===")
	for _, rt := range reg.ResourceTypes {
		fmt.Printf("id=%-18s group=%-14s storageSubDir=%-18s GroupStorageRoot=%q\n",
			rt.ID, rt.Group, rt.StorageSubDir, types.GroupStorageRoot(rt.ID))
	}
}
