// updater_semver.go：版本号比较（原 updater.go 拆分，2026-10 文件行数治理）。
// isNewer / normalize / splitVer / fetchExpectedHash——tag/版本号规范化与前后版本判定。
package updater

import (
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"golang.org/x/mod/semver"
)

// ===== semver 比较 =====

func normalize(tag string) string {
	return strings.TrimPrefix(strings.TrimSpace(tag), "v")
}

// preReleaseSemantics 预发布语义开关（ADR-063 门控）：默认关闭=剥离 -+ 后缀比较，
// 维持现状判定（v1.0.0 与 v1.0.0-beta 视为相等）；未来发布 rc/beta 预发布 tag 时
// 开启，走标准 semver 预发布排序（正式版新于预发布版）。
var preReleaseSemantics = false

// isNewer 版本比较：合法 SemVer 走 x/mod/semver 标准比较；脏 tag/多段/dev 等
// 非标准版本回退手写 splitVer（防御语义，测试钉住：异常版本恒旧，绝不误触发更新）。
func isNewer(a, b string) bool {
	ca, cb := a, b
	if !preReleaseSemantics {
		ca = stripMeta(ca)
		cb = stripMeta(cb)
	}
	va, vb := "v"+ca, "v"+cb
	if semver.IsValid(va) && semver.IsValid(vb) {
		return semver.Compare(va, vb) > 0
	}
	pa := splitVer(a)
	pb := splitVer(b)
	for i := 0; i < len(pa) && i < len(pb); i++ {
		if pa[i] != pb[i] {
			return pa[i] > pb[i]
		}
	}
	return len(pa) > len(pb)
}

// stripMeta 剥离预发布/构建元数据后缀（-beta / +build），与 splitVer 内联剥离口径一致
func stripMeta(s string) string {
	if idx := strings.IndexAny(s, "-+"); idx >= 0 {
		return s[:idx]
	}
	return s
}

func splitVer(s string) []int {
	// 去掉预发布后缀（如 v1.2.3-beta → v1.2.3）
	if idx := strings.IndexAny(s, "-+"); idx >= 0 {
		s = s[:idx]
	}
	// 全段解析：不用 SplitN 截断，避免 4 段以上版本被截为 [.., "4.5"] 导致 Atoi 归零
	parts := strings.Split(s, ".")
	out := make([]int, len(parts))
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err == nil {
			out[i] = n
		}
		// Atoi 失败（脏 tag 如 vv1.1.0 normalize 后首段 "v1"）→ 保持 0，
		// 使该版本恒小于正常版本，绝不误触发更新（防御行为，update_test.go 锁定）
	}
	return out
}

// fetchExpectedHash 从 SHA256SUMS 文件中解析指定文件名的 hash
// 返回 (string, error)——原实现空字符串同时表达「未找到/网络错误/HTTP 错误」，
// 404/403 错误体按行解析不到返回 ""，Download 侧 `expectedHash==""` 门控使哈希校验整体
// 静默跳过（更新包无校验装盘）。现非 200 返回显式错误，调用方 CheckWithClient 记录告警。
func fetchExpectedHash(sumsURL string, fileName string) (string, error) {
	client := &http.Client{Timeout: apiTimeout}
	req, err := http.NewRequest("GET", sumsURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "YSM-Model-Manager/")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("SHA256SUMS 获取失败: HTTP %d", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10)) // 最多 64KB
	if err != nil {
		return "", err
	}

	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// 格式: <hash>  <filename>  或  <hash> *<filename>
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		name := strings.TrimPrefix(parts[1], "*")
		if strings.EqualFold(name, fileName) {
			return strings.ToLower(parts[0]), nil
		}
	}
	return "", fmt.Errorf("SHA256SUMS 中未找到 %s 的 hash", fileName)
}
