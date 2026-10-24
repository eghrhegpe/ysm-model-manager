package geometry

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

// ===== ysm.json metadata 段解析（Modern YSM RawMetadata 对齐，wine_fox 真实格式）=====

// makeZipWithFiles 用标准库构造 zip（name → content），独立于低层 rawZipEntry 机制
func makeZipWithFiles(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, content := range files {
		f, err := w.Create(name)
		testutil.NoError(t, err)
		if _, err := f.Write([]byte(content)); err != nil {
			testutil.NoError(t, err)
		}
	}
	if err := w.Close(); err != nil {
		testutil.NoError(t, err)
	}
	return buf.Bytes()
}

const metadataYsmJSON = `{
  "metadata": {
    "name": "Wine Fox（酒狐）",
    "tips": "一只爱喝葡萄酒的狐娘。",
    "license": { "type": "CC BY-NC-SA 4.0" },
    "authors": [
      {
        "name": "完美冻结",
        "role": "模型原作",
        "avatar": "avatar/wmdj.jpg",
        "contact": { "Bilibili": "https://space.bilibili.com/17798027" },
        "comment": "OwO"
      }
    ],
    "links": { "Afdian": "https://afdian.com/a/6TGESILA" }
  },
  "properties": { "default_texture": "textures/skin.png" },
  "files": {
    "player": { "model": { "main": "models/main.json" }, "texture": [ "textures/skin.png" ] }
  }
}`

const minimalMainJSON = `{"minecraft:geometry":[{"description":{"texture_width":64,"texture_height":64},"bones":[{"name":"root","pivot":[0,0,0],"cubes":[{"origin":[-4,0,-4],"size":[8,8,8],"uv":[0,0]}]}]}]}`

// tinyPNG 最小 PNG 头 + 填充（archive 收集只要求字节非空，不真解码）
func tinyPNG() string {
	return "\x89PNG\r\n\x1a\n" + strings.Repeat("0", 16)
}

func parseZipWithMetadata(t *testing.T, ysmJSON string) *parseResult {
	t.Helper()
	data := makeZipWithFiles(t, map[string]string{
		"ysm.json":          ysmJSON,
		"models/main.json":  minimalMainJSON,
		"textures/skin.png": tinyPNG(),
	})
	geo, pngs, _ := ParseFromZip(data, int64(len(data)))
	testutil.NotNil(t, geo, "ParseFromZip 返回 nil（fixture 无效）")
	return &parseResult{geo: geo, pngs: pngs}
}

// parseResult 测试局部聚合（避免依赖具体签名）
type parseResult struct {
	geo  *types.BedrockModel
	pngs [][]byte
}

func TestMetadata_Parsed(t *testing.T) {
	r := parseZipWithMetadata(t, metadataYsmJSON)
	m := r.geo.Metadata
	testutil.NotNil(t, m, "期望 geo.Metadata 非 nil")
	if m.Name != "Wine Fox（酒狐）" {
		t.Errorf("Name = %q, 期望 %q", m.Name, "Wine Fox（酒狐）")
	}
	if m.License == nil || m.License.Type != "CC BY-NC-SA 4.0" {
		t.Errorf("License = %+v, 期望 type=CC BY-NC-SA 4.0", m.License)
	}
	// 守卫下方 m.Authors[0] 索引
	testutil.Equal(t, len(m.Authors), 1, "Authors = %d 条, 期望 1", len(m.Authors))
	a := m.Authors[0]
	if a.Name != "完美冻结" || a.Role != "模型原作" {
		t.Errorf("Author = %+v, 期望 完美冻结/模型原作", a)
	}
	if a.Contact["Bilibili"] != "https://space.bilibili.com/17798027" {
		t.Errorf("Author.Contact = %v, 期望含 Bilibili 链接", a.Contact)
	}
	if a.Avatar != "avatar/wmdj.jpg" {
		t.Errorf("Author.Avatar = %q, 期望 avatar/wmdj.jpg", a.Avatar)
	}
	if m.Links["Afdian"] != "https://afdian.com/a/6TGESILA" {
		t.Errorf("Links = %v, 期望含 Afdian 链接", m.Links)
	}
	if m.Tips == "" {
		t.Error("期望 Tips 非空")
	}
}

