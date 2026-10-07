// extracted_find.go：解压后 YSM 目录的 geometry 查找主入口（原 extracted.go 拆分，2026-10 文件行数治理）。
// FindGeometryInExtractedYSM / isDir——在 ysm.json 所在目录按顺序（直接→回退→裸解析）
// 定位 geometry JSON 与纹理字节，返回合并后的 BedrockModel（不含纹理 base64）。
package ysm

import (
	"log"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/types"
)

func FindGeometryInExtractedYSM(ysmJsonPath string) (*types.BedrockModel, [][]byte) {
	data := readFileLimited(ysmJsonPath)
	if data == nil {
		return nil, nil
	}
	dir := filepath.Dir(ysmJsonPath)

	// 阶段 ①：parsePlayerModel 统一解析 ysm.json；消费方各自切纹理路径（复刻现状口径：
	// obj 切 '/\\'、裸字符串仅切 '/'）——两消费方口径不同，规范化留消费方
	var modelNames []string
	var modelMapOrig map[string]string
	var texOrderNames []string
	if pm := parsePlayerModel(data); pm != nil {
		modelNames = pm.names
		modelMapOrig = pm.mapOrig
		for _, d := range pm.texDecl {
			tn := d.value
			if idx := strings.LastIndex(tn, "/"); idx >= 0 {
				tn = tn[idx+1:]
			}
			if !d.isStr { // obj 风格再额外切反斜杠；裸字符串仅斜杠
				if idx := strings.LastIndex(tn, "\\"); idx >= 0 {
					tn = tn[idx+1:]
				}
			}
			texOrderNames = append(texOrderNames, strings.ToLower(tn))
		}
	}

	// 阶段 ②：构造 orderedNames。map 分支 → sortMapModelNames(排除 arm)；
	// array 分支 → 按 modelNames 声明序逐个排除 arm（保持顺序，array 分支未排序）。
	var orderedNames []string
	if modelMapOrig != nil {
		orderedNames = sortMapModelNames(modelMapOrig, true) // excludeArm: 全身合并版去手臂
	} else {
		for _, n := range modelNames {
			if !geometry.IsArmModelName(n) {
				orderedNames = append(orderedNames, n)
			}
		}
	}

	// 阶段 ③：按有序名加载模型文件 → 合并骨骼；TexSlot = 序 i，钳到 len(texOrder)-1
	var geoJSON *types.BedrockModel
	maxTexIdx := len(texOrderNames) - 1
	if maxTexIdx < 0 {
		maxTexIdx = 0
	}
	for i, mn := range orderedNames {
		candidate, ok := safeJoinModelPath(dir, mn)
		if !ok {
			continue
		}
		ti := i
		if ti > maxTexIdx {
			ti = maxTexIdx
		}
		log.Printf("[ysm] 加载模型文件 %q (texIdx=%d)", candidate, ti)
		if geoData := readFileLimited(candidate); geoData != nil {
			if gj := geometry.ParseBedrockGeometry(geoData); gj != nil {
				applyCubeTextures(gj, ti)
				if geoJSON == nil {
					geoJSON = gj
				} else {
					geoJSON.Bones = append(geoJSON.Bones, gj.Bones...)
					geoJSON.BoneCount += gj.BoneCount
					geoJSON.CubeCount += gj.CubeCount
				}
			}
		}
	}

	// 阶段 ④：4 层兜底链（ysm 自身解析 / minecraft:geometry 包装 / WalkDir / bare fallback）
	if geoJSON == nil {
		geoJSON = resolveBedrockGeometryFallback(data, ysmJsonPath, dir)
	}

	// 阶段 ⑤：纹理收集 → 声明序重排 → 读数据 → 附 TextureNames（前端列表消费）
	texFiles := collectAllTexFiles(dir)
	sortTexFilesByOrder(texFiles, texOrderNames)
	texData, texNames := readTexFilesWithNames(texFiles)
	if geoJSON != nil {
		geoJSON.TextureNames = texNames
	}

	return geoJSON, texData
}

// isDir 判断路径是否为目录
func isDir(path string) bool {
	fi, err := os.Stat(path)
	return err == nil && fi.IsDir()
}
