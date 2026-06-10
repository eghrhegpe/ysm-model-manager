//go:build cli

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ysm-model-manager/go/types"
)

// ====== CLI 子命令注册 ======

func main() {
	if len(os.Args) < 2 {
		// 交互模式：双击 exe 时进入
		fmt.Println("ysm-cli — YSM 模型管理器命令行工具")
		fmt.Println(strings.Repeat("─", 50))
		fmt.Println("选择操作：")
		fmt.Println("  1. 📋 诊断 + 生成报告 (doctor --report)")
		fmt.Println("  2. 📊 统计信息 (stats)")
		fmt.Println("  3. 🌐 生成 HTML 报告 (doctor --html)")
		fmt.Println("  4. 📄 导出 3D 网格 (export)")
		fmt.Print("\n请输入编号 (1-4) [默认 1]: ")
		var choice string
		fmt.Scanln(&choice)
		choice = strings.TrimSpace(choice)
		if choice == "" {
			choice = "1"
		}

		fmt.Println("\n📁 请粘贴 .ysm 文件的完整路径（右键文件 → 复制路径，然后粘贴至此）：")
		fmt.Print("> ")
		var path string
		fmt.Scanln(&path)
		path = strings.TrimSpace(path)
		path = strings.Trim(path, `"'`)
		if path == "" {
			printUsage()
			pauseExit(0)
		}

		switch choice {
		case "2":
			os.Args = []string{os.Args[0], path}
			runStats([]string{path})
		case "3":
			runDoctor([]string{"--html", path})
		case "4":
			runExport([]string{path})
		default:
			runDoctor([]string{"--report", path})
		}
		fmt.Println("\n✅ 完成。按任意键退出...")
		fmt.Scanln()
		os.Exit(0)
	}
	cmd := os.Args[1]
	switch cmd {
	case "export":
		runExport(os.Args[2:])
	case "doctor":
		runDoctor(os.Args[2:])
	case "stats":
		runStats(os.Args[2:])
	case "help", "--help", "-h":
		printUsage()
	default:
		// 拖拽入 exe 时诊断并生成报告
		runDoctor(append([]string{"--report"}, cmd))
	}
}

func pauseExit(code int) {
	if code != 0 {
		fmt.Println("\n按任意键退出...")
		fmt.Scanln()
	}
	os.Exit(code)
}

func printUsage() {
	fmt.Println(`ysm-cli — YSM 模型管理器命令行工具

用法:
  ysm-cli export <模型文件>            导出 3D 网格数据到 .json 文件
  ysm-cli doctor [--fix] [--report] [--html] <路径>  诊断模型问题
  ysm-cli stats <模型文件/目录>        模型统计信息

示例:
  ysm-cli doctor ./models/
  ysm-cli doctor --report model.ysm    # 生成 .ysm.txt 报告
  ysm-cli doctor --html model.ysm      # 生成 .html 可视化报告
  ysm-cli stats model.ysm
  ysm-cli export model.ysm             # 生成 model.ysm.json`)
}

// ====== export: 导出 3D 网格数据 ======

type exportBone struct {
	Name   string        `json:"name"`
	Parent string        `json:"parent,omitempty"`
	Pivot  [3]float64    `json:"pivot"`
	Cubes  []exportCube  `json:"cubes"`
}

type exportCube struct {
	Origin   [3]float64  `json:"origin"`
	Size     [3]float64  `json:"size"`
	Pivot    [3]float64  `json:"pivot,omitempty"`
	Rotation [3]float64  `json:"rotation,omitempty"`
	MeshPos  [3]float64  `json:"meshPos"`
	MeshRot  [3]float64  `json:"meshRot"`
}

type exportModel struct {
	File       string        `json:"file"`
	BoneCount  int           `json:"boneCount"`
	CubeCount  int           `json:"cubeCount"`
	TexWidth   int           `json:"texWidth"`
	TexHeight  int           `json:"texHeight"`
	Animations []string      `json:"animations,omitempty"`
	Bones      []exportBone  `json:"bones"`
}

