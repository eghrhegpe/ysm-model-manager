// ===== 社区创作者双重编码（mojibake）净化测试 =====
// 锁定 2026-09-21 污染事件的回归防线：前端 GitHub API 路 atob 产出的 Latin-1 字符串
// （UTF-8 字节被逐字节当码位）在进入 Go 合并闸时须被还原回真实码位，
// 从而与既有干净条目同名合并、或落盘为干净名——不再制造按 name 去重失效的重复脏条目。
package app

import (
	"encoding/json"
	"testing"

	"ysm-model-manager/go/types"
)

// toMojibake 模拟前端 atob 的产物：把正确字符串的每个 UTF-8 字节当成一个 ISO-8859-1 码位。
// 与真实故障逐字节同构（atob 返回的串，第 i 个字符码位 = base64 解码字节 = 原 UTF-8 第 i 字节）。
func toMojibake(s string) string {
	out := make([]rune, 0, len(s))
	for i := 0; i < len(s); i++ {
		out = append(out, rune(s[i]))
	}
	return string(out)
}

func TestRepairMojibake(t *testing.T) {
	t.Run("中文双重编码还原", func(t *testing.T) {
		if got := repairMojibake(toMojibake("雾雨波波沙")); got != "雾雨波波沙" {
			t.Errorf("应还原为「雾雨波波沙」, got %q", got)
		}
		if got := repairMojibake(toMojibake("绝区零")); got != "绝区零" {
			t.Errorf("应还原为「绝区零」, got %q", got)
		}
		// 混合中英 + 标点
		src := "kyln默寒寒冰"
		if got := repairMojibake(toMojibake(src)); got != src {
			t.Errorf("混合串应还原, want %q got %q", src, got)
		}
	})

	t.Run("纯 ASCII 不动", func(t *testing.T) {
		for _, s := range []string{"", "Bilibili", "A_su", "123", "namekuji1337"} {
			if got := repairMojibake(s); got != s {
				t.Errorf("纯 ASCII 应原样返回 %q, got %q", s, got)
			}
		}
	})

	t.Run("已是真多字节文本不动（含 >0xFF 码位即判非双重编码）", func(t *testing.T) {
		for _, s := range []string{"原神", "雾雨波波沙", "ＡＢＣ", "Ω→λ"} {
			if got := repairMojibake(s); got != s {
				t.Errorf("正常 CJK/符号应原样返回 %q, got %q", s, got)
			}
		}
	})

	t.Run("真 Latin-1（孤立重音字符，字节非合法 UTF-8）不误伤", func(t *testing.T) {
		// 单个 é（码位 0xE9）单独成串：重建字节 [0xE9] 不是合法 UTF-8，应判为真内容不动。
		garble := string([]rune{0xE9, 0x00, 0xE9}) // 含 0x00 控制码也须不动
		if got := repairMojibake(garble); got != garble {
			t.Errorf("非法 UTF-8 字节序列应原样返回, got %q", got)
		}
	})

	t.Run("幂等：还原后的串再还原不变", func(t *testing.T) {
		once := repairMojibake(toMojibake("苏溟0w0"))
		if twice := repairMojibake(once); twice != once {
			t.Errorf("repair 应幂等, once=%q twice=%q", once, twice)
		}
	})
}

// 合并闸集成：乱码社区条目须还原后与既有干净条目同名合并（update 不 add），
// 以及全新的乱码条目落盘为干净名——复现 9/21「197 条乱码当新作者追加」的防线。
func TestMergeCommunityCreatorsFromJSON_MojibakeRepair(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := repoApp(t, types.AppConfig{})
	// 本地已有一条干净创作者
	seed := []types.WorkshopCreator{{Name: "雾雨波波沙", Type: "bilibili", Desc: "车万/暮色森林二创", Role: "creator"}}
	if err := a.SaveWorkshopCreators(seed); err != nil {
		t.Fatal(err)
	}

	// 社区索引同时含：① 一条与本地同名的乱码条目（应还原后 update 合并，不新增重复）
	//                    ② 一条全新的乱码条目（应还原为干净名后 add）
	community := []types.WorkshopCreator{
		{Name: toMojibake("雾雨波波沙"), Type: "bilibili;afdian"},
		{Name: toMojibake("爱吃园田海味"), Type: "bilibili", Desc: toMojibake("东方project、LoveLive 开源分享")},
	}
	data, err := json.Marshal(community)
	if err != nil {
		t.Fatal(err)
	}
	added, updated, err := a.MergeCommunityCreatorsFromJSON(string(data))
	if err != nil {
		t.Fatalf("合并不应失败, got %v", err)
	}
	if added != 1 || updated != 1 {
		t.Fatalf("期望 added=1 updated=1（乱码还原后与本地同名合并）, got added=%d updated=%d", added, updated)
	}

	got := a.LoadWorkshopCreators()
	byName := map[string]types.WorkshopCreator{}
	for _, c := range got {
		byName[c.Name] = c
	}
	if len(got) != 2 {
		t.Fatalf("合并后应 2 条（无乱码重复）, got %d: %+v", len(got), got)
	}
	// 乱码名不得出现在落盘数据里
	for _, c := range got {
		if c.Name != repairMojibake(c.Name) {
			t.Errorf("落盘存在未还原的乱码名: %q", c.Name)
		}
	}
	// 雾雨波波沙：type 段并入 afdian，desc/role 保留本地值
	wu := byName["雾雨波波沙"]
	if wu.Name == "" {
		t.Fatal("应存在干净名「雾雨波波沙」")
	}
	if !inTypeSegments(wu.Type, "afdian") || !inTypeSegments(wu.Type, "bilibili") {
		t.Errorf("雾雨波波沙.type 应含 bilibili+afdian, got %q", wu.Type)
	}
	// 爱吃园田海味：新增且 desc 已还原为干净文本
	ai := byName["爱吃园田海味"]
	if ai.Name == "" {
		t.Fatal("应存在还原后的新条目「爱吃园田海味」")
	}
	if ai.Desc != "东方project、LoveLive 开源分享" {
		t.Errorf("desc 应被还原为干净文本, got %q", ai.Desc)
	}
}
