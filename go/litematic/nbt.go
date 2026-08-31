// Package litematic Litematica 投影文件 (.litematic) 的解析和预览数据构建。
package litematic

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"math"

	"github.com/Tnze/go-mc/nbt"
)

// maxDecodedBytes 解压后 NBT 解码上限（zip-bomb 防线，对齐 go/geometry maxParseSize 100MB）
const maxDecodedBytes = 100 << 20

// maxNbtDepth NBT 嵌套深度上限（合法 litematic 通常 < 10）。go-mc/nbt 对 compound/list
// 无限递归无深度限制——深层嵌套（~1e5 层）触发 Go runtime 栈溢出是 fatal error，
// recover 不可救、进程直接崩溃，必须在解码前用轻量扫描预检（P1 修复）。
const maxNbtDepth = 256

// readRootCompound 用 go-mc/nbt 解码根 Compound，返回 map[string]any。
// go-mc/nbt v1.20.2 对负长度 LongArray/IntArray 无守卫
// （decode.go:252-296 直接 reflect.MakeSlice(len<0) → panic「len out of range」），
// litematic 的 BlockStates 正是 TAG_Long_Array，畸形/截断文件（4 字节长度读成负数）
// 可击穿 ParseMeta/BuildVoxelData 等全部入口——defer recover 转 error 防进程崩溃；
// 同时用 LimitReader 限制解压物化大小（zip-bomb 防线），并预检嵌套深度防栈溢出。
func readRootCompound(r io.Reader) (root map[string]any, err error) {
	defer func() {
		if r := recover(); r != nil {
			root = nil
			err = fmt.Errorf("nbt decode panic（畸形 NBT）: %v", r)
		}
	}()
	// 先整体读入受限字节流（+1 探测超限），供深度预检 + 解码共用
	data, rerr := io.ReadAll(io.LimitReader(r, maxDecodedBytes+1))
	if rerr != nil {
		return nil, fmt.Errorf("nbt read: %w", rerr)
	}
	if len(data) > maxDecodedBytes {
		return nil, fmt.Errorf("nbt 数据超过 %d 字节上限", maxDecodedBytes)
	}
	// P1：嵌套深度预检——go-mc 递归无上限，深层嵌套栈溢出为 fatal（recover 不可救）
	depth, ok := probeNbtDepth(data)
	if !ok {
		// probe 返回 ok=false（畸形/截断/超长长度声明）时
		// 直接拒绝——原实现 depth==0 一律放行给 go-mc，而 go-mc 对 list/intArray/
		// longArray 是「先按 int32 长度物化切片、后逐个读元素」，恶意文件声明长度
		// 2^31-1 并截断元素数据 → make([]any, 2^31-1) ≈ 16-32GB → runtime OOM fatal
		// （fatal 非 panic，recover 不可救），整个桌面进程崩溃
		return nil, fmt.Errorf("nbt 结构异常（畸形/截断/超长声明长度）")
	}
	if depth > maxNbtDepth {
		return nil, fmt.Errorf("nbt 嵌套深度 %d 超过上限 %d", depth, maxNbtDepth)
	}
	if _, derr := nbt.NewDecoder(bytes.NewReader(data)).Decode(&root); derr != nil {
		return nil, fmt.Errorf("nbt decode: %w", derr)
	}
	return root, nil
}