func runExport(args []string) {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "用法: ysm-cli export <模型文件.ysm/.zip/.7z>")
		pauseExit(1)
	}
	path := args[0]
	app := NewApp()
	model := app.AnalyzeBedrockModel(path)
	if model.BoneCount == 0 {
		fmt.Fprintln(os.Stderr, "❌ 未解析到骨骼数据")
		pauseExit(1)
	}
	em := exportModel{
		File:       path,
		BoneCount:  model.BoneCount,
		CubeCount:  model.CubeCount,
		TexWidth:   model.TexWidth,
		TexHeight:  model.TexHeight,
		Animations: model.Animations,
	}
	for _, b := range model.Bones {
		eb := exportBone{
			Name:   b.Name,
			Parent: b.Parent,
			Pivot:  b.Pivot,
		}
		for _, c := range b.Cubes {
			ox, oy, oz := c.Origin[0], c.Origin[1], c.Origin[2]
			sx, sy, sz := c.Size[0], c.Size[1], c.Size[2]
			px, py, pz := b.Pivot[0], b.Pivot[1], b.Pivot[2]
			meshX := ox + sx/2 - px
			meshY := oy + sy/2 - py
			meshZ := -(oz + sz/2 - pz)
			rot := c.Rotation
			eb.Cubes = append(eb.Cubes, exportCube{
				Origin:   c.Origin,
				Size:     c.Size,
				Pivot:    c.Pivot,
				Rotation: rot,
				MeshPos:  [3]float64{meshX, meshY, meshZ},
				MeshRot:  [3]float64{rot[0] * 3.14159 / 180, rot[1] * 3.14159 / 180, rot[2] * 3.14159 / 180},
			})
		}
		em.Bones = append(em.Bones, eb)
	}
	data, _ := json.MarshalIndent(em, "", "  ")
	outPath := path + ".json"
	os.WriteFile(outPath, data, 0644)
	fmt.Printf("📄 已导出: %s (%d KB)\n", outPath, len(data)/1024)
}

// ====== doctor: 诊断与修复 ======

type Issue struct {
	Severity string `json:"severity"` // "error", "warning", "info"
	Category string `json:"category"` // "missing_field", "uv_bounds", "texture", "geometry"
	Message  string `json:"message"`
	AutoFix  bool   `json:"autoFix,omitempty"`
}

func runDoctor(args []string) {
	remaining := args
	genReport := false
	genHTML := false
	for len(remaining) > 0 {
		switch remaining[0] {
		case "--fix", "-f":
			remaining = remaining[1:]
		case "--report", "-r":
			genReport = true
			remaining = remaining[1:]
		case "--html":
			genHTML = true
			remaining = remaining[1:]
		default:
			goto doneParsing
		}
	}
doneParsing:
	if len(remaining) < 1 {
		fmt.Fprintln(os.Stderr, "用法: ysm-cli doctor [--fix] [--report] <模型文件或目录>")
		pauseExit(1)
	}
	target := remaining[0]
	info, err := os.Stat(target)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ 无法访问 %s: %v\n", target, err)
		pauseExit(1)
	}

	var files []string
	if info.IsDir() {
		filepath.WalkDir(target, func(p string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(p))
			if ext == ".ysm" || ext == ".zip" || ext == ".7z" {
				files = append(files, p)
			}
			return nil
		})
	} else {
		files = append(files, target)
	}

	if len(files) == 0 {
		fmt.Fprintln(os.Stderr, "⚠️  未找到 .ysm/.zip/.7z 文件")
		pauseExit(0)
	}

	totalIssues := 0
	app := NewApp()

	for _, f := range files {
		model := app.AnalyzeBedrockModel(f)
		issues := diagnoseModel(&model)

		rel, _ := filepath.Rel(target, f)
		if rel == "" || rel == "." {
			rel = filepath.Base(f)
		}

		if len(issues) == 0 {
			fmt.Printf("✅ %s — 通过\n", rel)
			continue
		}

		fmt.Printf("\n🔍 %s (%d 条问题)\n", rel, len(issues))
		for _, iss := range issues {
			icon := "⚠️"
			if iss.Severity == "error" {
				icon = "❌"
			} else if iss.Severity == "info" {
				icon = "ℹ️"
			}
			fixTag := ""
			if iss.AutoFix {
				fixTag = " [可修复]"
			}
			fmt.Printf("  %s [%s] %s%s\n", icon, iss.Category, iss.Message, fixTag)
		}
		totalIssues += len(issues)
	}

	fmt.Printf("\n====== 诊断完成 ======\n")
	fmt.Printf("检查文件: %d  发现问题: %d\n", len(files), totalIssues)
	fmt.Println("💡 使用 --fix 参数可自动修复部分问题 (目前仅诊断, 修复功能开发中)")

	// --report: 在模型同目录生成 .txt 报告
	if genReport {
		writeTextReports(files)
	}
	if genHTML {
		writeHTMLReports(files)
	}
}

