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
func emitFromNode(n ast.Node, seq *[]Event, guard int) {
	if n == nil || guard <= 0 {
		return
	}
	switch t := n.(type) {
	// ── 嵌套型 ──
	case *ast.IfStmt:
		if !nest("if", seq, guard) {
			return
		}
		emitFromNode(t.Init, seq, guard-1)
		emitFromNode(t.Cond, seq, guard-1)
		emitFromNode(t.Body, seq, guard-1)
		if t.Else != nil { // else 是 body 层的即时型 flat（不增层），语义对齐 TS ElseClause
			*seq = append(*seq, Event{K: "flat", KindName: "else"})
			emitFromNode(t.Else, seq, guard-1)
		}
		*seq = append(*seq, Event{K: "nestClose"})
	case *ast.ForStmt:
		if !nest("loop", seq, guard) {
			return
		}
		emitFromNode(t.Init, seq, guard-1)
		emitFromNode(t.Cond, seq, guard-1)
		emitFromNode(t.Post, seq, guard-1)
		emitFromNode(t.Body, seq, guard-1)
		*seq = append(*seq, Event{K: "nestClose"})
	case *ast.RangeStmt:
		if !nest("loop", seq, guard) {
			return
		}
		emitFromNode(t.Key, seq, guard-1)
		emitFromNode(t.Value, seq, guard-1)
		emitFromNode(t.X, seq, guard-1)
		emitFromNode(t.Body, seq, guard-1)
		*seq = append(*seq, Event{K: "nestClose"})
	case *ast.SwitchStmt:
		if !nest("switch", seq, guard) {
			return
		}
		emitFromNode(t.Tag, seq, guard-1)
		emitFromNode(t.Body, seq, guard-1)
		*seq = append(*seq, Event{K: "nestClose"})
	case *ast.TypeSwitchStmt:
		if !nest("switch", seq, guard) {
			return
		}
		emitFromNode(t.Init, seq, guard-1)
		emitFromNode(t.Assign, seq, guard-1)
		emitFromNode(t.Body, seq, guard-1)
		*seq = append(*seq, Event{K: "nestClose"})
	case *ast.SelectStmt:
		if !nest("switch", seq, guard) {
			return
		}
		emitFromNode(t.Body, seq, guard-1)
		*seq = append(*seq, Event{K: "nestClose"})
	// ── 即时型 ──
	case *ast.CaseClause:
		*seq = append(*seq, Event{K: "flat", KindName: "case"})
		for _, s := range t.Body {
			emitFromNode(s, seq, guard-1)
		}
	case *ast.CommClause:
		*seq = append(*seq, Event{K: "flat", KindName: "case"})
		for _, s := range t.Body {
			emitFromNode(s, seq, guard-1)
		}
	case *ast.BinaryExpr:
		if t.Op == token.LAND || t.Op == token.LOR {
			*seq = append(*seq, Event{K: "flat", KindName: "logic"})
		}
		emitFromNode(t.X, seq, guard-1)
		emitFromNode(t.Y, seq, guard-1)
	// ── 表达式容器（暴露内嵌 &&/||）──
	case *ast.ExprStmt:
		emitFromNode(t.X, seq, guard-1)
	case *ast.ReturnStmt:
		for _, r := range t.Results {
			emitFromNode(r, seq, guard-1)
		}
	case *ast.AssignStmt:
		for _, r := range t.Rhs {
			emitFromNode(r, seq, guard-1)
		}
	case *ast.IncDecStmt:
		emitFromNode(t.X, seq, guard-1)
	case *ast.GoStmt:
		emitFromNode(t.Call, seq, guard-1)
	case *ast.DeferStmt:
		emitFromNode(t.Call, seq, guard-1)
	// ── 语句容器 ──
	case *ast.BlockStmt:
		for _, s := range t.List {
			emitFromNode(s, seq, guard-1)
		}
	case *ast.LabeledStmt:
		emitFromNode(t.Stmt, seq, guard-1)
	}
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