func TestMetadata_Absent(t *testing.T) {
	// 无 metadata 段（老包）→ 不挂载，不 panic
	r := parseZipWithMetadata(t, `{
  "properties": { "default_texture": "textures/skin.png" },
  "files": { "player": { "model": { "main": "models/main.json" }, "texture": [ "textures/skin.png" ] } }
}`)
	if r.geo.Metadata != nil {
		t.Errorf("无 metadata 段应保持 nil, 实际 %+v", r.geo.Metadata)
	}
}

func TestMetadata_EmptyObject(t *testing.T) {
	// metadata: {} 空对象 → 不挂载（Name/Authors/License/Links 全空）
	r := parseZipWithMetadata(t, `{
  "metadata": {},
  "files": { "player": { "model": { "main": "models/main.json" }, "texture": [ "textures/skin.png" ] } }
}`)
	if r.geo.Metadata != nil {
		t.Errorf("空 metadata 应保持 nil, 实际 %+v", r.geo.Metadata)
	}
}

func TestMetadata_PartialNameOnly(t *testing.T) {
	// 只有 name → 挂载且其余字段零值
	r := parseZipWithMetadata(t, `{
  "metadata": { "name": "只名字" },
  "files": { "player": { "model": { "main": "models/main.json" }, "texture": [ "textures/skin.png" ] } }
}`)
	m := r.geo.Metadata
	testutil.NotNil(t, m, "期望 Metadata 非 nil")
	if m.Name != "只名字" {
		t.Errorf("Name = %q, 期望 只名字", m.Name)
	}
	if len(m.Authors) != 0 || m.License != nil {
		t.Errorf("部分字段应零值, Authors=%d License=%v", len(m.Authors), m.License)
	}
}

func TestMetadata_LooseShape_DoesNotBreakCore(t *testing.T) {
	// code review P2 回归：松散 metadata（license 为字符串、authors 为对象、links 为数组）
	// 不得拖垮整个 ysm.json 核心解析（纹理顺序/model/projectiles），metadata 解析失败仅忽略
	r := parseZipWithMetadata(t, `{
  "metadata": { "license": "CC BY-NC-SA 4.0", "authors": {}, "links": [] },
  "properties": { "default_texture": "textures/skin.png" },
  "files": { "player": { "model": { "main": "models/main.json" }, "texture": [ "textures/skin.png" ] } }
}`)
	// 核心解析成功：geo 有骨、纹理照常收集
	if r.geo.BoneCount != 1 {
		t.Errorf("松散 metadata 不应破坏核心解析: BoneCount=%d", r.geo.BoneCount)
	}
	if len(r.pngs) != 1 {
		t.Errorf("pngs = %d, 期望 1（纹理收集不受影响）", len(r.pngs))
	}
	// 松散 metadata 解析失败被忽略 → 保持零值不挂载（不 panic）
	if r.geo.Metadata != nil {
		t.Errorf("松散 metadata 应被忽略（不挂载）, 实际 %+v", r.geo.Metadata)
	}
}

func TestMetadata_TipsOnly_Mounts(t *testing.T) {
	// code review P3：谓词含 Tips——仅 tips 的 metadata 也应挂载
	r := parseZipWithMetadata(t, `{
  "metadata": { "tips": "作者提示，无名字" },
  "files": { "player": { "model": { "main": "models/main.json" }, "texture": [ "textures/skin.png" ] } }
}`)
	m := r.geo.Metadata
	testutil.NotNil(t, m, "仅 tips 的 metadata 应挂载（谓词含 Tips）")
	if m.Tips == "" {
		t.Error("期望 Tips 非空")
	}
}
