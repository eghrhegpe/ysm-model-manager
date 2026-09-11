package ccheck

import (
	"go/ast"
	"go/parser"
	"go/token"
	"reflect"
	"testing"
)

// 发射器（emitFromNode 家族）语义锚点。
//
// 背景：发射端无法与 TS 侧做向量对拍（跨语言 AST 不同构），故此前长期零直接测试，
// 靠 CognitiveFromSeq 的契约向量间接覆盖——导致 gocyclo 34 / S1016 静默溜过 73 个提交。
// 本文件以「源码片段 → 期望事件序列」钉死发射语义：重构拆分函数时若改变发射
// 顺序或漏发事件，此处立即红。配合 tests/test_complexity_parity.ts 形成双保险。

// eventsFromSrc 解析单个函数声明并返回其函数体事件序列。
func eventsFromSrc(t *testing.T, src string) []Event {
	t.Helper()
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, "fixture.go", "package p\n"+src, parser.ParseComments)
	if err != nil {
		t.Fatalf("解析失败: %v\n源码:\n%s", err, src)
	}
	for _, decl := range f.Decls {
		fd, ok := decl.(*ast.FuncDecl)
		if !ok {
			continue
		}
		return FnBodyToEvents(fd)
	}
	t.Fatal("未找到函数声明")
	return nil
}

// 期望序列的简写构造器（只关心 K/KindName 两个契约字段）。
func ev(k, kind string) Event { return Event{K: k, KindName: kind} }

// nestClose 事件不带 KindName（发射端原样发 Event{K:"nestClose"}）。
func closeEv() Event { return Event{K: "nestClose"} }

func TestEmitFlatIf(t *testing.T) {
	got := eventsFromSrc(t, "func f() {\n\tif x > 0 {\n\t\t_ = 1\n\t}\n}")
	want := []Event{ev("nest", "if"), closeEv()}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("平坦 if:\n got %+v\nwant %+v", got, want)
	}
}

func TestEmitIfElseEmitsFlatElse(t *testing.T) {
	// else 是即时型 flat（不增层），须发在 nestClose 之前——顺序即契约。
	got := eventsFromSrc(t, "func f() {\n\tif x > 0 {\n\t\t_ = 1\n\t} else {\n\t\t_ = 2\n\t}\n}")
	want := []Event{ev("nest", "if"), ev("flat", "else"), closeEv()}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("if-else:\n got %+v\nwant %+v", got, want)
	}
}

func TestEmitNestedIfDepth(t *testing.T) {
	got := eventsFromSrc(t, "func f() {\n\tif a {\n\t\tif b {\n\t\t\t_ = 1\n\t\t}\n\t}\n}")
	want := []Event{
		ev("nest", "if"), ev("nest", "if"), closeEv(), closeEv(),
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("双嵌套 if:\n got %+v\nwant %+v", got, want)
	}
}

func TestEmitLoopFamiliesAllMapToLoop(t *testing.T) {
	for _, tc := range []struct{ name, src string }{
		{"for", "func f() {\n\tfor i := 0; i < 3; i++ {\n\t\t_ = i\n\t}\n}"},
		{"range", "func f() {\n\tfor range []int{1} {\n\t\t_ = 1\n\t}\n}"},
	} {
		got := eventsFromSrc(t, tc.src)
		want := []Event{ev("nest", "loop"), closeEv()}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("%s:\n got %+v\nwant %+v", tc.name, got, want)
		}
	}
}

func TestEmitSwitchFamiliesAllMapToSwitch(t *testing.T) {
	for _, tc := range []struct{ name, src string }{
		{"switch", "func f() {\n\tswitch x {\n\tcase 1:\n\t\t_ = 1\n\t}\n}"},
		{"select", "func f() {\n\tselect {\n\tdefault:\n\t}\n}"},
		// type-switch 与 switch 同归 switch 型嵌套（对齐 TS 归并口径）。
		{"typeswitch", "func f(x any) {\n\tswitch x.(type) {\n\tcase int:\n\t\t_ = 1\n\t}\n}"},
	} {
		got := eventsFromSrc(t, tc.src)
		// switch/select/type-switch 体是 BlockStmt/CaseClause：case 发 flat，外壳发 nest+nestClose。
		if len(got) == 0 || got[0] != ev("nest", "switch") {
			t.Fatalf("%s: 首事件应为 nest/switch，得 %+v", tc.name, got)
		}
		last := got[len(got)-1]
		if last != closeEv() {
			t.Fatalf("%s: 末事件应为 nestClose，得 %+v", tc.name, got)
		}
	}
}

func TestEmitCaseClauseIsFlat(t *testing.T) {
	got := eventsFromSrc(t, "func f() {\n\tswitch x {\n\tcase 1:\n\t\t_ = 1\n\t}\n}")
	var sawFlatCase bool
	for _, e := range got {
		if e == ev("flat", "case") {
			sawFlatCase = true
		}
	}
	if !sawFlatCase {
		t.Fatalf("case 分支应发 flat/case，得 %+v", got)
	}
}

