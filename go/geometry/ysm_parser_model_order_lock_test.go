// ===== parseModelOrder 白盒数据锁定测试（gocyclo 拆解红线）=====
// parseModelOrder 生产调用点只有 1 处（parseYsmArchive 里 player.model 段），
// 测试侧此前 **零直调**：ysm_parser_test.go 只覆盖了 texBasenameNoExt 与 parseProjModels。
// 它只被 ParseFromZip 黑盒间接执行（改造前 go tool cover 实测 91.9%），而
// 「声明序」正是 texSlot 绑定的输入——顺序静默偏差 = 纹理错绑，却没有一条断言钉住它。
//
// 本文件钉死四形态（数组/对象 map/单字符串/空）的**返回序列本体**：
// 元素顺序、空元素跳过、path 优先 name 兜底、map 写入序、非字符串 value 之后的好键不丢。
package geometry

import (
	"encoding/json"
	"testing"
	"time"
)

// TestParseModelOrder_FourFormsDeclarationOrder 四形态声明序 + 返回序列本体。
func TestParseModelOrder_FourFormsDeclarationOrder(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want []string
	}{
		{"空串", "", nil},
		{"单字符串", `"main.geo.json"`, []string{"main.geo.json"}},
		{"单字符串为空", `""`, nil},
		{"数组字符串", `["main.geo.json","arm.geo.json"]`, []string{"main.geo.json", "arm.geo.json"}},
		{"数组空元素跳过", `["a","","b"]`, []string{"a", "b"}},
		{"数组对象 path 优先", `[{"path":"a.geo.json","name":"ignored"}]`, []string{"a.geo.json"}},
		{"数组对象 name 兜底", `[{"name":"b.geo.json"}]`, []string{"b.geo.json"}},
		{"数组对象双空丢弃", `[{"path":"","name":""}]`, nil},
		{"数组数字元素丢弃", `[1,2]`, nil},
		{"数组混合保序", `["x",{"name":"y"},"z"]`, []string{"x", "y", "z"}},
		{"对象 map 写入序", `{"main":"main.geo.json","arm":"arm.geo.json"}`, []string{"main.geo.json", "arm.geo.json"}},
		{"对象空值丢弃", `{"a":"","b":"b.geo.json"}`, []string{"b.geo.json"}},
		{"空对象", `{}`, nil},
		{"畸形数组", `[not json`, nil},
		{"畸形单值", `not json`, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseModelOrder(tc.raw)
			if !equalStrings(got, tc.want) {
				t.Fatalf("parseModelOrder(%q) = %v, 期望 %v", tc.raw, got, tc.want)
			}
		})
	}
}

// TestParseModelOrder_ObjectNonStringValueKeepsLaterKeys：契约红线（源码注释明写）——
// 对象的非字符串 value（数字/对象/数组）Decode 报错但已消费完该值，实现 **跳过继续**；
// 若改成 break，后续好键（main 等）会全部丢失 → player 模型声明残缺。
// 本用例是「跳过 vs 中断」的唯一行为判据，重构时不得让错误分支提前退出循环。
func TestParseModelOrder_ObjectNonStringValueKeepsLaterKeys(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want []string
	}{
		{"数字 value 后好键保留", `{"bad":1,"main":"main.geo.json"}`, []string{"main.geo.json"}},
		{"对象 value 后好键保留", `{"bad":{"nested":1},"main":"main.geo.json"}`, []string{"main.geo.json"}},
		{"数组 value 后好键保留", `{"bad":[1,2],"main":"main.geo.json"}`, []string{"main.geo.json"}},
		{"坏键夹在两个好键之间", `{"first":"a.geo.json","bad":1,"main":"main.geo.json"}`, []string{"a.geo.json", "main.geo.json"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseModelOrder(tc.raw)
			if !equalStrings(got, tc.want) {
				t.Fatalf("parseModelOrder(%q) = %v, 期望 %v（非字符串 value 必须跳过而非中断）", tc.raw, got, tc.want)
			}
		})
	}
}

// TestParseModelOrderArrayItem_DirectContract 直喂数组单元素 helper：
// 数组路径下 RawMessage 恒为合法 JSON 片段，故「空元素 / 对象解析失败 / 字符串解析失败」
// 三条降级在本 helper 之外构造不出来（原内联版本同样从未被覆盖），
// 拆出后直接钉住，防重构顺手把它们删成"不可能发生"。
func TestParseModelOrderArrayItem_DirectContract(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{"纯空白元素 → 空", "   ", ""},
		{"对象语法损坏 → 空", "{broken", ""},
		{"非字符串非对象 → 空", "not json", ""},
		{"path 优先", `{"path":"p.geo.json","name":"n.geo.json"}`, "p.geo.json"},
		{"name 兜底", `{"name":"n.geo.json"}`, "n.geo.json"},
		{"双空 → 空", `{"path":"","name":""}`, ""},
		{"字符串直读", `"s.geo.json"`, "s.geo.json"},
		{"空字符串 → 空", `""`, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := parseModelOrderArrayItem(json.RawMessage(tc.raw)); got != tc.want {
				t.Fatalf("parseModelOrderArrayItem(%q) = %q, 期望 %q", tc.raw, got, tc.want)
			}
		})
	}
}

// TestParseModelOrderMap_NonObjectInput 首 token 非 '{'（数组/标量/空串）→ nil：
// 与 parseModelOrder 的分派（raw[0]=='{'）不同，helper 自身也要对任意串给出确定降级。
func TestParseModelOrderMap_NonObjectInput(t *testing.T) {
	for _, raw := range []string{"[1,2]", `"str"`, "123", ""} {
		if got := parseModelOrderMap(raw); len(got) != 0 {
			t.Fatalf("parseModelOrderMap(%q) = %v, 期望空", raw, got)
		}
	}
}

// TestParseModelOrder_MalformedObjectTerminates：改造中发现并修掉的**死循环**回归守卫。
//
// 改造前实现的对象分支是 `for dec.More() { tok, err := dec.Token(); if err != nil { continue } ... }`：
// 语法损坏的对象（首个'}'前出现 `not` 这类非法 token）会让 dec.Token() 恒返回 err 而
// dec.More() 恒返回 true —— continue 不推进游标，函数**永不返回**（实测 go test 2 分钟超时挂死，
// 栈停在 encoding/json.(*Decoder).Token）。这不是"静默解析错"，是更硬的挂死。
//
// 键 token 读失败改为 break（语法已损坏，无键可救）；**value Decode 失败仍 continue**
// （那条注释保护的"后续好键不丢"语义不变，见上一个用例）。
//
// 用 goroutine + 超时兜住：真回归时 5 秒内红，而不是把整个测试套件拖到 -timeout 硬挂。
// 可及性说明：parseModelOrder 当前唯一生产调用点传的是 ysm.json 里已由顶层
// json.Unmarshal 校验过语法的 RawMessage，故本死循环在现行调用链上不可达（属函数自身契约缺陷，非线上故障）。
func TestParseModelOrder_MalformedObjectTerminates(t *testing.T) {
	done := make(chan []string, 1)
	go func() { done <- parseModelOrder(`{not json`) }()
	select {
	case got := <-done:
		if len(got) != 0 {
			t.Fatalf("畸形对象应返回空序列, got %v", got)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("parseModelOrder 对畸形对象输入未终止（dec.Token 出错后 continue 不推进游标 → 死循环）")
	}
}
