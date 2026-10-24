// 回归守护：Model3DSpec typed 往返必须保留 texArrOrder / componentTextures。
// 历史：936169b1 将 GetModel3DSpec 改为 typed 返回时结构体缺这两字段，
// 注入被 json.Unmarshal 静默丢弃 → 前端 perComponent 纹理绑定全体回落全局槽
// （maid 只取首角色材质 / foxcar 错贴 skin）。
package threejs

import (
	"encoding/json"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

func TestModel3DSpecRoundTripKeepsInjectedFields(t *testing.T) {
	raw := `{"models":[{"id":"comp_0","name":"foxcar","textureWidth":512,"textureHeight":89}]}`
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		testutil.NoError(t, err)
	}
	// 复刻 app_model.go injectTexArrOrder + injectComponentTextures 注入
	m["texArrOrder"] = []string{"skin", "", "", "", "foxcar"}
	m["componentTextures"] = map[string][]string{"foxcar": {"data:image/png;base64,XXX"}}
	injected, err := json.Marshal(m)
	testutil.NoError(t, err)

	var spec Model3DSpec
	if err := json.Unmarshal(injected, &spec); err != nil {
		testutil.NoError(t, err)
	}
	// OR 型复合条件拆序贯：len 前置守卫防 TexArrOrder[4] 越界（原 if len!=5 || [4]!="foxcar"）
	testutil.Equal(t, len(spec.TexArrOrder), 5, "texArrOrder 往返丢失/错序: %#v", spec.TexArrOrder)
	testutil.Equal(t, spec.TexArrOrder[4], "foxcar", "texArrOrder 往返丢失/错序: %#v", spec.TexArrOrder)
	testutil.Equal(t, len(spec.ComponentTextures["foxcar"]), 1, "componentTextures 往返丢失: %#v", spec.ComponentTextures)

	// 再序列化（Wails 桥出参）字段仍须在场
	out, err := json.Marshal(spec)
	testutil.NoError(t, err)
	var back map[string]any
	if err := json.Unmarshal(out, &back); err != nil {
		testutil.NoError(t, err)
	}
	_, ok := back["texArrOrder"]
	testutil.Equal(t, ok, true, "再序列化后 texArrOrder 缺失")
	_, ok = back["componentTextures"]
	testutil.Equal(t, ok, true, "再序列化后 componentTextures 缺失")
}