func diagnoseModel(model *types.BedrockModel) []Issue {
	var issues []Issue

	if model.BoneCount == 0 {
		issues = append(issues, Issue{
			Severity: "error",
			Category: "geometry",
			Message:  "未解析到任何骨骼数据，文件可能损坏或格式不兼容",
		})
		return issues
	}

	for _, b := range model.Bones {
		// 检查 pivot 全零
		if b.Pivot == [3]float64{0, 0, 0} && len(b.Cubes) > 0 {
			allZero := true
			for _, c := range b.Cubes {
				if c.Pivot != [3]float64{0, 0, 0} {
					allZero = false
					break
				}
			}
			if allZero {
				issues = append(issues, Issue{
					Severity: "warning",
					Category: "missing_field",
					Message:  fmt.Sprintf("骨骼 %q 的 pivot 为 (0,0,0)，可能缺失 pivot 定义", b.Name),
				})
			}
		}

		for _, c := range b.Cubes {
			// 检查 cube 有 pivot 但无 rotation
			if c.Rotation == [3]float64{0, 0, 0} && c.Pivot != [3]float64{0, 0, 0} {
				issues = append(issues, Issue{
					Severity: "info",
					Category: "missing_field",
					Message:  fmt.Sprintf("骨骼 %q 的 cube 有 pivot (%v) 但 rotation 为 (0,0,0)", b.Name, c.Pivot),
				})
			}

			// 检查 UV 越界
			if model.TexWidth > 0 && model.TexHeight > 0 && c.FaceUV != "" {
				issues = append(issues, checkFaceUVs(b.Name, c, model.TexWidth, model.TexHeight)...)
			}

			// 检查尺寸异常
			sx, sy, sz := c.Size[0], c.Size[1], c.Size[2]
			if sx <= 0 || sy <= 0 || sz <= 0 {
				issues = append(issues, Issue{
					Severity: "error",
					Category: "geometry",
					Message:  fmt.Sprintf("骨骼 %q 的 cube 尺寸异常 (%.0f,%.0f,%.0f)", b.Name, sx, sy, sz),
				})
			}
			if sx > 64 || sy > 64 || sz > 64 {
				issues = append(issues, Issue{
					Severity: "warning",
					Category: "geometry",
					Message:  fmt.Sprintf("骨骼 %q 的 cube 尺寸过大 (%.0f,%.0f,%.0f)", b.Name, sx, sy, sz),
				})
			}
		}
	}

	// 检查悬空 parent
	boneNames := make(map[string]bool)
	for _, b := range model.Bones {
		boneNames[b.Name] = true
	}
	for _, b := range model.Bones {
		if b.Parent != "" && !boneNames[b.Parent] {
			issues = append(issues, Issue{
				Severity: "warning",
				Category: "geometry",
				Message:  fmt.Sprintf("骨骼 %q 引用了不存在的父级 %q", b.Name, b.Parent),
			})
		}
	}

	// 检查纹理尺寸
	if model.TexWidth > 0 && model.TexHeight > 0 {
		if model.TexWidth != model.TexHeight {
			issues = append(issues, Issue{
				Severity: "info",
				Category: "texture",
				Message:  fmt.Sprintf("纹理尺寸为 %dx%d（非正方形），部分引擎可能不兼容", model.TexWidth, model.TexHeight),
			})
		}
		if model.TexWidth > 1024 || model.TexHeight > 1024 {
			issues = append(issues, Issue{
				Severity: "info",
				Category: "texture",
				Message:  fmt.Sprintf("纹理尺寸 %dx%d 较大，低端设备可能性能下降", model.TexWidth, model.TexHeight),
			})
		}
	}

	// 骨骼/多边形估算
	if model.BoneCount > 100 {
		issues = append(issues, Issue{
			Severity: "warning",
			Category: "geometry",
			Message:  fmt.Sprintf("模型有 %d 个骨骼，每帧遍历开销较大，低端设备可能卡顿", model.BoneCount),
		})
	}
	if model.CubeCount > 200 {
		issues = append(issues, Issue{
			Severity: "warning",
			Category: "geometry",
			Message:  fmt.Sprintf("模型有 %d 个立方体（≈ %d 多边形），低端设备可能卡顿", model.CubeCount, model.CubeCount*12),
		})
	}

	// Molang 表达式检测
	for i, animJSON := range model.Animations {
		if hasMolangInJSON(animJSON) {
			issues = append(issues, Issue{
				Severity: "warning",
				Category: "animation",
				Message:  fmt.Sprintf("动画 #%d 包含 Molang 表达式，预览时将静默跳过（模型会僵住不动）", i+1),
			})
		}
	}

	return issues
}

