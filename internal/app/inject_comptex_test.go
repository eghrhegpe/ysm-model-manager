// ===== buildComponentTextureMap 单测（ADR-114 perComponent，typed 化后口径）=====
package app

import (
	"encoding/json"
	"testing"

	"ysm-model-manager/go/threejs"
	"ysm-model-manager/go/types"
)

// TestBuildComponentTextureMap 验证：comps 的 ComponentTextures 提取为 typed map；
// 全部为空时返回 nil（omitempty 序列化不注入）；SourceName 空值 fallback / 碰撞覆盖语义不变。
func TestBuildComponentTextureMap(t *testing.T) {
	comps := []types.BedrockModel{
		{SourceName: "main"}, // 已声明组件：无 ComponentTextures
		{SourceName: "arrow", Bones: []types.Bone2D{{Name: "arrow"}}, ComponentTextures: map[string][]string{
			"arrow": {"data:image/png;base64,QUJD"},
		}},
	}
	got := buildComponentTextureMap(comps)
	if len(got) != 1 {
		t.Fatalf("应提取 1 个组件纹理，实际 %v", got)
	}
	if got["arrow"][0] != "data:image/png;base64,QUJD" {
		t.Errorf("arrow 纹理内容不符: %v", got["arrow"])
	}

	// 无 perComponent 数据：nil（omitempty → 不注入）
	if nilGot := buildComponentTextureMap([]types.BedrockModel{{SourceName: "main"}}); nilGot != nil {
		t.Errorf("无数据时应返回 nil，实际 %v", nilGot)
	}

	// SourceName 为空时 fallback 到 comp_<i>
	gotFb := buildComponentTextureMap([]types.BedrockModel{
		{SourceName: "", Bones: []types.Bone2D{{Name: "x"}}, ComponentTextures: map[string][]string{"x": {"data:image/png;base64,FALL"}}},
	})
	if gotFb["comp_0"][0] != "data:image/png;base64,FALL" {
		t.Errorf("fallback 键应为 comp_0，实际 %v", gotFb)
	}

	// SourceName 碰撞（zip 内两个子目录同名 geometry 文件）：后写覆盖前写并 log 告警
	gotDup := buildComponentTextureMap([]types.BedrockModel{
		{SourceName: "dup", Bones: []types.Bone2D{{Name: "a"}}, ComponentTextures: map[string][]string{"a": {"data:image/png;base64,DUP1"}}},
		{SourceName: "dup", Bones: []types.Bone2D{{Name: "b"}}, ComponentTextures: map[string][]string{"b": {"data:image/png;base64,DUP2"}}},
	})
	if gotDup["dup"][0] != "data:image/png;base64,DUP2" {
		t.Errorf("碰撞后键 dup 应为后写纹理 DUP2，实际 %v", gotDup["dup"])
	}
}

// TestModel3DSpecTypedRoundTrip 守护回归 936169b1：typed 字段直填后经
// Marshal/Unmarshal 往返必须保留（注入链已无 string 双轨，此测试防结构体字段被再删）。
func TestModel3DSpecTypedRoundTrip(t *testing.T) {
	spec := threejs.Model3DSpec{
		TexArrOrder:       []string{"skin", "", "", "", "foxcar"},
		ComponentTextures: map[string][]string{"foxcar": {"data:image/png;base64,XXX"}},
	}
	b, err := json.Marshal(spec)
	if err != nil {
		t.Fatal(err)
	}
	var back threejs.Model3DSpec
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatal(err)
	}
	if len(back.TexArrOrder) != 5 || back.TexArrOrder[4] != "foxcar" {
		t.Fatalf("texArrOrder 往返丢失/错序: %#v", back.TexArrOrder)
	}
	if len(back.ComponentTextures["foxcar"]) != 1 {
		t.Fatalf("componentTextures 往返丢失: %#v", back.ComponentTextures)
	}

	// 全空 spec：omitempty 不应序列化出空键（旧「不注入空对象」语义）
	empty, _ := json.Marshal(threejs.Model3DSpec{})
	if string(empty) == `{"texArrOrder":null,"componentTextures":null}` || len(empty) > 15 {
		t.Errorf("空 spec 应最小序列化，实际 %s", string(empty))
	}
}
