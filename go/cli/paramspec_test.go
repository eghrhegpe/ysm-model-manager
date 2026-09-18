package cli

import "testing"

// TestParamSpecRegistration ADR-173 A1/A4：已登记规格的命令须能被 GetAllowedCommandSpecs
// 完整导出，且声明序 = flag 定义序（search 以 keyword 为首、analyze 仅 model 单参等）。
// 该测试是「登记与命令实现同源」的守卫——新命令登记规格后若序/键写错在此暴露。
func TestParamSpecRegistration(t *testing.T) {
	specs := getAllowedSpecMap()

	t.Run("search 全量参数且序正确", func(t *testing.T) {
		spec, ok := specs["search"]
		if !ok {
			t.Fatal("search 未登记 ParamSpec")
		}
		wantKeys := []string{"keyword", "min-bones", "max-bones", "min-cubes", "max-cubes", "min-tex", "max-tex", "format"}
		assertSpecKeys(t, spec, wantKeys)
	})

	t.Run("analyze 单必填参数 model", func(t *testing.T) {
		spec, ok := specs["analyze"]
		if !ok {
			t.Fatal("analyze 未登记 ParamSpec")
		}
		assertSpecKeys(t, spec, []string{"model"})
		if len(spec) != 1 {
			t.Fatalf("analyze 应只有 1 个参数, 实际 %d", len(spec))
		}
	})

	t.Run("list limit/format", func(t *testing.T) {
		spec, ok := specs["list"]
		if !ok {
			t.Fatal("list 未登记 ParamSpec")
		}
		assertSpecKeys(t, spec, []string{"limit", "format"})
	})

	t.Run("single-bench 十参数（ADR-262 D3 修订：三旋钮正交面）", func(t *testing.T) {
		spec, ok := specs["single-bench"]
		if !ok {
			t.Fatal("single-bench 未登记 ParamSpec")
		}
		// 声明序 = flag 定义序（iterations → registerPerfTargetFlags 的 target/order/rtype/model/max-models
		// → 基准三参 → format）。三旋钮的 string/number 决定桥的序列化形态，错一个 GUI 就发不出参数。
		assertSpecKeys(t, spec, []string{
			"iterations", "target", "order", "rtype", "model", "max-models",
			"baseline", "save-baseline", "threshold", "format",
		})
		for i, want := range map[int]string{1: "target", 2: "order", 3: "rtype", 4: "model"} {
			if spec[i].Type != ParamString {
				t.Errorf("single-bench.%s 应为 string, 实际 %s", want, spec[i].Type)
			}
		}
		if spec[5].Type != ParamNumber {
			t.Errorf("single-bench.max-models 应为 number, 实际 %s", spec[5].Type)
		}
	})

	t.Run("concurrent-bench 与 single-bench 同面（同名同义，默认值不同）", func(t *testing.T) {
		spec, ok := specs["concurrent-bench"]
		if !ok {
			t.Fatal("concurrent-bench 未登记 ParamSpec")
		}
		assertSpecKeys(t, spec, []string{"workers", "target", "order", "rtype", "model", "max-models", "format"})
	})

	t.Run("gui-flow model/verbose", func(t *testing.T) {
		spec, ok := specs["gui-flow"]
		if !ok {
			t.Fatal("gui-flow 未登记 ParamSpec")
		}
		assertSpecKeys(t, spec, []string{"model", "verbose"})
		if spec[1].Type != ParamBool {
			t.Errorf("gui-flow.verbose 应为 bool, 实际 %s", spec[1].Type)
		}
	})

	t.Run("无参数命令不强制登记", func(t *testing.T) {
		// cache-status / perf-log 无 flag：允许无规格（走 legacy 零参数路径，等价）
		for _, name := range []string{"cache-status", "perf-log"} {
			spec, ok := specs[name]
			if ok && len(spec) != 0 {
				t.Errorf("命令 %s 无 flag 却登记了 %d 个参数规格", name, len(spec))
			}
		}
	})

	t.Run("规格与注册命令数一致", func(t *testing.T) {
		if got, want := len(specs), len(GetAllowedCommands()); got != want {
			t.Errorf("规格数 %d 与命令数 %d 不一致（遗漏或多余登记）", got, want)
		}
	})
}

func getAllowedSpecMap() map[string][]ParamSpec {
	raw := GetAllowedCommandSpecs()
	m := make(map[string][]ParamSpec, len(raw))
	for _, s := range raw {
		m[s.Name] = s.Params
	}
	return m
}

func assertSpecKeys(t *testing.T, spec []ParamSpec, wantKeys []string) {
	t.Helper()
	if len(spec) != len(wantKeys) {
		t.Fatalf("参数数不匹配: 期望 %d %v, 实际 %d %v", len(wantKeys), wantKeys, len(spec), spec)
	}
	for i, want := range wantKeys {
		if spec[i].Key != want {
			t.Errorf("声明序 [%d] 期望 %q, 实际 %q（声明序须与 flag 定义序一致）", i, want, spec[i].Key)
		}
	}
}
