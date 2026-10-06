package app

import (
	"reflect"
	"testing"
)

// ===== buildCLIArgs / appendSpecKey：参数拼装逐项内容与顺序 =====
//
// 失败模式 = 拼错参数导致子进程行为不同，且错误常在跨进程边界才暴露。
// 故断言的对象是「产出的 args 切片逐项内容与顺序」（含 flag 形态：--k v / --k= / --k），
// 以及告警条数——不只看「产出了东西」。

// specPathSpec 覆盖三种类型 × AllowEmpty 两态 × 跨类型混排的规格集
var specPathSpec = []ParamSpecDTO{
	{Key: "keyword", Type: "string"},
	{Key: "empty-ok", Type: "string", AllowEmpty: true},
	{Key: "min-bones", Type: "number"},
	{Key: "zero-ok", Type: "number", AllowEmpty: true},
	{Key: "verbose", Type: "bool"},
	{Key: "false-ok", Type: "bool", AllowEmpty: true},
	{Key: "mystery", Type: "widget"}, // 规格类型未知
}

// TestAppendSpecKey_PerTypePerAllowEmpty 逐键形态：guard 顺序与错误优先级原样
// （类型不符 → 告警跳过；空值 → 仅 AllowEmpty 产出显式形态；未知规格类型 → 告警）。
func TestAppendSpecKey_PerTypePerAllowEmpty(t *testing.T) {
	cases := []struct {
		name      string
		spec      ParamSpecDTO
		val       interface{}
		wantArgs  []string
		wantWarns int
	}{
		{"string非空→两元素形态", ParamSpecDTO{Key: "k", Type: "string"}, "steve", []string{"--k", "steve"}, 0},
		{"string空且不允许空→丢弃", ParamSpecDTO{Key: "k", Type: "string"}, "", nil, 0},
		{"string空且允许空→--k=形态", ParamSpecDTO{Key: "k", Type: "string", AllowEmpty: true}, "", []string{"--k="}, 0},
		{"string类型不符→告警跳过", ParamSpecDTO{Key: "k", Type: "string"}, float64(1), nil, 1},
		{"number整数→%d无小数点", ParamSpecDTO{Key: "k", Type: "number"}, float64(512), []string{"--k", "512"}, 0},
		{"number非整数→%g", ParamSpecDTO{Key: "k", Type: "number"}, float64(2.5), []string{"--k", "2.5"}, 0},
		{"number零且不允许空→丢弃", ParamSpecDTO{Key: "k", Type: "number"}, float64(0), nil, 0},
		{"number零且允许空→占用两元素", ParamSpecDTO{Key: "k", Type: "number", AllowEmpty: true}, float64(0), []string{"--k", "0"}, 0},
		{"number类型不符→告警跳过", ParamSpecDTO{Key: "k", Type: "number"}, "1", nil, 1},
		{"bool真→单元素开关", ParamSpecDTO{Key: "k", Type: "bool"}, true, []string{"--k"}, 0},
		{"bool假且不允许空→丢弃", ParamSpecDTO{Key: "k", Type: "bool"}, false, nil, 0},
		{"bool假且允许空→--k=false形态", ParamSpecDTO{Key: "k", Type: "bool", AllowEmpty: true}, false, []string{"--k=false"}, 0},
		{"bool类型不符→告警跳过", ParamSpecDTO{Key: "k", Type: "bool"}, "true", nil, 1},
		{"未知规格类型→告警跳过", ParamSpecDTO{Key: "k", Type: "widget"}, "v", nil, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var warns []string
			got := appendSpecKey(nil, tc.spec, tc.val, &warns)
			if len(got) != len(tc.wantArgs) {
				t.Fatalf("args 长度: got %v, want %v", got, tc.wantArgs)
			}
			for i := range tc.wantArgs {
				if got[i] != tc.wantArgs[i] {
					t.Fatalf("args[%d]: got %q, want %q（全量 got=%v）", i, got[i], tc.wantArgs[i], got)
				}
			}
			if len(warns) != tc.wantWarns {
				t.Fatalf("告警数: got %d %v, want %d", len(warns), warns, tc.wantWarns)
			}
		})
	}
}

// TestBuildCLIArgs_SpecPathFullSequence 规格路径全量拼装：base 前缀 + 逐项顺序 = 声明序，
// 未知类型键静默跳过、未声明键走 legacy 尾部追加（告警）。
func TestBuildCLIArgs_SpecPathFullSequence(t *testing.T) {
	got, warns := buildCLIArgs("bench", []string{"--files-root", "/r"}, map[string]interface{}{
		"false-ok":  false,      // 允许空 → --false-ok=false
		"keyword":   "steve",    // 声明第 1 位
		"verbose":   true,       // 声明第 5 位 → 在 keyword 之后
		"zero-ok":   float64(0), // 允许空 → --zero-ok 0
		"min-bones": float64(5), // 声明第 3 位
		"empty-ok":  "",         // 允许空 → --empty-ok=
		"mystery":   "x",        // 未知规格类型 → 告警跳过，不进 args
		"typo":      "oops",     // 未声明 → legacy 尾部追加（告警）
	}, specPathSpec)

	// 顺序 = 规格声明序：keyword → empty-ok → min-bones → zero-ok → verbose → false-ok；尾部 legacy
	want := []string{
		"--files-root", "/r",
		"--keyword", "steve",
		"--empty-ok=",
		"--min-bones", "5",
		"--zero-ok", "0",
		"--verbose",
		"--false-ok=false",
		"--typo", "oops",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("args 逐项不匹配:\n  got:  %#v\n  want: %#v", got, want)
	}
	if len(warns) != 2 {
		t.Fatalf("期望 2 条告警（未知规格类型 + 未声明键），实际 %d: %v", len(warns), warns)
	}
}

// TestBuildCLIArgs_UnregisteredValueNotProduced 未声明键即使值非空也按 legacy 追加；
// 未传的键（present=false）绝不出现在 args 中——「未传 vs 传空」可区分的前提。
func TestBuildCLIArgs_UnregisteredValueNotProduced(t *testing.T) {
	got, warns := buildCLIArgs("bench", nil, map[string]interface{}{
		"verbose": false, // 传了 false 且 AllowEmpty=false → 不产出（与未传同形）
	}, []ParamSpecDTO{
		{Key: "verbose", Type: "bool"},
		{Key: "keyword", Type: "string"},
	})
	if len(got) != 0 {
		t.Fatalf("空值键不应产出，got %v", got)
	}
	if len(warns) != 0 {
		t.Fatalf("空值丢弃不应告警: %v", warns)
	}
}

// TestBuildCLIArgs_PrefixPreserved base 前缀逐项原样保留在输出最前（files-root 由调用方先行处理）
func TestBuildCLIArgs_PrefixPreserved(t *testing.T) {
	base := []string{"--cli", "--files-root", "C:\\root"}
	got, _ := buildCLIArgs("search", base, map[string]interface{}{"keyword": "x"},
		[]ParamSpecDTO{{Key: "keyword", Type: "string"}})
	want := []string{"--cli", "--files-root", "C:\\root", "--keyword", "x"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("前缀/顺序不匹配:\n  got:  %#v\n  want: %#v", got, want)
	}
}
