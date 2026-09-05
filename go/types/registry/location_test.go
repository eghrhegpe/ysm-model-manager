// ===== types.TypeByLocation 单元测试（location 路由，2026-08-23 提取自 flow.go）=====
package types

import (
	"testing"
)

func TestTypeByLocation(t *testing.T) {
	reg := LoadRegistry()

	cases := []struct {
		path string
		want string
	}{
		// 仓库目录归属（storageSubDir）——mmd/PMX 是 EntityPlayer 仓库根
		{`/repo/mmd/PMX/角色包.zip`, "EntityPlayer"},
		{`/repo/mmd/PMX/表情.vpd`, "EntityPlayer"},
		{`/repo/mmd/PMX/角色.pmx`, "EntityPlayer"},
		// 各自目录归属
		{`/repo/mmd/DefaultMorph/表情.vpd`, "DefaultMorph"},
		{`/repo/mmd/CustomAnim/动作.vmd`, "CustomAnim"},
		// 深目录优先（内层命中优先于外层）
		{`/repo/mmd/PMX/DefaultMorph/内嵌.vpd`, "DefaultMorph"},
		// 实例目录归属（instanceDir，整合包 3d-skin 布局）
		{`/repo/3d-skin/SceneModel/场景.pmx`, "SceneModel"},
		{`/repo/3d-skin/EntityPlayer/角色.pmx`, "EntityPlayer"},
		// 未命中（散文件、其他目录）
		{`/repo/misc/说明.txt`, ""},
		{`/repo/ysm/模型A.ysm`, ""}, // ysm 无 storageSubDir/instanceDir
	}
	for _, tc := range cases {
		if got := TypeByLocation(tc.path, reg); got != tc.want {
			t.Errorf("TypeByLocation(%s) = %q, 期望 %q", tc.path, got, tc.want)
		}
	}
}

func TestTypeByLocation_NilRegistry(t *testing.T) {
	if got := TypeByLocation(`/repo/mmd/PMX/x.zip`, nil); got != "" {
		t.Errorf("nil registry 应返回空, got %q", got)
	}
	if got := TypeByLocation("", &ResourceTypeRegistry{}); got != "" {
		t.Errorf("空 path 应返回空, got %q", got)
	}
}