func checkFaceUVs(boneName string, c types.Cube2D, texW, texH int) []Issue {
	var issues []Issue
	var faces map[string][4]float64
	if err := json.Unmarshal([]byte(c.FaceUV), &faces); err != nil {
		return nil
	}
	for name, uv := range faces {
		// uv = [u1, v1, u2, v2] — 检查出界
		if uv[0] < 0 || uv[1] < 0 || uv[2] > float64(texW) || uv[3] > float64(texH) {
			issues = append(issues, Issue{
				Severity: "warning",
				Category: "uv_bounds",
				Message:  fmt.Sprintf("骨骼 %q 的 %s 面 UV [%.0f,%.0f,%.0f,%.0f] 超出纹理 %dx%d", boneName, name, uv[0], uv[1], uv[2], uv[3], texW, texH),
			})
		}
	}
	return issues
}

// ====== stats: 模型统计信息 ======

func runStats(args []string) {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "用法: ysm-cli stats <模型文件或目录>")
		pauseExit(1)
	}
	target := args[0]
	info, err := os.Stat(target)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ 无法访问 %s: %v\n", target, err)
		pauseExit(1)
	}

	var files []string
	if info.IsDir() {
		filepath.WalkDir(target, func(p string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(p))
			if ext == ".ysm" || ext == ".zip" || ext == ".7z" {
				files = append(files, p)
			}
			return nil
		})
	} else {
		files = append(files, target)
	}

	if len(files) == 0 {
		fmt.Fprintln(os.Stderr, "⚠️  未找到 .ysm/.zip/.7z 文件")
		pauseExit(0)
	}

	app := NewApp()

	if len(files) == 1 {
		printModelStats(app, files[0])
		return
	}

	// 多文件汇总表
	fmt.Printf("%-40s %6s %6s %6s %6s  %s\n", "文件", "骨骼", "立方体", "纹理W", "纹理H", "动画")
	fmt.Println(strings.Repeat("─", 90))
	totalBones := 0
	totalCubes := 0
	for _, f := range files {
		model := app.AnalyzeBedrockModel(f)
		name := filepath.Base(f)
		if len(name) > 38 {
			name = name[:35] + "..."
		}
		animCount := len(model.Animations)
		animStr := fmt.Sprintf("%d", animCount)
		if animCount == 0 {
			animStr = "-"
		}
		fmt.Printf("%-40s %6d %6d %6d %6d  %s\n",
			name, model.BoneCount, model.CubeCount,
			model.TexWidth, model.TexHeight, animStr)
		totalBones += model.BoneCount
		totalCubes += model.CubeCount
	}
	fmt.Println(strings.Repeat("─", 90))
	fmt.Printf("%-40s %6d %6d\n", fmt.Sprintf("合计 (%d 文件)", len(files)), totalBones, totalCubes)
}