// probeNbtDepth 轻量 NBT 结构扫描：只推进 offset 不物化数据，返回最大嵌套深度。
// 返回 (depth, ok)：ok=false 表示畸形/截断/超长长度声明（调用方应直接拒绝，
// 不得放行给 go-mc——见 readRootCompound 的 OOM 防线注释）。
func probeNbtDepth(data []byte) (int, bool) {
	off := 0
	maxDepth := 0
	read := func(n int) bool {
		if n < 0 || off+n > len(data) || off+n < off {
			return false
		}
		off += n
		return true
	}
	// P2-4：物化体积预算——累计 list 元素数与字符串长度，超限判畸形
	// （防 100MB 输入物化数 GB 内存触发 runtime OOM）
	const maxDecodeBudget = 512 << 20 // 估计物化体积上限 512MB
	used := 0
	charge := func(n int) bool {
		if n < 0 || used+n > maxDecodeBudget || used+n < used {
			return false
		}
		used += n
		return true
	}
	// 跳过 tag 名字（2 字节长度 + 内容）
	skipName := func() bool {
		if !read(2) {
			return false
		}
		n := int(binary.BigEndian.Uint16(data[off-2:]))
		return read(n)
	}
	// walkPayload 解析一个 tag 的 payload（无名字；list 元素与 compound 子 payload 共用）
	var walkPayload func(tagType byte, depth int) bool
	walkPayload = func(tagType byte, depth int) bool {
		if depth > maxDepth {
			maxDepth = depth
		}
		if depth > maxNbtDepth {
			return false // 超深：中断扫描（最终由 readRootCompound 报错）
		}
		switch tagType {
		case 1: // byte
			return read(1)
		case 2: // short
			return read(2)
		case 3: // int
			return read(4)
		case 4: // long
			return read(8)
		case 5: // float
			return read(4)
		case 6: // double
			return read(8)
		case 7: // byteArray: int32 长度 + N
			if !read(4) {
				return false
			}
			n := int(int32(binary.BigEndian.Uint32(data[off-4:])))
			// 声明长度超过剩余数据直接判畸形（防 go-mc 按 2^31-1 物化 OOM）
			if n < 0 || n > len(data) {
				return false
			}
			// P3-1：byteArray 也计入物化预算（n 字节）
			if !charge(n) {
				return false
			}
			return read(n)
		case 8: // string: uint16 长度 + N
			if !read(2) {
				return false
			}
			n := int(binary.BigEndian.Uint16(data[off-2:]))
			if !charge(n) {
				return false
			}
			return read(n)
		case 9: // list: 元素类型 + int32 长度 + N × payload（元素无名字）
			if !read(1) {
				return false
			}
			elemType := data[off-1]
			if !read(4) {
				return false
			}
			n := int(int32(binary.BigEndian.Uint32(data[off-4:])))
			// 声明长度超过剩余数据直接判畸形（防 go-mc 物化超大 slice OOM）
			if n < 0 || n > len(data) {
				return false
			}
			// P2-4：物化体积预算——每个 list 元素按 16 字节估算
			if !charge(n * 16) {
				return false
			}
			for i := 0; i < n; i++ {
				if !walkPayload(elemType, depth+1) {
					return false
				}
			}
			return true
		case 10: // compound: 循环 { 子类型 + 名字 + payload } 直到 end(0)
			for {
				if !read(1) {
					return false
				}
				childType := data[off-1]
				if childType == 0 {
					return true
				}
				if !read(2) {
					return false
				}
				nameLen := int(binary.BigEndian.Uint16(data[off-2:]))
				// P2：物化体积预算——compound 键名同样计入（list 分支已按元素计费，
				// compound 分支漏掉键名，畸形文件可借海量长键名绕过 512MB 预算）。
				// 值物化估计：键长 + 每键 16 字节映射槽开销（与 list 元素 16B 口径一致）
				if !charge(nameLen + 16) {
					return false
				}
				if !read(nameLen) {
					return false
				}
				if !walkPayload(childType, depth+1) {
					return false
				}
			}
		case 11: // intArray: int32 长度 + 4N
			if !read(4) {
				return false
			}
			n := int(int32(binary.BigEndian.Uint32(data[off-4:])))
			// 防乘法溢出——原 `read(4*n)` 在 n=2^30 时 4*n 溢出为 0 绕过长度检查，
			// go-mc 按 2^30 物化 4GB slice → OOM；显式按剩余数据约束
			if n < 0 || n > len(data)/4 {
				return false
			}
			// P2-1：intArray 物化为 4*n 字节，计入预算防 OOM
			if !charge(4 * n) {
				return false
			}
			return read(4 * n)
		case 12: // longArray: int32 长度 + 8N
			if !read(4) {
				return false
			}
			n := int(int32(binary.BigEndian.Uint32(data[off-4:])))
			// 同 intArray，防乘法溢出与超大物化 OOM
			if n < 0 || n > len(data)/8 {
				return false
			}
			// P2-1：longArray 物化为 8*n 字节，计入预算防 OOM
			if !charge(8 * n) {
				return false
			}
			return read(8 * n)
		default:
			return false // P4-1：未知 tag 类型：畸形，调用方拒绝
		}
	}
	// 根 tag：1 字节类型 + 名字（2 字节长度 + 内容），与 go-mc Decode 读根名字的语义一致
	if !read(1) {
		return 0, false
	}
	rootType := data[off-1]
	if rootType == 0 {
		return 0, false
	}
	if !skipName() {
		return 0, false
	}
	if !walkPayload(rootType, 0) {
		// 超深中断时返回实际深度哨兵（maxDepth 已在 walkPayload
		// 开头记录），而非 0——0 与「畸形输入」同值，readRootCompound 的
		// `depth > maxNbtDepth` 检查会被放行，深嵌套文件静默穿透解码（栈溢出风险）
		if maxDepth > maxNbtDepth {
			return maxDepth, true
		}
		return 0, false // 畸形：调用方拒绝
	}
	return maxDepth, true
}

