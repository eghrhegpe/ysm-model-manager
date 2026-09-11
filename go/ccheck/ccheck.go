// Package ccheck 提供 Go 源码的团队复杂度（认知复杂度 + 嵌套深度）扫描。
//
// 这是前端 scripts/check-complexity.ts 的 Go 端对齐镜像（ADR-154 对拍风格）：
//   - 规约器 CognitiveFromSeq 与 TS cognitiveFromSeq 语义逐字一致（同一数学，
//     纯函数可按位置换），双端对齐由共享契约向量 tests/parity/go-ts-complexity.json
//     互锁（本包 parity_test.go ↔ tests/test_complexity_parity.ts）。
//   - 事件发射器 emitFromNode 只把 go/ast 翻译成事件流（nest/flat/nestClose），
//     不含任何复杂度语义；跨语言无法向量对拍发射器，故发射端为尽力对齐。
//
// 指标语义（Sonar Cognitive Complexity 简化）：
//  1. 认知复杂度：控制流结构每命中一次 +1，且处于嵌套层级 d 时另 +d（深嵌套迷宫高分）。
//     嵌套型：if / for / range / switch / type-switch / select（进 depth 再算）；
//     即时型（不增层）：else、case、逻辑运算符 &&/||、三元（Go: 无三元，但 &&/|| 计）。
//  2. 嵌套深度：整个函数最大控制流嵌套层数。
//
// 用法（作为库）：
//
//	ff, _ := parser.ParseFile(...)
//	for _, fd := range ff.Decls {...}
//	seq := FnBodyToEvents(fd);  c, n := CognitiveFromSeq(seq)
package ccheck

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Event 是单个结构事件，镜像 TS CxEvent：
//
//	K: "nest" | "nestClose" | "flat"（唯一影响计分的字段）
//	KindName: "if"|"loop"|"switch"|"catch"（nest）/ "else"|"case"|"logic"|"ternary"（flat）
type Event struct {
	K        string `json:"k"`
	KindName string `json:"kind,omitempty"`
}

// CognitiveFromSeq 从事件序列规约出认知复杂度 + 最大嵌套深度（与 TS cognitiveFromSeq 同语义）。
func CognitiveFromSeq(seq []Event) (cognitive, maxNesting int) {
	depth := 0
	for _, ev := range seq {
		switch ev.K {
		case "nest":
			cognitive += 1 + depth
			depth++
			if depth > maxNesting {
				maxNesting = depth
			}
		case "nestClose":
			if depth > 0 {
				depth--
			}
		default: // "flat"
			cognitive += 1 + depth
		}
	}
	return cognitive, maxNesting
}

const emitGuard = 200

// FnBodyToEvents 把函数声明的函数体翻译成事件序列。
// 与 TS fnBodyToEvents(body) 对齐：仅遍历函数体，不统计签名里的初始值/参数默认值。
func FnBodyToEvents(fn *ast.FuncDecl) []Event {
	if fn == nil || fn.Body == nil {
		return nil
	}
	seq := make([]Event, 0, 32)
	emitFromNode(fn.Body, &seq, emitGuard)
	return seq
}

// 控制流嵌套型：进 nest，递归子节点（嵌套层 +1），出 nestClose。
func nest(kindName string, seq *[]Event, guard int) bool {
	*seq = append(*seq, Event{K: "nest", KindName: kindName})
	return guard > 1 // 返回是否继续下钻
}

