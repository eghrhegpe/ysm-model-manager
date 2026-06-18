// Package litematic Litematica 投影文件 (.litematic) 的解析和预览数据构建。
package litematic

import (
	"fmt"
	"io"
	"math"

	"github.com/Tnze/go-mc/nbt"
)

// readRootCompound 用 go-mc/nbt 解码根 Compound，返回 map[string]any。
func readRootCompound(r io.Reader) (map[string]any, error) {
	var root map[string]any
	if _, err := nbt.NewDecoder(r).Decode(&root); err != nil {
		return nil, fmt.Errorf("nbt decode: %w", err)
	}
	return root, nil
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

func getList(m map[string]any, key string) []any {
	if v, ok := m[key]; ok {
		if list, ok := v.([]any); ok {
			return list
		}
	}
	return nil
}

func getCompoundKey(m map[string]any, key string) any {
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

	if bitPos+bitCount <= 64 {
		return int((uint64(longs[longIdx]) >> bitPos) & mask)
	}

	bitsFromFirst := 64 - bitPos
	bitsFromSecond := bitCount - bitsFromFirst
	low := uint64(longs[longIdx]) >> bitPos
	high := uint64(longs[longIdx+1]) & ((uint64(1) << bitsFromSecond) - 1)
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
