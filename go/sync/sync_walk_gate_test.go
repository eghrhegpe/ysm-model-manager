// sync_walk_gate_test.go：统一剔除闸的 fail-closed 契约测试（ADR-351 D1，2026-10-16）。
//
// 病史：ADR-342 修「回收站过滤漏一处」时，包内已有五处手抄过滤、conflict.go 一处
// 完全缺失——逐点补丁治不了类。本测试从**源码文本**派生 Walk/WalkDir 调用点清单
// （fail-closed：不是人工枚举清单，清单漏列一个收集器它根本不进扫描），断言每个
// 调用点经统一闸 skipExcludedDir 挂闸：
//   - 内联闭包回调：调用点所在函数体必须直接出现 skipExcludedDir(；
//   - 具名回调（filepath.Walk(root, st.walkFn) 形态）：追到回调定义块断言挂闸；
//   - 两者都不满足 → 当场红。新增收集器忘挂闸即被本测试拦截。
//
// 与 tests/test_sync_write_cache_pairing.ts（写面派生闸）同款范式：候选从源码派生，
// 不依赖人工维护清单。合法豁免（如确需遍历回收站内容的恢复工具）：修改本测试并
// 附理由注释，让豁免显式出现在 diff 评审里。
package sync

import (
	"os"
	"regexp"
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// walkCallRe 匹配 Walk/WalkDir 调用（要求紧跟实参括号，注释里的裸提及不误报）。
// 注意 (Dir)? 须成组可选——裸 `WalkDir?` 只让末字符 r 可选，会漏掉全部 filepath.Walk(。
var walkCallRe = regexp.MustCompile(`filepath\.Walk(Dir)?\(`)

// namedCallbackRe 提取具名回调标识（st.walkFn / collectFn），用于跨函数追踪闸位置。
var namedCallbackRe = regexp.MustCompile(`filepath\.Walk(Dir)?\(\s*[^,]+,\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)`)

// minWalkSites 调用点数量下限（防扫描器静默失效后的恒绿空转；现网 7 处，
// D3/D4 收口后允许自然下降，跌破下限时同步修本数字——write-surface-gate minSites 同款纪律）。
const minWalkSites = 5

// srcBlock 一个顶层函数块（从 "^func " 行到下一个 "^func " 行；块尾吞掉的顶层
// var/const 无害——Walk 调用只存在于函数体内）。
type srcBlock struct {
	file string
	sig  string // 函数签名行（块首行）
	body string // 含签名行的整个块
}

// loadPackageBlocks 读包目录全部非测试 .go 源文件，切顶层函数块。
func loadPackageBlocks(t *testing.T) []srcBlock {
	t.Helper()
	entries, err := os.ReadDir(".")
	testutil.NoError(t, err, "读包目录失败")
	var blocks []srcBlock
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		data, err := os.ReadFile(name)
		testutil.NoError(t, err, "读 %s 失败", name)
		lines := strings.Split(string(data), "\n")
		start := -1
		flush := func(end int) {
			if start < 0 {
				return
			}
			blocks = append(blocks, srcBlock{
				file: name,
				sig:  lines[start],
				body: strings.Join(lines[start:end], "\n"),
			})
		}
		for i, ln := range lines {
			// 顶层 func 行：闭包是 "func(" 无空格，不在此列
			if strings.HasPrefix(ln, "func ") {
				flush(i)
				start = i
			}
		}
		flush(len(lines))
	}
	return blocks
}

// funcSigRe 构造匹配指定函数名签名行的正则（值接收者/指针接收者/普通函数三形态）。
func funcSigRe(name string) *regexp.Regexp {
	return regexp.MustCompile(`^func\s+(\([^)]*\)\s+)?` + regexp.QuoteMeta(name) + `\(`)
}

// blockLabel 人读的块定位（file + 签名截断）。
func blockLabel(b srcBlock) string {
	sig := b.sig
	if len(sig) > 60 {
		sig = sig[:60]
	}
	return b.file + " " + sig
}

// walkBlockGated 判定一个含 Walk 调用的函数块是否经统一闸挂闸：
// ① 函数体直接出现 skipExcludedDir(（内联闭包形态）；或
// ② Walk 用具名回调（filepath.Walk(root, st.walkFn) 形态）——追到回调定义块断言挂闸。
func walkBlockGated(blocks []srcBlock, b srcBlock) bool {
	if strings.Contains(b.body, "skipExcludedDir(") {
		return true
	}
	if m := namedCallbackRe.FindStringSubmatch(b.body); m != nil {
		cbName := m[1]
		if idx := strings.LastIndex(cbName, "."); idx >= 0 {
			cbName = cbName[idx+1:] // 剥接收者前缀（st.walkFn → walkFn）
		}
		sigRe := funcSigRe(cbName)
		for _, cb := range blocks {
			if sigRe.MatchString(cb.sig) && strings.Contains(cb.body, "skipExcludedDir(") {
				return true
			}
		}
	}
	return false
}

func TestWalkCollectorsUseExclusionGate(t *testing.T) {
	blocks := loadPackageBlocks(t)

	type site struct {
		file string
		fn   string
	}
	var sites []site
	var violations []string

	for _, b := range blocks {
		if !walkCallRe.MatchString(b.body) {
			continue
		}
		sites = append(sites, site{file: b.file, fn: b.sig})
		if walkBlockGated(blocks, b) {
			continue
		}
		violations = append(violations, blockLabel(b))
	}

	testutil.Equal(t, len(sites) >= minWalkSites, true,
		"Walk 调用点仅 %d 处（< %d）——派生扫描疑似失效或收集器被合并，"+
			"请核对后同步 minWalkSites（ADR-351 D1 契约测试）", len(sites), minWalkSites)
	if len(violations) > 0 {
		t.Errorf("发现 %d 个未挂统一剔除闸的 Walk 收集器（ADR-351 D1）：\n  %s\n"+
			"修复：回调的目录分支顶部调用 skipExcludedDir(root, path) 并 return err；"+
			"确属合法豁免（如需遍历回收站内容的恢复工具）时修改本测试并附理由。",
			len(violations), strings.Join(violations, "\n  "))
	}
}