// emitFromNode 把 AST 节点翻译成事件流（镜像 TS emitFromNode 的前序语义）。
// 逐节点类型分派；未显式处理的容器节点递归子语句，表达式里的 &&/|| 由 BinaryExpr 捕获。
//
// 分派按事件语义切三族，各由独立路由函数承担（见下），本函数只做守卫 + 三路分流。
// 如此既保住「发射顺序即契约」的可读性，又把认知复杂度摊平到各路由内：
//   - 嵌套型（进 nest / 出 nestClose）：emitNested；
//   - 即时型（flat，不增层）：emitFlat；
//   - 容器型（纯透传，不产事件）：emitContainer。
//
// ⚠️ 事件发射顺序即跨语言契约（与 TS 侧逐字对齐），重构时不得改变调用次序。
func emitFromNode(n ast.Node, seq *[]Event, guard int) {
	if n == nil || guard <= 0 {
		return
	}
	if emitNested(n, seq, guard) {
		return
	}
	if emitFlat(n, seq, guard) {
		return
	}
	emitContainer(n, seq, guard)
}

// emitNested 嵌套型路由：命中则发射 nest/nestClose 并返回 true。
//
// 6 个分支再按「进 nest 后下钻的字段形态」分两路，纯为摊平指标——
// 各分支彼此同构（nest → 下钻若干字段 → nestClose），拆开不损可读性。
func emitNested(n ast.Node, seq *[]Event, guard int) bool {
	switch t := n.(type) {
	case *ast.IfStmt:
		emitIf(t, seq, guard)
	case *ast.ForStmt:
		emitFor(t, seq, guard)
	case *ast.RangeStmt:
		emitRange(t, seq, guard)
	default:
		return emitSwitchLike(n, seq, guard)
	}
	return true
}

// emitSwitchLike switch 系嵌套型路由（switch / type-switch / select 三兄弟）。
func emitSwitchLike(n ast.Node, seq *[]Event, guard int) bool {
	switch t := n.(type) {
	case *ast.SwitchStmt:
		emitSwitch(t, seq, guard)
	case *ast.TypeSwitchStmt:
		emitTypeSwitch(t, seq, guard)
	case *ast.SelectStmt:
		emitSelect(t, seq, guard)
	default:
		return false
	}
	return true
}

// emitFlat 即时型路由：命中则发射 flat 事件（或等价语义）并返回 true。
func emitFlat(n ast.Node, seq *[]Event, guard int) bool {
	switch t := n.(type) {
	case *ast.CaseClause:
		emitClause(t.Body, seq, guard)
	case *ast.CommClause:
		emitClause(t.Body, seq, guard)
	case *ast.BinaryExpr:
		emitBinary(t, seq, guard)
	default:
		return false
	}
	return true
}

// emitContainer 容器型透传：自身不产事件，仅为暴露内嵌 &&/|| 而下钻子节点。
//
// 按「子节点形态」再分两路——单字段型与序列型语义同构但取子方式不同，
// 拆开可让每函数认知复杂度远离 🟨 阈值（原 8 路 switch 一函数计 c17）：
//   - 单字段：ExprStmt / IncDecStmt / GoStmt / DeferStmt / LabeledStmt；
//   - 序列：ReturnStmt / AssignStmt / BlockStmt。
//
// 两路皆无命中即静默忽略（与 switch 无 default 同义）。
func emitContainer(n ast.Node, seq *[]Event, guard int) {
	if emitSingleField(n, seq, guard) {
		return
	}
	emitSequence(n, seq, guard)
}

// emitSingleField 单字段透传：命中则下钻该字段并返回 true。
func emitSingleField(n ast.Node, seq *[]Event, guard int) bool {
	switch t := n.(type) {
	case *ast.ExprStmt:
		emitFromNode(t.X, seq, guard-1)
	case *ast.IncDecStmt:
		emitFromNode(t.X, seq, guard-1)
	case *ast.GoStmt:
		emitFromNode(t.Call, seq, guard-1)
	case *ast.DeferStmt:
		emitFromNode(t.Call, seq, guard-1)
	case *ast.LabeledStmt:
		emitFromNode(t.Stmt, seq, guard-1)
	default:
		return false
	}
	return true
}

// emitSequence 序列透传：命中则逐个下钻子节点（顺序即事件顺序）。
func emitSequence(n ast.Node, seq *[]Event, guard int) {
	switch t := n.(type) {
	case *ast.ReturnStmt:
		emitAll(t.Results, seq, guard)
	case *ast.AssignStmt:
		emitAll(t.Rhs, seq, guard)
	case *ast.BlockStmt:
		emitAll(t.List, seq, guard)
	}
}