func printModelStats(app *App, path string) {
	model := app.AnalyzeBedrockModel(path)

	name := filepath.Base(path)
	fmt.Println(strings.Repeat("═", 60))
	fmt.Printf("  %s\n", name)
	fmt.Println(strings.Repeat("═", 60))

	if model.BoneCount == 0 {
		fmt.Println("  ❌ 无法解析该模型")
		return
	}

	fmt.Printf("  📊 基本信息\n")
	fmt.Printf("     骨骼数:     %d\n", model.BoneCount)
	fmt.Printf("     立方体数:   %d\n", model.CubeCount)
	fmt.Printf("     估算多边形: %d (~%d 顶点)\n", model.CubeCount*12, model.CubeCount*8)
	if model.TexWidth > 0 {
		fmt.Printf("     纹理尺寸:   %d × %d px\n", model.TexWidth, model.TexHeight)
		fmt.Printf("     纹理内存:   ~%s\n", formatBytes(int64(model.TexWidth*model.TexHeight*4)))
	}
	if model.Format != "" {
		fmt.Printf("     格式版本:   %s\n", model.Format)
	}

	// 骨骼层级分析
	if len(model.Bones) > 0 {
		fmt.Printf("\n  🦴 骨骼层级\n")
		roots := 0
		for _, b := range model.Bones {
			if b.Parent == "" {
				roots++
				fmt.Printf("     └─ %s (根骨骼, %d 立方体)\n", b.Name, len(b.Cubes))
			}
		}
		if roots == 0 {
			fmt.Println("     ⚠️  未找到根骨骼（全部有 parent）")
		}
		fmt.Printf("     最大层级深度: %d\n", estimateMaxDepth(model.Bones))
	}

	// 动画统计
	if len(model.Animations) > 0 {
		molangCount := 0
		fmt.Printf("\n  🎬 动画 (%d 个)\n", len(model.Animations))
		for i, a := range model.Animations {
			if hasMolangInJSON(a) {
				molangCount++
			}
			short := a
			if len(short) > 60 {
				short = short[:57] + "..."
			}
			fmt.Printf("     [%d] %s\n", i+1, short)
		}
		if molangCount > 0 {
			fmt.Printf("     ⚠️  发现 %d 个动画含 Molang 表达式（预览时将静默跳过）\n", molangCount)
		}
	} else {
		fmt.Println("\n  🎬 动画: 无")
	}

	// UV 类型统计
	boxUV := 0
	faceUV := 0
	for _, b := range model.Bones {
		for _, c := range b.Cubes {
			if c.FaceUV != "" {
				faceUV++
			} else {
				boxUV++
			}
		}
	}
	total := boxUV + faceUV
	if total > 0 {
		fmt.Printf("\n  🎨 UV 映射\n")
		fmt.Printf("     Box UV:   %d (%.0f%%)\n", boxUV, float64(boxUV)/float64(total)*100)
		fmt.Printf("     Face UV:  %d (%.0f%%)\n", faceUV, float64(faceUV)/float64(total)*100)
	}

	// 大骨骼警告
	for _, b := range model.Bones {
		if len(b.Cubes) > 30 {
			fmt.Printf("\n  ⚠️  骨骼 %q 有 %d 个立方体, 可能过重\n", b.Name, len(b.Cubes))
		}
	}

	fmt.Println(strings.Repeat("─", 60))
}

func estimateMaxDepth(bones []types.Bone2D) int {
	children := make(map[string][]string)
	for _, b := range bones {
		parent := b.Parent
		if parent == "" {
			parent = "__root__"
		}
		children[parent] = append(children[parent], b.Name)
	}
	var dfs func(name string, depth int) int
	dfs = func(name string, depth int) int {
		maxD := depth
		for _, child := range children[name] {
			if d := dfs(child, depth+1); d > maxD {
				maxD = d
			}
		}
		return maxD
	}
	return dfs("__root__", 0)
}

func formatBytes(n int64) string {
	switch {
	case n > 1_000_000:
		return fmt.Sprintf("%.1f MB", float64(n)/1_000_000)
	case n > 1_000:
		return fmt.Sprintf("%.1f KB", float64(n)/1_000)
	default:
		return fmt.Sprintf("%d B", n)
	}
}

// ====== 报告生成 ======

