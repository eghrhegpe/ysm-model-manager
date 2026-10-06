// ===== collectMergedFiles 白盒数据锁定测试（gocyclo 拆解红线）=====
// collectMergedFiles 生产调用点只有 1 处（parseModelFromEntries 的 L1 兜底分支），
// 测试侧此前 **零直调**——它只被 ParseFromZip 黑盒间接执行到，且断言全落在
// 「合并后的 BedrockModel」上，四个返回元组里的「条目集 / 条目名 / 条目大小 /
// 条目内容 / 枚举序」从未被逐条断言过（改造前 go tool cover 实测 86.3%，
// 未覆盖的 4 块恰是三条物化封顶 break 与 F-4 空 buf 跳过）。
//
// 本文件用手写 container.Entry 桩直喂该函数：map 驱动的 testutil.MakeZipBytes
// 迭代序随机，钉不住「枚举序即收集序」这条不变量，故不用真 zip。
package geometry

import (
	"bytes"
	"errors"
	"io"
	"strconv"
	"testing"

	"ysm-model-manager/go/container"
)

// collectEntryStub 手写 container.Entry 桩：条目序 / 名 / 内容 / Open 错误全由测试决定。
type collectEntryStub struct {
	name    string
	dir     bool
	data    string
	openErr error
}

func (e collectEntryStub) Name() string               { return e.name }
func (e collectEntryStub) IsDir() bool                { return e.dir }
func (e collectEntryStub) UncompressedSize64() uint64 { return uint64(len(e.data)) }
func (e collectEntryStub) Open() (io.ReadCloser, error) {
	if e.openErr != nil {
		return nil, e.openErr
	}
	return io.NopCloser(bytes.NewReader([]byte(e.data))), nil
}

// stubEntries 按给定顺序把桩装箱成 []container.Entry（顺序即 collectMergedFiles 的枚举序）。
func stubEntries(stubs ...collectEntryStub) []container.Entry {
	out := make([]container.Entry, 0, len(stubs))
	for _, s := range stubs {
		out = append(out, s)
	}
	return out
}

// geoEntryNames 取 geoEntry 的条目名序列（原样，不做 basename）。
func geoEntryNames(gfs []geoEntry) []string {
	names := make([]string, 0, len(gfs))
	for _, gf := range gfs {
		names = append(names, gf.name)
	}
	return names
}

// geoEntryPayloads 取 geoEntry 的内容序列（逐条比对 payload，不只比条数）。
func geoEntryPayloads(gfs []geoEntry) []string {
	payloads := make([]string, 0, len(gfs))
	for _, gf := range gfs {
		payloads = append(payloads, string(gf.data))
	}
	return payloads
}

// pngPayloads 取纹理字节序列的字符串形态（逐条比对 payload）。
func pngPayloads(pngs [][]byte) []string {
	payloads := make([]string, 0, len(pngs))
	for _, p := range pngs {
		payloads = append(payloads, string(p))
	}
	return payloads
}