// emitAll 逐个子节点按 guard-1 下钻（顺序即事件顺序，须与 TS 保持一致）。
// 泛型以接纳 []ast.Expr / []ast.Stmt——Go 切片不变型，二者不可直接当 []ast.Node 传。
func emitAll[T ast.Node](nodes []T, seq *[]Event, guard int) {
	for _, s := range nodes {
		emitFromNode(s, seq, guard-1)
	}
}

// emitIf if 语句：Init/Cond/Body 下钻，else 为即时型 flat（不增层，对齐 TS ElseClause）。
func emitIf(t *ast.IfStmt, seq *[]Event, guard int) {
	if !nest("if", seq, guard) {
		return
	}
	emitFromNode(t.Init, seq, guard-1)
	emitFromNode(t.Cond, seq, guard-1)
	emitFromNode(t.Body, seq, guard-1)
	if t.Else != nil {
		*seq = append(*seq, Event{K: "flat", KindName: "else"})
		emitFromNode(t.Else, seq, guard-1)
	}
	*seq = append(*seq, Event{K: "nestClose"})
}

// emitFor for 语句（嵌套型 loop）。
func emitFor(t *ast.ForStmt, seq *[]Event, guard int) {
	if !nest("loop", seq, guard) {
		return
	}
	emitFromNode(t.Init, seq, guard-1)
	emitFromNode(t.Cond, seq, guard-1)
	emitFromNode(t.Post, seq, guard-1)
	emitFromNode(t.Body, seq, guard-1)
	*seq = append(*seq, Event{K: "nestClose"})
}

// emitRange range 语句（嵌套型 loop）。
func emitRange(t *ast.RangeStmt, seq *[]Event, guard int) {
	if !nest("loop", seq, guard) {
		return
	}
	emitFromNode(t.Key, seq, guard-1)
	emitFromNode(t.Value, seq, guard-1)
	emitFromNode(t.X, seq, guard-1)
	emitFromNode(t.Body, seq, guard-1)
	*seq = append(*seq, Event{K: "nestClose"})
}

// emitSwitch switch 语句（嵌套型 switch）。
func emitSwitch(t *ast.SwitchStmt, seq *[]Event, guard int) {
	if !nest("switch", seq, guard) {
		return
	}
	emitFromNode(t.Tag, seq, guard-1)
	emitFromNode(t.Body, seq, guard-1)
	*seq = append(*seq, Event{K: "nestClose"})
}

// emitTypeSwitch 类型 switch（嵌套型 switch，对齐 TS 归并口径）。
func emitTypeSwitch(t *ast.TypeSwitchStmt, seq *[]Event, guard int) {
	if !nest("switch", seq, guard) {
		return
	}
	emitFromNode(t.Init, seq, guard-1)
	emitFromNode(t.Assign, seq, guard-1)
	emitFromNode(t.Body, seq, guard-1)
	*seq = append(*seq, Event{K: "nestClose"})
}

// emitSelect select 语句（归入 switch 型嵌套）。
func emitSelect(t *ast.SelectStmt, seq *[]Event, guard int) {
	if !nest("switch", seq, guard) {
		return
	}
	emitFromNode(t.Body, seq, guard-1)
	*seq = append(*seq, Event{K: "nestClose"})
}

// emitClause case / comm 分支体：先发即时型 case 标记，再逐个下钻分支语句。
func emitClause(body []ast.Stmt, seq *[]Event, guard int) {
	*seq = append(*seq, Event{K: "flat", KindName: "case"})
	for _, s := range body {
		emitFromNode(s, seq, guard-1)
	}
}