func writeTextReports(files []string) {
	app := NewApp()
	for _, f := range files {
		model := app.AnalyzeBedrockModel(f)
		issues := diagnoseModel(&model)
		reportPath := f + ".txt"
		var sb strings.Builder
		sb.WriteString("YSM 模型诊断报告\n")
		sb.WriteString(fmt.Sprintf("文件: %s\n", f))
		sb.WriteString(fmt.Sprintf("时间: %s\n", time.Now().Format("2006-01-02 15:04:05")))
		sb.WriteString(fmt.Sprintf("骨骼: %d  立方体: %d\n", model.BoneCount, model.CubeCount))
		sb.WriteString(fmt.Sprintf("纹理: %dx%d\n", model.TexWidth, model.TexHeight))
		sb.WriteString(fmt.Sprintf("问题数: %d\n\n", len(issues)))
		for _, iss := range issues {
			icon := "⚠️"
			if iss.Severity == "error" {
				icon = "❌"
			} else if iss.Severity == "info" {
				icon = "ℹ️"
			}
			fixTag := ""
			if iss.AutoFix {
				fixTag = " [可修复]"
			}
			sb.WriteString(fmt.Sprintf("%s [%s] %s%s\n", icon, iss.Category, iss.Message, fixTag))
		}
		os.WriteFile(reportPath, []byte(sb.String()), 0644)
		fmt.Printf("📄 报告已生成: %s\n", reportPath)
	}
}

func writeHTMLReports(files []string) {
	app := NewApp()
	for _, f := range files {
		model := app.AnalyzeBedrockModel(f)
		issues := diagnoseModel(&model)
		reportPath := f + ".html"

		var sb strings.Builder
		sb.WriteString(`<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8">`)
		sb.WriteString(`<title>YSM 诊断报告</title>`)
		sb.WriteString(`<style>
body{font-family:-apple-system,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;background:#f5f5f7;color:#1d1d1f}
h1{font-size:24px;font-weight:600}
.meta{background:#fff;border-radius:12px;padding:16px 20px;margin:16px 0;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.meta span{display:inline-block;margin-right:24px;font-size:14px;color:#6e6e73}
.issue{margin:8px 0;padding:10px 16px;border-radius:8px;font-size:14px;line-height:1.5}
.issue.error{background:#fef2f2;border-left:3px solid #ef4444}
.issue.warning{background:#fffbeb;border-left:3px solid #f59e0b}
.issue.info{background:#f0f9ff;border-left:3px solid #3b82f6}
.issue .cat{font-weight:500;margin-right:8px}
.summary{background:#fff;border-radius:12px;padding:16px 20px;margin:16px 0;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.summary b{font-size:18px}
</style></head><body>`)
		sb.WriteString(fmt.Sprintf("<h1>🔍 YSM 模型诊断</h1>"))
		sb.WriteString(fmt.Sprintf("<div class=meta><span>📁 %s</span><span>🦴 %d 骨骼</span><span>📦 %d 立方体</span><span>🖼️ %dx%d</span></div>",
			filepath.Base(f), model.BoneCount, model.CubeCount, model.TexWidth, model.TexHeight))
		sb.WriteString(fmt.Sprintf("<div class=summary><b>%d</b> 条问题", len(issues)))
		errs := 0
		for _, iss := range issues {
			if iss.Severity == "error" {
				errs++
			}
		}
		if errs > 0 {
			sb.WriteString(fmt.Sprintf(" · <b style=color:#ef4444>%d 错误</b>", errs))
		}
		sb.WriteString("</div>")
		for _, iss := range issues {
			cls := iss.Severity
			if cls == "" {
				cls = "info"
			}
			icon := "ℹ️"
			if iss.Severity == "error" {
				icon = "❌"
			} else if iss.Severity == "warning" {
				icon = "⚠️"
			}
			sb.WriteString(fmt.Sprintf("<div class=\"issue %s\">%s <span class=cat>[%s]</span>%s</div>", cls, icon, iss.Category, iss.Message))
		}
		sb.WriteString("</body></html>")
		os.WriteFile(reportPath, []byte(sb.String()), 0644)
		fmt.Printf("📄 HTML 报告已生成: %s\n", reportPath)
	}
}

// hasMolangInJSON 检测动画 JSON 字符串中是否包含 Molang 表达式
func hasMolangInJSON(jsonStr string) bool {
	// Molang 表达式特征：字符串值以 q. 或 t. 开头，或包含 "query."/"temp."
	// 简单的文本扫描即可，无需完整解析
	markers := []string{`"q.`, `"t.`, `"query.`, `"temp.`, `"math.`}
	lower := strings.ToLower(jsonStr)
	for _, m := range markers {
		if strings.Contains(lower, m) {
			return true
		}
	}
	return false
}