func getCompound(m map[string]any, key string) map[string]any {
	if v, ok := m[key]; ok {
		if c, ok := v.(map[string]any); ok {
			return c
		}
	}
	return nil
}

func getInt(m map[string]any, key string) (int, bool) {
	v, ok := m[key]
	if !ok {
		return 0, false
	}
	switch v := v.(type) {
	case int32:
		return int(v), true
	case int16:
		return int(v), true
	case int8:
		return int(v), true
	case uint8:
		return int(v), true
	}
	return 0, false
}

func getLong(m map[string]any, key string) (int64, bool) {
	if v, ok := m[key]; ok {
		if v, ok := v.(int64); ok {
			return v, true
		}
	}
	return 0, false
}

func getString(m map[string]any, key string) (string, bool) {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s, true
		}
	}
	return "", false
}

func getByteArray(m map[string]any, key string) ([]byte, bool) {
	if v, ok := m[key]; ok {
		if b, ok := v.([]byte); ok {
			return b, true
		}
	}
	return nil, false
}

func getLongArray(m map[string]any, key string) ([]int64, bool) {
	if v, ok := m[key]; ok {
		if a, ok := v.([]int64); ok {
			return a, true
		}
	}
	return nil, false
}

// toAnySlice 将 NBT 还原的整型切片([]int32/[]int64) 统一转为 []any，供 getList 下游类型断言消费。
func toAnySlice[T int32 | int64](v []T) []any {
	out := make([]any, len(v))
	for i, e := range v {
		out[i] = e
	}
	return out
}

func getList(m map[string]any, key string) []any {
	if v, ok := m[key]; ok {
		if list, ok := v.([]any); ok {
			return list
		}
		// NBT List-of-Int 还原为 []int32 / []int64（如 structure 的 size），
		// 统一转 []any——否则 getList 取不到、size 提取长期失效（R28 P3-2 守卫随之不可达）。
		if list, ok := v.([]int32); ok {
			return toAnySlice(list)
		}
		if list, ok := v.([]int64); ok {
			return toAnySlice(list)
		}
	}
	return nil
}

func getAny(m map[string]any, key string) any {
	return m[key]
}

// Litematica 使用小端位序将方块索引打包到 LongArray：
// 索引从每个 long 的 LSB 开始连续排列，可跨越 64 位边界。
// 这与 Minecraft 1.16+ 原版 packed array 的大端位序不同——搞反会导致 3D 预览全乱。
func extractBits(longs []int64, bitOffset, bitCount int) int {
	if bitCount == 0 {
		return 0
	}
	longIdx := bitOffset / 64
	bitPos := bitOffset % 64
	mask := (uint64(1) << bitCount) - 1

	// 损坏/截断文件可能导致 longs 长度不足，越界读会 panic（P1 修复）。
	if longIdx >= len(longs) {
		return 0
	}

	if bitPos+bitCount <= 64 {
		return int((uint64(longs[longIdx]) >> bitPos) & mask)
	}

	bitsFromFirst := 64 - bitPos
	bitsFromSecond := bitCount - bitsFromFirst
	low := uint64(longs[longIdx]) >> bitPos
	var high uint64
	if longIdx+1 < len(longs) {
		high = uint64(longs[longIdx+1]) & ((uint64(1) << bitsFromSecond) - 1)
	}
	return int(low | (high << bitsFromFirst))
}

func bitsPerEntry(paletteSize int) int {
	if paletteSize <= 1 {
		return 0
	}
	b := int(math.Ceil(math.Log2(float64(paletteSize))))
	if b < 2 {
		b = 2
	}
	return b
}