// emitBinary 二元表达式：&&/|| 计即时型 logic，随后下钻两侧以暴露更内层逻辑。
func emitBinary(t *ast.BinaryExpr, seq *[]Event, guard int) {
	if t.Op == token.LAND || t.Op == token.LOR {
		*seq = append(*seq, Event{K: "flat", KindName: "logic"})
	}
	emitFromNode(t.X, seq, guard-1)
	emitFromNode(t.Y, seq, guard-1)
}

// FuncResult 单个函数的结果。
type FuncResult struct {
	File       string `json:"file"` // 仓库相对路径
	Name       string `json:"name"` // 函数名（含接收者，粗判）
	Line       int    `json:"line"` // 声明起始行
	Cognitive  int    `json:"cognitive"`
	MaxNesting int    `json:"maxNesting"`
}

// ScanFile 解析单个 Go 文件并返回每个命名函数的复杂度（跳过生成文件；_test.go
// 由 skipTests 控制——cmd/ccheck 的 --tests 旗标经 ScanDir 传入，须穿透到此处才生效）。
func ScanFile(abs, rel string, skipTests bool) ([]FuncResult, error) {
	if (skipTests && strings.HasSuffix(abs, "_test.go")) || isGenerated(abs) {
		return nil, nil
	}
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, abs, nil, parser.ParseComments)
	if err != nil {
		return nil, err
	}
	var results []FuncResult
	for _, decl := range f.Decls {
		fd, ok := decl.(*ast.FuncDecl)
		if !ok || fd.Body == nil {
			continue
		}
		name := fd.Name.Name
		if fd.Recv != nil {
			name = recvName(fd.Recv) + "." + name
		}
		c, n := CognitiveFromSeq(FnBodyToEvents(fd))
		results = append(results, FuncResult{
			File: rel, Name: name, Line: fset.Position(fd.Pos()).Line,
			Cognitive: c, MaxNesting: n,
		})
	}
	return results, nil
}

// ScanDir 递归扫描 dir 下全部 .go 文件，返回所有命名函数（按认知复杂度降序）。
// testFile 控制是否跳过 *_test.go（扫描生产代码时传 true）。
func ScanDir(absDir, relBase string, skipTests bool) ([]FuncResult, error) {
	var out []FuncResult
	err := filepath.WalkDir(absDir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // 单目录失败不炸整树，对齐 scan-files.walk 容错
		}
		if d.IsDir() {
			if d.Name() == "vendor" || d.Name() == ".git" || d.Name() == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(d.Name(), ".go") {
			return nil
		}
		rel := filepath.Join(relBase, strings.TrimPrefix(p, absDir))
		rel = filepath.ToSlash(rel)
		if skipTests && strings.HasSuffix(d.Name(), "_test.go") {
			return nil
		}
		funcs, serr := ScanFile(p, rel, skipTests)
		if serr != nil {
			return nil // 解析失败的单个文件跳过
		}
		out = append(out, funcs...)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Cognitive > out[j].Cognitive })
	return out, nil
}

// recvName 提取接收者类型名（指针/泛型剥前缀与类型参数）。
func recvName(recv *ast.FieldList) string {
	if recv == nil || len(recv.List) == 0 {
		return ""
	}
	return typeName(recv.List[0].Type)
}

func typeName(e ast.Expr) string {
	switch t := e.(type) {
	case *ast.Ident:
		return t.Name
	case *ast.StarExpr:
		return typeName(t.X)
	case *ast.IndexExpr:
		return typeName(t.X)
	case *ast.IndexListExpr:
		return typeName(t.X)
	case *ast.SelectorExpr:
		return t.Sel.Name
	default:
		return ""
	}
}

// isGenerated 跳过 go:generate / mind 工具产物（扫描噪音）。
func isGenerated(abs string) bool {
	head, err := os.ReadFile(abs)
	if err != nil || len(head) < 512 {
		return false
	}
	return strings.Contains(string(head[:min(len(head), 512)]), "Code generated") ||
		strings.Contains(string(head[:min(len(head), 512)]), "DO NOT EDIT")
}
