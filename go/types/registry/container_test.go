package types

import (
	"reflect"
	"testing"
)

// 容器扩展名判定（IsContainerExt / ContainerExts）：
// .zip/.7z 是通用容器（ADR-067），类型归属必须走内容指纹，容器集合单源在此。
func TestIsContainerExt(t *testing.T) {
	cases := []struct {
		ext  string
		want bool
	}{
		{".zip", true},
		{".ZIP", true},
		{".Zip", true},
		{".7z", true},
		{".7Z", true},
		{".ysm", false},
		{".pmx", false},
		{".nbt", false},
		{"zip", false},   // 无点前缀不算扩展名
		{"", false},      // 空串
		{".zipp", false}, // 前缀碰撞不得误判
	}
	for _, c := range cases {
		if got := IsContainerExt(c.ext); got != c.want {
			t.Errorf("IsContainerExt(%q) = %v, want %v", c.ext, got, c.want)
		}
	}
}

func TestContainerExts_SetStable(t *testing.T) {
	got := ContainerExts()
	want := []string{".zip", ".7z"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("ContainerExts() = %v, want %v", got, want)
	}
	// 集合语义：每个返回的扩展名都应被 IsContainerExt 判定为容器
	for _, e := range got {
		if !IsContainerExt(e) {
			t.Errorf("ContainerExts() 成员 %q 未被 IsContainerExt 判定为容器", e)
		}
	}
}
