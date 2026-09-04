package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"ysm-model-manager/go/dedup"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/recycle"
)

func init() {
	RegisterCommandC("dedup", CatResource, "仓库去重检测与清理（子命令: scan/count/clean）", runDedup)
}

// runDedup 父命令：分发子命令。无子命令时打印用法。
func runDedup(ctx *CmdContext) error {
	if len(ctx.Args) == 0 {
		printDedupUsage()
		return nil
	}
	sub := ctx.Args[0]
	subCtx := &CmdContext{App: ctx.App, FilesRoot: ctx.FilesRoot, Args: ctx.Args[1:]}

	switch sub {
	case "scan":
		return runDedupScan(subCtx)
	case "count":
		return runDedupCount(subCtx)
	case "clean":
		return runDedupClean(subCtx)
	default:
		return &ErrParam{CmdName: "dedup", Err: fmt.Errorf("未知子命令: %s", sub)}
	}
}

// printDedupUsage 打印 dedup 父命令用法
func printDedupUsage() {
	fmt.Println("📖 dedup - 仓库去重检测与清理")
	fmt.Println()
	fmt.Println("用法:")
	fmt.Println("  app --cli --files-root <路径> dedup <子命令> [选项...]")
	fmt.Println()
	fmt.Println("子命令:")
	fmt.Println("  scan                 扫描重复文件（按 SHA256 分组列出）")
	fmt.Println("  count                快速统计重复组数与多余文件数")
	fmt.Println("  clean                把重复文件移入回收站（默认 dry-run，--yes 执行）")
	fmt.Println()
	fmt.Println("示例:")
	fmt.Println("  app --cli --files-root ./models dedup scan --dir ./models --output dup.json")
	fmt.Println("  app --cli --files-root ./models dedup count")
	fmt.Println("  app --cli --files-root ./models dedup clean            # dry-run 预览")
	fmt.Println("  app --cli --files-root ./models dedup clean --yes      # 执行")
}

// resolveDedupDir 解析扫描目录：--dir 优先，缺省用 ctx.FilesRoot
func resolveDedupDir(ctx *CmdContext, dir string) (string, error) {
	if dir == "" {
		dir = ctx.FilesRoot
	}
	if dir == "" {
		return "", newParamErrf("--dir 参数不能为空（或提供 --files-root）")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", newParamErrf("无法解析扫描目录 %q: %v", dir, err)
	}
	return abs, nil
}

// scanDedupResult JSON 载荷（--output 用）
type scanDedupResult struct {
	Directory  string        `json:"directory"`
	Groups     int           `json:"groups"`
	ExtraFiles int           `json:"extra_files"`
	Reclaim    int64         `json:"reclaim_bytes"`
	Items      []dedup.Group `json:"items"`
}