// equalStrings 逐位置比对两个字符串序列（禁有序快照式的整体结构断言，这里显式列出期望值）。
func equalStrings(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range want {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

// TestCollectMergedFiles_EnumerationOrderAndPayload 钉死四个返回元组的数据本体：
//   - geoFiles：条目名 + 内容 + 「枚举序即收集序」（main.geo.json 先、last.geo.json 后，
//     中间夹的 arm / 外来命名空间 / 空 buf / Open 失败条目一律不占位）；
//   - animJSONs：animation 与 controller 两类都收、按枚举序、内容原样；
//   - pngs/pngNames：.png 与 .jpg 都收、名字为「basename 去 png/jpg 后缀」、字节原样；
//   - 过滤：ysm.json 入口清单、目录条目、arm.json、avatar//gui/ 路径、外来命名空间。
func TestCollectMergedFiles_EnumerationOrderAndPayload(t *testing.T) {
	const ns = "assets/ns/"
	entries := stubEntries(
		collectEntryStub{name: ns + "ysm.json", data: `{"files":{}}`},                  // 入口清单：不收
		collectEntryStub{name: ns + "textures/", dir: true},                            // 目录：不收
		collectEntryStub{name: ns + "main.geo.json", data: "MAINGEO"},                  // geo #1
		collectEntryStub{name: ns + "anim.animation.json", data: "ANIM-A"},             // anim #1
		collectEntryStub{name: ns + "tiny.animation.json", data: "{}"},                 // anim 过短（len<=2）：不收
		collectEntryStub{name: ns + "ctrl.animation_controller.json", data: "CTRL-B"},  // anim #2（controller）
		collectEntryStub{name: ns + "textures/skin.png", data: "PNG1"},                 // png #1
		collectEntryStub{name: ns + "textures/coat.jpg", data: "JPG2"},                 // png #2（.jpg 同口径）
		collectEntryStub{name: ns + "textures/empty.png", data: ""},                    // 空纹理：不占物化槽位
		collectEntryStub{name: ns + "avatar/face.png", data: "AVATAR"},                 // avatar/：不收
		collectEntryStub{name: ns + "gui/icon.png", data: "GUI"},                       // gui/：不收
		collectEntryStub{name: ns + "arm.json", data: "ARM"},                           // 第一人称手臂：不收
		collectEntryStub{name: ns + "empty.geo.json", data: ""},                        // 空 buf：不占物化槽位（F-4）
		collectEntryStub{name: ns + "broken.geo.json", openErr: errors.New("open 失败")}, // Open 失败：不收
		collectEntryStub{name: ns + "last.geo.json", data: "LASTGEO"},                  // geo #2
		collectEntryStub{name: "other/ns/foreign.geo.json", data: "FOREIGN"},           // 外来命名空间：不收
		collectEntryStub{name: "other/ns/foreign.animation.json", data: "FANIM"},       // 外来命名空间：不收
		collectEntryStub{name: "other/ns/foreign.png", data: "FPNG"},                   // 外来命名空间：不收
	)

	geoFiles, animJSONs, pngs, pngNames := collectMergedFiles(entries, ns)

	if got, want := geoEntryNames(geoFiles), []string{ns + "main.geo.json", ns + "last.geo.json"}; !equalStrings(got, want) {
		t.Errorf("geoFiles 条目名 = %v, 期望 %v（枚举序即收集序，且排除项不占位）", got, want)
	}
	if got, want := geoEntryPayloads(geoFiles), []string{"MAINGEO", "LASTGEO"}; !equalStrings(got, want) {
		t.Errorf("geoFiles 内容 = %v, 期望 %v（data 不得被静默截断/串位）", got, want)
	}
	if got, want := animJSONs, []string{"ANIM-A", "CTRL-B"}; !equalStrings(got, want) {
		t.Errorf("animJSONs = %v, 期望 %v（animation + controller 两类同收且保序；len<=2 的 {} 不收）", got, want)
	}
	if got, want := pngPayloads(pngs), []string{"PNG1", "JPG2"}; !equalStrings(got, want) {
		t.Errorf("pngs 内容 = %v, 期望 %v（空内容纹理不占位）", got, want)
	}
	if got, want := pngNames, []string{"skin", "coat"}; !equalStrings(got, want) {
		t.Errorf("pngNames = %v, 期望 %v（basename 去 .png/.jpg 后缀，与 pngs 同序）", got, want)
	}

	// 尺寸不变量：ReadLimitedEntry 正常路径下 geo 内容长度与源字节一致（非超限即不截断）
	for i, gf := range geoFiles {
		if len(gf.data) == 0 {
			t.Errorf("geoFiles[%d] 内容为空，不应入列", i)
		}
	}
}

// TestCollectMergedFiles_EmptyNamespaceCollectsEverything：maidNs 为空时命名空间过滤
// 整体关闭——根 maid_model.json 与任意子目录模型都按枚举序收入 geoFiles（L1 兜底口径）。
func TestCollectMergedFiles_EmptyNamespaceCollectsEverything(t *testing.T) {
	entries := stubEntries(
		collectEntryStub{name: "maid_model.json", data: "M1"},
		collectEntryStub{name: "sub/maid_model.json", data: "M2"},
		collectEntryStub{name: "other/foreign.geo.json", data: "F"},
	)
	geoFiles, animJSONs, pngs, pngNames := collectMergedFiles(entries, "")
	if got, want := geoEntryNames(geoFiles), []string{"maid_model.json", "sub/maid_model.json", "other/foreign.geo.json"}; !equalStrings(got, want) {
		t.Errorf("geoFiles 条目名 = %v, 期望 %v（maidNs 空 → 命名空间过滤关闭）", got, want)
	}
	if len(animJSONs) != 0 || len(pngs) != 0 || len(pngNames) != 0 {
		t.Errorf("anim/png 应为空, got anim=%v pngs=%d names=%v", animJSONs, len(pngs), pngNames)
	}
}

// TestCollectMergedFiles_MaidManifestJSONsExcludedInNamespace：maidNs 非空时三份女仆清单
// （maid_model/maid_chair/maid_sound）被排除，且排除判定走小写化条目名（大写形态也排除）；
// YSM.JSON 的入口清单判定大小写不敏感（EqualFold），必须同样被排除。
func TestCollectMergedFiles_MaidManifestJSONsExcludedInNamespace(t *testing.T) {
	const ns = "assets/touhou/"
	entries := stubEntries(
		collectEntryStub{name: ns + "maid_model.json", data: "MM"},
		collectEntryStub{name: ns + "maid_chair.json", data: "MC"},
		collectEntryStub{name: ns + "maid_sound.json", data: "MS"},
		collectEntryStub{name: ns + "MAID_MODEL.JSON", data: "MM-UPPER"}, // 小写化后同一判据
		collectEntryStub{name: ns + "YSM.JSON", data: "{}"},              // 入口清单判定大小写不敏感
		collectEntryStub{name: ns + "real.geo.json", data: "REAL"},
		collectEntryStub{name: ns + "real.animation.json", data: "REALANIM"},
		collectEntryStub{name: "assets/other/anim.animation.json", data: "FOREIGN"},
	)
	geoFiles, animJSONs, pngs, pngNames := collectMergedFiles(entries, ns)
	if got, want := geoEntryNames(geoFiles), []string{ns + "real.geo.json"}; !equalStrings(got, want) {
		t.Errorf("geoFiles 条目名 = %v, 期望 %v（女仆清单/YSM.JSON 全排除）", got, want)
	}
	if got, want := geoEntryPayloads(geoFiles), []string{"REAL"}; !equalStrings(got, want) {
		t.Errorf("geoFiles 内容 = %v, 期望 %v", got, want)
	}
	if got, want := animJSONs, []string{"REALANIM"}; !equalStrings(got, want) {
		t.Errorf("animJSONs = %v, 期望 %v（外来命名空间动画不收）", got, want)
	}
	if len(pngs) != 0 || len(pngNames) != 0 {
		t.Errorf("png 应为空, got pngs=%d names=%v", len(pngs), pngNames)
	}
}

// TestCollectMergedFiles_MaterializeCapStopsWholeLoop 物化封顶（畸形输入降级）。
// 三条通道各自「条目数 ≥ maxMaterializeEntries」即置 stop 并 **整体**结束条目循环：
// 封顶之后排队的条目（含纹理）一条都不收。这是原 `break` 写在 switch 内会丢的语义
// （switch 里的 break 只跳 switch），故逐通道断言封顶计数与封顶后条目被丢弃。
// 只测条目数封顶这一半——字节封顶（512MB）与它共用同一 stop 分支，造 512MB 输入不划算。
func TestCollectMergedFiles_MaterializeCapStopsWholeLoop(t *testing.T) {
	// stubMany 造 n 条同名前缀条目 + 末尾一条探针条目（用于验证封顶后一条都不收）。
	stubMany := func(n int, name func(i int) string, data string, tail collectEntryStub) []container.Entry {
		out := make([]container.Entry, 0, n+1)
		for i := 0; i < n; i++ {
			out = append(out, collectEntryStub{name: name(i), data: data})
		}
		return append(out, tail)
	}

	t.Run("geo 通道封顶", func(t *testing.T) {
		entries := stubMany(maxMaterializeEntries+1,
			func(i int) string { return "m" + string(rune('a'+i%26)) + strconv.Itoa(i) + ".geo.json" },
			"G", collectEntryStub{name: "tail.png", data: "TAIL"})
		geoFiles, _, pngs, _ := collectMergedFiles(entries, "")
		if len(geoFiles) != maxMaterializeEntries {
			t.Fatalf("geoFiles = %d, 期望恰好 %d（第 %d 条触发封顶）", len(geoFiles), maxMaterializeEntries, maxMaterializeEntries)
		}
		if len(pngs) != 0 {
			t.Fatalf("pngs = %d, 期望 0（封顶后整体停止，尾部纹理不得再收）", len(pngs))
		}
	})

	t.Run("动画通道封顶", func(t *testing.T) {
		entries := stubMany(maxMaterializeEntries+1,
			func(i int) string { return "a" + strconv.Itoa(i) + ".animation.json" },
			"AAAA", collectEntryStub{name: "tail.png", data: "TAIL"})
		_, animJSONs, pngs, _ := collectMergedFiles(entries, "")
		if len(animJSONs) != maxMaterializeEntries {
			t.Fatalf("animJSONs = %d, 期望恰好 %d", len(animJSONs), maxMaterializeEntries)
		}
		if len(pngs) != 0 {
			t.Fatalf("pngs = %d, 期望 0（封顶后整体停止）", len(pngs))
		}
	})

	t.Run("纹理通道封顶", func(t *testing.T) {
		entries := stubMany(maxMaterializeEntries+1,
			func(i int) string { return "t" + strconv.Itoa(i) + ".png" },
			"P", collectEntryStub{name: "tail.geo.json", data: "TAIL"})
		geoFiles, _, pngs, pngNames := collectMergedFiles(entries, "")
		if len(pngs) != maxMaterializeEntries || len(pngNames) != maxMaterializeEntries {
			t.Fatalf("pngs = %d / pngNames = %d, 期望均恰好 %d（两切片同步）", len(pngs), len(pngNames), maxMaterializeEntries)
		}
		if len(geoFiles) != 0 {
			t.Fatalf("geoFiles = %d, 期望 0（封顶后整体停止）", len(geoFiles))
		}
	})
}
