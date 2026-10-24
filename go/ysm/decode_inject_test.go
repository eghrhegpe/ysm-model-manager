// ===== go/ysm 解码器注入点单测 =====
// SetDecoder/DecodeYSM 往返：未注入返回 nil，注入后透传结果
package ysm

import (
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

func TestDecodeYSM_NoDecoderInjected(t *testing.T) {
	// 测试默认未注入状态（其他测试注入后均以 t.Cleanup 恢复 nil）
	testutil.Nil(t, DecodeYSM([]byte("YSGP\x00test")), "未注入解码器应返回 nil")
}

func TestDecodeYSM_InjectedPassthrough(t *testing.T) {
	SetDecoder(func(data []byte) []DecodedFile {
		return []DecodedFile{{Path: "output/a.json", Data: data}}
	})
	t.Cleanup(func() { SetDecoder(nil) })

	got := DecodeYSM([]byte("YSGP\x00abc"))
	// 原复合条件拆序贯（len 守卫下方 got[0] 索引）
	testutil.Equal(t, len(got), 1, "注入解码器应透传结果, 得到 %+v", got)
	testutil.Equal(t, got[0].Path, "output/a.json", "注入解码器应透传结果, 得到 %+v", got)
	testutil.Equal(t, string(got[0].Data), "YSGP\x00abc", "注入解码器应透传结果, 得到 %+v", got)
}

func TestDecodeYSM_InjectNilResult(t *testing.T) {
	// 解码器返回 nil（无 node 等失败场景）→ DecodeYSM 返回 nil
	SetDecoder(func(data []byte) []DecodedFile { return nil })
	t.Cleanup(func() { SetDecoder(nil) })

	testutil.Nil(t, DecodeYSM([]byte("x")), "解码器返回 nil 时应透传 nil")
}
