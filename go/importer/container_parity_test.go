// ===== ADR-174 D5：DetectContainerType 双端 fixture 对账 =====
// 黄金语料：tests/fixtures/parity/container-fingerprint.golden.json（条目名清单，双端共享）。
// 黄金值由 Go（主源侧）产出；TS 侧 frontend/src/parsers/container-fingerprint-parity.test.ts
// 用 fflate 造同构 zip、断言同黄金值。regen：YSM_PARITY_REGEN=1 go test ./go/importer -run TestContainerFingerprintParity
package importer

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"os"
	"testing"
)

type containerParityCase struct {
	ID      string   `json:"id"`
	Comment string   `json:"$comment,omitempty"`
	Entries []string `json:"entries"`
	Golden  *string  `json:"golden"`
}

type containerGoldenFile struct {
	Comment string                `json:"$comment"`
	Cases   []containerParityCase `json:"cases"`
}

const containerGoldenPath = "../../tests/fixtures/parity/container-fingerprint.golden.json"

func loadContainerGolden(t *testing.T) *containerGoldenFile {
	t.Helper()
	data, err := os.ReadFile(containerGoldenPath)
	if err != nil {
		t.Fatalf("读黄金语料失败: %v", err)
	}
	var gf containerGoldenFile
	if err := json.Unmarshal(data, &gf); err != nil {
		t.Fatalf("解析黄金语料失败: %v", err)
	}
	if len(gf.Cases) == 0 {
		t.Fatal("黄金语料为空")
	}
	return &gf
}

// buildZipBytes：条目名 → 最小 zip（内容空字节即可，指纹只看条目名）。
func buildZipBytes(t *testing.T, entries []string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for _, name := range entries {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write(nil); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestContainerFingerprintParity(t *testing.T) {
	gf := loadContainerGolden(t)
	regen := os.Getenv("YSM_PARITY_REGEN") == "1"
	if regen {
		t.Log("regen 模式：黄金值以当前 Go 实现产出重写")
	}
	for i := range gf.Cases {
		c := gf.Cases[i]
		t.Run(c.ID, func(t *testing.T) {
			got := DetectContainerType(buildZipBytes(t, c.Entries))
			if regen {
				gf.Cases[i].Golden = &got
				return
			}
			if c.Golden == nil {
				t.Fatalf("[%s] golden 未生成（先跑 regen）", c.ID)
			}
			if got != *c.Golden {
				t.Errorf("[%s] 对账漂移：got = %q, want = %q", c.ID, got, *c.Golden)
			}
		})
	}
	if regen {
		out, err := json.MarshalIndent(gf, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(containerGoldenPath, append(out, '\n'), 0644); err != nil {
			t.Fatalf("写黄金语料失败: %v", err)
		}
		t.Logf("黄金语料已重写: %s", containerGoldenPath)
	}
}
