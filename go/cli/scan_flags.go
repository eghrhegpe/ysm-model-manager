// scan_flags.go：目录扫描类命令共用的 flag 解析与校验。
//
// ⚠️ 2026-10-08 复核修正：**flag 注册必须留在各命令文件内**，此处只抽「解析 + --dir 空校验」。
// 背景：本文件初版把 `fs.String("dir"…)` / `fs.Bool("detail"…)` / `fs.String("output"…)` 注册
// 也一并收进 newScanDirFlags，导致 `scripts/_lib/cli-registry.ts` 的 `extractFlags` 在
// `runScanDir` / `runResourceScan` 的 runFn 函数体里扫不到 `fs.String(…)` 调用——
// 生成的 `docs/cli-commands.md` 丢掉 scan-dir / resource-scan 两段选项表、shell 补全
// 丢掉 `--dir/--detail/--output`（tab 补全静默退化，doctor 自洽故不红）。
//
// 抽取原则（对 jscpd 与 registry 双赢）：注册行留在命令文件内、只把「两处逐字重复的
// 解析 + 空校验」下沉到本文件；`--dir` 帮助文案、默认值、`--detail` 是否注册仍由各命令
// 文件决定（两命令本就不同），使 --help 输出与重构前逐字一致。
package cli

import "flag"

// parseScanDirArgs 在 fs 上执行 parseFlags 并校验 `--dir` 非空（两命令共用）。
// dirPath 由各命令文件 inline 注册后传入，注册行不得移到本文件
// （否则 CLI registry 提取不到 flag → 文档与 shell 补全退化）。
// 返回 filesRoot（由 parseFlags 附带产出，各命令当前均丢弃）。
func parseScanDirArgs(fs *flag.FlagSet, dirPath *string, args []string) (string, error) {
	filesRoot, err := parseFlags(fs, args)
	if err != nil {
		return "", err
	}
	if *dirPath == "" {
		return "", newParamErrf("--dir 参数不能为空")
	}
	return filesRoot, nil
}