// runDedupScan 扫描重复文件，按 SHA256 分组打印
func runDedupScan(ctx *CmdContext) error {
	fs := newCmdFlagSet("dedup scan")
	dir := fs.String("dir", "", "扫描目录（缺省用 --files-root）")
	output := fs.String("output", "", "输出文件路径（JSON 格式）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	scanDir, err := resolveDedupDir(ctx, *dir)
	if err != nil {
		return err
	}

	groups, err := dedup.FindDuplicateFiles(scanDir, true)
	if err != nil {
		return newRuntimeErrf("扫描重复文件失败: %v", err)
	}

	result := scanDedupResult{Directory: scanDir, Items: groups}
	for _, g := range groups {
		result.ExtraFiles += len(g.Files) - 1
		result.Reclaim += g.Size * int64(len(g.Files)-1)
	}
	result.Groups = len(groups)

	if *output != "" {
		jsonBytes, jsonErr := marshalDedupJSON(result)
		if jsonErr != nil {
			return jsonErr
		}
		if err := os.WriteFile(*output, jsonBytes, 0o644); err != nil {
			return newRuntimeErrf("保存扫描结果失败: %w", err)
		}
		fmt.Printf("💾 扫描结果已保存到: %s（组 %d，多余 %d，可回收 %s）\n",
			*output, result.Groups, result.ExtraFiles, fsutil.FormatSize(result.Reclaim))
		// --output 本意是「结果存文件别刷屏」：写盘后只打印摘要，不在 stdout 展开每组
		return nil
	}

	if len(groups) == 0 {
		fmt.Printf("✅ 未发现重复文件（目录: %s）\n", scanDir)
		return nil
	}

	fmt.Printf("🔍 重复文件扫描: %s\n", scanDir)
	fmt.Printf("   重复组: %d，多余文件: %d，可回收: %s\n\n", result.Groups, result.ExtraFiles, fsutil.FormatSize(result.Reclaim))
	for i, g := range groups {
		fmt.Printf("  组 %d（SHA256 %s，单文件 %s，%d 个副本）:\n", i+1, shortHash(g.Hash), fsutil.FormatSize(g.Size), len(g.Files))
		for _, f := range g.Files {
			fmt.Printf("    - %s\n", f.Path)
		}
		fmt.Println()
	}
	return nil
}

// runDedupCount 快速统计重复数量
func runDedupCount(ctx *CmdContext) error {
	fs := newCmdFlagSet("dedup count")
	dir := fs.String("dir", "", "扫描目录（缺省用 --files-root）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	scanDir, err := resolveDedupDir(ctx, *dir)
	if err != nil {
		return err
	}

	groups, extra, err := dedup.CountDuplicates(scanDir, true)
	if err != nil {
		return newRuntimeErrf("统计重复文件失败: %v", err)
	}
	fmt.Printf("📊 重复统计（%s）: 重复组 %d，多余文件 %d\n", scanDir, groups, extra)
	return nil
}

// runDedupClean 把重复组中「保留第一个（路径字典序）」之外的文件移入回收站。
// 无 --yes = dry-run 预览；--yes 实际执行。写操作红线：默认只读。
// 回收站固定在仓库根（--files-root/.recycle）下，--dir 只允许指向仓库根内子目录。
func runDedupClean(ctx *CmdContext) error {
	fs := newCmdFlagSet("dedup clean")
	dir := fs.String("dir", "", "扫描目录（缺省用 --files-root，须在仓库根内）")
	yes := fs.Bool("yes", false, "实际执行（缺省为 dry-run 预览）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	if ctx.FilesRoot == "" {
		return newParamErrf("clean 需要 --files-root 作为仓库根（重复文件将移入其回收站）")
	}
	root, err := filepath.Abs(ctx.FilesRoot)
	if err != nil {
		return newParamErrf("无法解析仓库根 %q: %v", ctx.FilesRoot, err)
	}
	scanDir, err := resolveDedupDir(ctx, *dir)
	if err != nil {
		return err
	}
	// 路径守卫：扫描目录必须在仓库根内——回收站固定在 root/.recycle，
	// 允许扫仓库外目录会把外部文件移进本仓库回收站（越界移动）。
	rel, err := filepath.Rel(root, scanDir)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return newParamErrf("clean: 扫描目录必须在仓库根内: %s", scanDir)
	}

	groups, err := dedup.FindDuplicateFiles(scanDir, true)
	if err != nil {
		return newRuntimeErrf("扫描重复文件失败: %v", err)
	}

	// 每组按路径排序后保留第一个（确定性，与 recycle.DeduplicateEntries 口径一致）
	var victims []string
	for _, g := range groups {
		files := make([]string, 0, len(g.Files))
		for _, f := range g.Files {
			files = append(files, f.Path)
		}
		sort.Strings(files)
		victims = append(victims, files[1:]...)
	}

	if len(victims) == 0 {
		fmt.Println("✅ 未发现重复文件，无需清理")
		return nil
	}

	if !*yes {
		fmt.Printf("🛡️  dry-run 预览（加 --yes 执行）: 将移入回收站 %d 个文件\n", len(victims))
		for _, f := range victims {
			fmt.Printf("  → %s\n", f)
		}
		return nil
	}

	moved := 0
	var failures []string
	for _, f := range victims {
		if err := recycle.Move(f, root); err != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", f, err))
			continue
		}
		moved++
	}
	fmt.Printf("🗑️  已移入回收站: %d 个文件（共 %d 个）\n", moved, len(victims))
	for _, f := range failures {
		fmt.Printf("  ⚠️  %s\n", f)
	}
	return nil
}

// shortHash 截取 SHA256 前 12 位展示
func shortHash(h string) string {
	if len(h) <= 12 {
		return h
	}
	return h[:12] + "…"
}

// marshalDedupJSON 序列化场景结果（规律六：错误不吞 + %w 保留错误链）
func marshalDedupJSON(v interface{}) ([]byte, error) {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return nil, newRuntimeErrf("JSON 序列化失败: %w", err)
	}
	return data, nil
}
