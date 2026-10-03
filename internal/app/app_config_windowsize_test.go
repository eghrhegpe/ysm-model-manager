// clampWindowSize 纯函数测试——不触碰配置目录 / user32（测试文件约束见 app_config_test.go 头注）
package app

import "testing"

func TestClampWindowSize(t *testing.T) {
	cases := []struct {
		name         string
		w, h         int
		wantW, wantH int
	}{
		// <=0 回落默认 1200×800（「未配置」哨兵判据依赖该值）
		{"零值回落默认", 0, 0, 1200, 800},
		{"负值回落默认", -100, -5, 1200, 800},
		{"半损坏零高", 1500, 0, 1500, 800},
		// 正数但离谱小 → 夹紧到 800×600（对应 main.go MinWidth/MinHeight）
		{"1x1 损坏夹紧", 1, 1, 800, 600},
		{"半损坏窄宽夹紧", 50, 900, 800, 900},
		{"半损坏矮高夹紧", 1024, 30, 1024, 600},
		// 正常值原样透传
		{"正常尺寸透传", 1280, 800, 1280, 800},
		{"最小值边界透传", 800, 600, 800, 600},
		{"略高于最小值透传", 801, 601, 801, 601},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			gotW, gotH := clampWindowSize(c.w, c.h)
			if gotW != c.wantW || gotH != c.wantH {
				t.Errorf("clampWindowSize(%d,%d) = (%d,%d), want (%d,%d)",
					c.w, c.h, gotW, gotH, c.wantW, c.wantH)
			}
		})
	}
}
