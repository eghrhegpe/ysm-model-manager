package download

// ===== ResolveSavePath 补测：无 path 段 URL 的降级链 =====
// 原实现有两级降级此前无任何断言：
//   ① urlPath == "" → 回退 rawURL（**可达**，见下）
//   ② relPath == "" → 回退 filepath.Base(rawURL)（**不可达**：filepath.Base 对空串返回 "."，
//      对任何输入都非空——该分支是防御性死代码，保留原样不作为，此处如实记录而非强行覆盖）
// 实测结论（本文件钉住）：host-only URL 的 u.Path 为空 → ① 生效（urlPath = rawURL），
// 但最终 relPath 退化为 filepath.Base("") == "."，savePath 收敛到 saveDir 自身；
// 路径越界守卫显式放行 `absSavePath == absSaveDir`，故既不报错也不逃逸 saveDir。

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveSavePath_HostOnlyURLDegradesToSaveDir(t *testing.T) {
	dir := t.TempDir()
	savePath, jsd, api := ResolveSavePath("https://example.com", dir)
	if savePath == "" {
		t.Fatal("无 path 段的 URL 应走原始 URL 降级，而非判为拒绝")
	}
	// 终态：relPath 退化为 "."，savePath 精确等于 Clean(saveDir)
	absDir, err := filepath.Abs(dir)
	if err != nil {
		t.Fatal(err)
	}
	absSave, err := filepath.Abs(savePath)
	if err != nil {
		t.Fatal(err)
	}
	if absSave != absDir {
		t.Fatalf("host-only URL 应收敛到 saveDir 自身: absSave=%q absDir=%q", absSave, absDir)
	}
	// 安全边界：收敛值绝不逃出 saveDir（越界守卫显式放行「等于 saveDir」一种情形）
	if !strings.HasPrefix(absSave, absDir+string(filepath.Separator)) && absSave != absDir {
		t.Fatalf("降级后的 savePath 越界: %s（应在 %s 内）", absSave, absDir)
	}
	// 无 owner/repo（非 raw.githubusercontent 四段式）→ 不得凭空产出 jsd/api 回退源
	if jsd != "" || api != "" {
		t.Fatalf("无 owner/repo 时不得产出回退源: jsd=%q api=%q", jsd, api)
	}
}

// 降级链的「不可达」论证固化：filepath.Base 对空串返回 "."，故 relPath 永不为空，
// ② 级降级（回退 filepath.Base(rawURL)）无输入可达。
func TestResolveSavePath_BaseFallbackIsUnreachable(t *testing.T) {
	if filepath.Base("") == "" {
		t.Fatal("filepath.Base(\"\") 若为空串，则 ResolveSavePath 的第二级降级可达——需补覆盖用例")
	}
}
