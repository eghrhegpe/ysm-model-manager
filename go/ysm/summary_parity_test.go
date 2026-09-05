// ===== ADR-174 D5：ExtractYsmSummary 双端 fixture 对账 =====
// 黄金语料：tests/fixtures/parity/ysm-summary.golden.json（单一事实源，双端共享）。
// 黄金值由 Go（主源侧）产出；TS 侧 frontend/src/parsers/ysm-summary-parity.test.ts
// 用 fflate 造同构语料、断言同黄金值——任何一侧实现漂移即对账失败。
//
// regen 模式：YSM_PARITY_REGEN=1 go test ./go/ysm -run TestYsmSummaryParity
// 整文件重写黄金 JSON（保留原 $comment/$sizePolicy/webOverrides 声明，只刷新 golden）。
//
// D3 声明制差异：`size` 双端排除——Go=os.Stat 实际磁盘字节（随 zip 编码器/版本变），
// web=纯字节流无 stat 等价物（固定 0）。语料 JSON 中 golden.size 恒为 0 占位。
package ysm

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/internal/testutil"
)

type summaryParityCase struct {
	ID           string            `json:"id"`
	Comment      string            `json:"$comment,omitempty"`
	Kind         string            `json:"kind"` // zip | plain-json | raw
	Filename     string            `json:"filename"`
	Entries      map[string]string `json:"entries,omitempty"`
	Content      string            `json:"content,omitempty"`
	ExpectError  bool              `json:"expectError,omitempty"`
	Golden       json.RawMessage   `json:"golden,omitempty"`
	WebOverrides json.RawMessage   `json:"webOverrides,omitempty"`
}

type summaryGoldenFile struct {
	Comment string              `json:"$comment"`
	SizePOL string              `json:"$sizePolicy"`
	Cases   []summaryParityCase `json:"cases"`
}

const summaryGoldenPath = "../../tests/fixtures/parity/ysm-summary.golden.json"

func loadSummaryGolden(t *testing.T) *summaryGoldenFile {
	t.Helper()
	data, err := os.ReadFile(summaryGoldenPath)
	if err != nil {
		t.Fatalf("读黄金语料失败: %v", err)
	}
	var gf summaryGoldenFile
	if err := json.Unmarshal(data, &gf); err != nil {
		t.Fatalf("解析黄金语料失败: %v", err)
	}
	if len(gf.Cases) == 0 {
		t.Fatal("黄金语料为空")
	}
	return &gf
}

// buildSummaryFixture：按语料声明现造最小 fixture（不提交二进制语料，对齐 classify_test.go 范式）。
func buildSummaryFixture(t *testing.T, c summaryParityCase) string {
	t.Helper()
	switch c.Kind {
	case "zip":
		return testutil.WriteZipFile(t, c.Filename, c.Entries)
	case "plain-json", "raw":
		path := filepath.Join(t.TempDir(), c.Filename)
		if err := os.WriteFile(path, []byte(c.Content), 0644); err != nil {
			t.Fatal(err)
		}
		return path
	default:
		t.Fatalf("未知 kind: %q", c.Kind)
		return ""
	}
}

// runSummaryCase：跑单 case，返回归一化摘要 map；isErrCase=true 表示 golden={"error":true}（只验报错）。
func runSummaryCase(t *testing.T, c summaryParityCase) (m map[string]any, isErrCase bool) {
	t.Helper()
	path := buildSummaryFixture(t, c)
	summary, err := ExtractYsmSummary(path)
	if c.ExpectError {
		if err == nil {
			t.Errorf("[%s] 期望报错，实际 nil", c.ID)
		}
		return nil, true
	}
	if err != nil {
		t.Fatalf("[%s] 不应报错: %v", c.ID, err)
	}
	out, mErr := json.Marshal(summary)
	if mErr != nil {
		t.Fatal(mErr)
	}
	var got map[string]any
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatal(err)
	}
	delete(got, "size") // D3 双端排除
	return got, false
}

func TestYsmSummaryParity(t *testing.T) {
	gf := loadSummaryGolden(t)
	regen := os.Getenv("YSM_PARITY_REGEN") == "1"
	if regen {
		t.Log("regen 模式：黄金值以当前 Go 实现产出重写")
	}
	for i := range gf.Cases {
		c := gf.Cases[i]
		t.Run(c.ID, func(t *testing.T) {
			got, isErrCase := runSummaryCase(t, c)
			if isErrCase {
				return
			}
			if regen {
				if isErrCase {
					gf.Cases[i].Golden = json.RawMessage(`{"error":true}`)
				} else {
					out, mErr := json.Marshal(got)
					if mErr != nil {
						t.Fatal(mErr)
					}
					gf.Cases[i].Golden = json.RawMessage(out)
				}
				return
			}
			var wantRaw map[string]any
			if err := json.Unmarshal(c.Golden, &wantRaw); err != nil {
				t.Fatalf("[%s] golden 解析失败: %v", c.ID, err)
			}
			delete(wantRaw, "size")
			gotJSON, _ := json.Marshal(got)
			wantJSON, _ := json.Marshal(wantRaw)
			if string(gotJSON) != string(wantJSON) {
				t.Errorf("[%s] 对账漂移：\n got = %s\nwant = %s", c.ID, gotJSON, wantJSON)
			}
		})
	}
	if regen {
		out, err := json.MarshalIndent(gf, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(summaryGoldenPath, append(out, '\n'), 0644); err != nil {
			t.Fatalf("写黄金语料失败: %v", err)
		}
		t.Logf("黄金语料已重写: %s", summaryGoldenPath)
	}
}
