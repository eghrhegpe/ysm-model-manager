// bench_model_validate.go：单模型数据校验与体积估算（原 bench_single.go 拆分，2026-10 文件行数治理）。
// 纯函数：validateModelData / prepareGeometryData / prepareTextureData——只依赖 types.BedrockModel，
// 无 CLI / AppService 依赖，可独立单测。
package cli

import (
	"fmt"
	"strings"

	"ysm-model-manager/go/types"
)

// validateModelData 验证模型结构一致性，返回问题数和诊断信息
func validateModelData(model types.BedrockModel) (int, string) {
	var issues int
	var msgs []string

	// 1. 骨骼数与 BoneCount 字段一致性
	if model.BoneCount > 0 && model.BoneCount != len(model.Bones) {
		issues++
		msgs = append(msgs, fmt.Sprintf("骨骼数不一致: 声明 %d vs 实际 %d", model.BoneCount, len(model.Bones)))
	}

	// 2. 立方块数一致性
	var totalCubes int
	for _, b := range model.Bones {
		totalCubes += len(b.Cubes)
	}
	if model.CubeCount > 0 && model.CubeCount != totalCubes {
		issues++
		msgs = append(msgs, fmt.Sprintf("立方块数不一致: 声明 %d vs 实际 %d", model.CubeCount, totalCubes))
	}

	// 3. 纹理数组与名称数组长度一致性
	if len(model.Textures) > 0 && len(model.TextureNames) > 0 && len(model.Textures) != len(model.TextureNames) {
		issues++
		msgs = append(msgs, fmt.Sprintf("纹理名称数(%d) 与纹理数据数(%d) 不匹配", len(model.TextureNames), len(model.Textures)))
	}

	// 4. 孤立纹理（有数据但无名称）
	for i, tex := range model.Textures {
		if tex != "" && i < len(model.TextureNames) && model.TextureNames[i] == "" {
			issues++
			msgs = append(msgs, fmt.Sprintf("纹理[%d] 有数据但无名称", i))
		}
	}

	// 5. 骨骼父子关系检查（根骨骼数量）
	var rootCount int
	for _, b := range model.Bones {
		if b.Parent == "" {
			rootCount++
		}
	}
	if len(model.Bones) > 0 && rootCount == 0 {
		issues++
		msgs = append(msgs, "无根骨骼（所有骨骼都有 parent）")
	}

	if issues == 0 {
		return 0, fmt.Sprintf("✅ 结构校验通过: %d 骨骼, %d 立方块, %d 纹理",
			len(model.Bones), totalCubes, len(model.Textures))
	}
	return issues, "⚠️ 校验发现问题: " + strings.Join(msgs, "; ")
}

// prepareGeometryData 计算几何数据实际估算大小
func prepareGeometryData(model types.BedrockModel) int64 {
	var size int64

	// 骨骼元数据: name + parent + pivot[3] + rotation[3] ≈ 96 字节/骨骼
	size += int64(len(model.Bones)) * 96

	// 立方块数据: origin[3] + size[3] + pivot[3] + uv[2] + rotation[3] + inflate + mirror + texSlot ≈ 96 字节/块
	var totalCubes int
	for _, b := range model.Bones {
		totalCubes += len(b.Cubes)
	}
	size += int64(totalCubes) * 96

	// 动画数据: JSON 字符串原始长度
	for _, anim := range model.Animations {
		size += int64(len(anim))
	}

	return size
}

// prepareTextureData 估算纹理数据大小（base64 解码后）
func prepareTextureData(model types.BedrockModel) int64 {
	var size int64

	if model.Texture != "" {
		size += int64(len(model.Texture)) * 3 / 4
	}
	for _, tex := range model.Textures {
		if tex != "" {
			size += int64(len(tex)) * 3 / 4
		}
	}

	return size
}
