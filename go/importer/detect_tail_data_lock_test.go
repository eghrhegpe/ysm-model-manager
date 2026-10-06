// ===== DetectContainerTypeFromBase64Tail 数据级判定锁（gocyclo 拆解红线）=====
// 既有 detect_tail_test.go 只锁「与全量路径一致」和三个 happy/degrade 面；本文件用
// **手工拼装的 zip 尾部**把探针的每条裁决逐条钉住——真实 zip.Writer 造不出 zip64 触顶、
// 中央目录超窗、条目数不符、签名错位这些形态，而它们正是「识别错容器类型」的唯一入口。
//
// 尾部探针只读 EOCD + 中央目录（不碰 local header / 文件数据），故可只构造尾部字节：
// [中央目录…][EOCD(22)][注释…]，cdOffset=0、fileTailOffset=0。
package importer

import (
	"encoding/base64"
	"encoding/binary"
	"testing"
)

// zipTail 手工 zip 尾部构造器。mutateEOCD/mutateCD 在偏移定稿前改写字节，
// 用于精确制造降级形态（签名/长度字段/触顶值）。
type zipTail struct {
	names      []string
	mutateEOCD func(eocd []byte)
	mutateCD   func(cd []byte)
	comment    []byte
	dropEOCD   bool
}

// bytes 拼装 [cd][eocd][comment]；EOCD 的 cdSize/cdOffset 按**改写后**的中央目录定稿。
func (z zipTail) bytes() []byte {
	cd := make([]byte, 0, 64)
	for _, n := range z.names {
		h := make([]byte, 46)
		binary.LittleEndian.PutUint32(h[0:], zipCentralHeaderSig)
		binary.LittleEndian.PutUint16(h[28:], uint16(len(n)))
		cd = append(cd, h...)
		cd = append(cd, n...)
	}
	if z.mutateCD != nil {
		z.mutateCD(cd)
	}
	eocd := make([]byte, 22)
	binary.LittleEndian.PutUint32(eocd[0:], zipEOCDSig)
	binary.LittleEndian.PutUint16(eocd[8:], uint16(len(z.names)))
	binary.LittleEndian.PutUint16(eocd[10:], uint16(len(z.names)))
	binary.LittleEndian.PutUint32(eocd[12:], uint32(len(cd)))
	binary.LittleEndian.PutUint32(eocd[16:], 0)
	binary.LittleEndian.PutUint16(eocd[20:], uint16(len(z.comment)))
	if z.mutateEOCD != nil {
		z.mutateEOCD(eocd)
	}
	out := append([]byte{}, cd...)
	if !z.dropEOCD {
		out = append(out, eocd...)
	}
	return append(out, z.comment...)
}

func (z zipTail) b64() string { return base64.StdEncoding.EncodeToString(z.bytes()) }

// TestDetectContainerTypeFromBase64Tail_DecisionData 钉死确定答案（ok=true）的两种裁决：
// 命中指纹 → 该类型 ID；确为 zip 但无指纹 → ("", true)（ok=true 表示"尾部探针已给出确定答案"，
// 空串是确定答案，不是失败——失败必须走 ok=false 交全量兜底，两者语义不可混）。
func TestDetectContainerTypeFromBase64Tail_DecisionData(t *testing.T) {
	cases := []struct {
		name string
		tail zipTail
		want string
	}{
		{"pack.mcmeta 指纹命中", zipTail{names: []string{"pack.mcmeta"}}, "resourcepack"},
		// EOCD 注释区（规范上限 65535）不得让定位失效：i+22+commentLen==len(data) 才算命中
		{"EOCD 带注释区仍定位", zipTail{names: []string{"pack.mcmeta"}, comment: []byte("hello")}, "resourcepack"},
		// 无指纹条目：确定答案为空串（不猜），但 ok 必须为 true
		{"无指纹条目 → 确定答案空串", zipTail{names: []string{"random.txt", "data.bin"}}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			id, ok := DetectContainerTypeFromBase64Tail(tc.tail.b64())
			if !ok {
				t.Fatalf("应给出确定答案 ok=true（ok=false 是「交全量兜底」的另一语义）")
			}
			if id != tc.want {
				t.Fatalf("类型判定 = %q, 期望 %q", id, tc.want)
			}
		})
	}
}

// TestDetectContainerTypeFromBase64Tail_DegradeMatrix：所有 ok=false 降级面逐条钉住。
// ok=false = 尾部探针**不能**给答案，调用方必须回退整包解码——这里任何一条被
// 误改成 ok=true（甚至误猜一个类型），都会让 50~500MB 的合法包类型判定静默走偏。
func TestDetectContainerTypeFromBase64Tail_DegradeMatrix(t *testing.T) {
	cases := []struct {
		name string
		b64  string
	}{
		{"zip64 条目数触顶 0xFFFF", (zipTail{names: []string{"pack.mcmeta"}, mutateEOCD: func(e []byte) {
			binary.LittleEndian.PutUint16(e[10:], 0xFFFF)
		}}).b64()},
		{"zip64 目录大小触顶 0xFFFFFFFF", (zipTail{names: []string{"pack.mcmeta"}, mutateEOCD: func(e []byte) {
			binary.LittleEndian.PutUint32(e[12:], 0xFFFFFFFF)
		}}).b64()},
		{"zip64 目录偏移触顶 0xFFFFFFFF", (zipTail{names: []string{"pack.mcmeta"}, mutateEOCD: func(e []byte) {
			binary.LittleEndian.PutUint32(e[16:], 0xFFFFFFFF)
		}}).b64()},
		{"中央目录超出尾部窗口", (zipTail{names: []string{"pack.mcmeta"}, mutateEOCD: func(e []byte) {
			binary.LittleEndian.PutUint32(e[16:], 0x1000)
		}}).b64()},
		{"EOCD 缺失（尾部截断）", (zipTail{names: []string{"pack.mcmeta"}, dropEOCD: true}).b64()},
		{"中央目录签名错位", (zipTail{names: []string{"pack.mcmeta"}, mutateCD: func(cd []byte) {
			binary.LittleEndian.PutUint32(cd[0:], 0xDEADBEEF)
		}}).b64()},
		{"条目名长度越界", (zipTail{names: []string{"pack.mcmeta"}, mutateCD: func(cd []byte) {
			binary.LittleEndian.PutUint16(cd[28:], 0xFFF0)
		}}).b64()},
		{"条目数声明 2 实有 1", (zipTail{names: []string{"pack.mcmeta"}, mutateEOCD: func(e []byte) {
			binary.LittleEndian.PutUint16(e[8:], 2)
			binary.LittleEndian.PutUint16(e[10:], 2)
		}}).b64()},
		{"base64 填充超 2（A===，先被长度<8 拦下）", "A==="},
		{"base64 填充超 2（长度够，走 pad 判据）", "AAAAAAAAA==="},
		{"base64 长度不足 8", "AAAA"},
		{"base64 长度非 4 倍数", "abc"},
		{"base64 非法字符", "!!!!not-base64!"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if id, ok := DetectContainerTypeFromBase64Tail(tc.b64); ok {
				t.Fatalf("应降级 ok=false 交全量兜底, got (%q, true)", id)
			}
		})
	}
}