func TestEmitLogicOperatorsEmitFlatLogic(t *testing.T) {
	got := eventsFromSrc(t, "func f() {\n\tif a && b {\n\t\t_ = 1\n\t}\n}")
	var count int
	for _, e := range got {
		if e == ev("flat", "logic") {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("单处 && 应恰发 1 个 flat/logic，得 %d 个：%+v", count, got)
	}
}

func TestEmitLogicInReturnExpr(t *testing.T) {
	// return 是容器型（不产事件），须下钻 Results 才能暴露 && —— 容器透传的关键回归点。
	got := eventsFromSrc(t, "func f() bool {\n\treturn a || b\n}")
	want := []Event{ev("flat", "logic")}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("return 内 || 透传:\n got %+v\nwant %+v", got, want)
	}
}

func TestEmitLogicInContainers(t *testing.T) {
	// 容器型透传的关键回归点：这些包装节点自身不产事件，但必须下钻以暴露内嵌 &&/||。
	for _, tc := range []struct {
		name string
		src  string
		want []Event
	}{
		{"assign", "func f() {\n\t_ = a && b\n}", []Event{ev("flat", "logic")}},
		{"return", "func f() bool {\n\treturn a || b\n}", []Event{ev("flat", "logic")}},
		// incdec 子节点非 BinaryExpr → 无事件（纯透传）。
		// 注意：FnBodyToEvents 返回 make([]Event,0,cap) 而非 nil，故用空切片而非 nil 比对。
		{"incdec", "func f() {\n\tx++\n}", []Event{}},
		// labeled 透传到 for → 发 loop 嵌套。
		{"labeled", "func f() {\nL:\n\tfor {\n\t\tbreak L\n\t}\n}", []Event{ev("nest", "loop"), closeEv()}},
	} {
		got := eventsFromSrc(t, tc.src)
		if !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("%s:\n got %+v\nwant %+v", tc.name, got, tc.want)
		}
	}
}

// TestEmitCallArgsNotTraversed 记录「已知跨语言不对称」，非缺陷：
//
// Go 侧只下钻 GoStmt/DeferStmt 的 Call 节点，而 CallExpr 本身不在容器型白名单内，
// 故调用实参里的 &&/|| 不会被捕获。TS 侧走 node.getChildren() 全量泛遍历，能捕获。
//
// 影响面：仅让 Go 侧对「调用实参内逻辑运算符」少计分，方向为**低估**（不会虚报复杂度），
// 且契约向量只覆盖规约器（CognitiveFromSeq），不跨发射端对拍，故不致双端不一致告警。
// 若将来要求严格对齐，须给 Go 侧补 CallExpr 分支并同步 TS 侧泛遍历语义——属独立议题。
func TestEmitCallArgsNotTraversed(t *testing.T) {
	got := eventsFromSrc(t, "func f() {\n\tgo g(a || b)\n}")
	if len(got) != 0 {
		t.Fatalf("调用实参内逻辑运算符当前不遍历（已知不对称），得 %+v；"+
			"若此断言失败说明发射器已扩展，请同步 TS 侧并更新本测试与文档", got)
	}
}

// TestEmitSingleFieldVariants 覆盖单字段透传的全部形态（Go/Defer/Labeled）。
// 这些包装节点自身不产事件，仅下钻一层；子节点若含逻辑运算符才产事件。
func TestEmitSingleFieldVariants(t *testing.T) {
	// defer 的调用实参同样不遍历（与 go 同源），故仅验「不 panic 且无事件」。
	for _, tc := range []struct{ name, src string }{
		{"go", "func f() {\n\tgo g()\n}"},
		{"defer", "func f() {\n\tdefer g()\n}"},
	} {
		got := eventsFromSrc(t, tc.src)
		if len(got) != 0 {
			t.Fatalf("%s 无逻辑运算符应无事件，得 %+v", tc.name, got)
		}
	}
}

func TestEmitGuardDepthLimit(t *testing.T) {
	// guard 耗尽后应停止下钻（防深树爆栈）：构造 300 层嵌套，事件数须有上界。
	src := "func f() {\n"
	for i := 0; i < 300; i++ {
		src += "\tif a {\n"
	}
	src += "\t\t_ = 1\n"
	for i := 0; i < 300; i++ {
		src += "\t}\n"
	}
	src += "}\n"
	got := eventsFromSrc(t, src)
	// 每层最多 nest + nestClose = 2 事件；guard 上限 200 时应显著少于 2*300。
	if len(got) >= 2*300 {
		t.Fatalf("guard 未生效：300 层嵌套产出 %d 个事件（上限应 <600）", len(got))
	}
	if len(got) == 0 {
		t.Fatal("guard 过于激进：零事件")
	}
}

func TestFnBodyToEventsNilSafety(t *testing.T) {
	if got := FnBodyToEvents(nil); got != nil {
		t.Fatalf("nil 函数应返回 nil，得 %+v", got)
	}
}
