package threejs

import (
	"log"
	"strings"

	"ysm-model-manager/go/types"
)

// ===== 骨骼相关纯函数 =====

// glowingPrefix 发光骨骼名前缀（对齐上游 GeoBone.GLOWING_PREFIX = "ysmGlow"）。
// 上游 GeoBone.glow = name.startsWith("ysmGlow")；NativeModelRenderer:152 用
// LightTexture.pack(15,15) 渲染发光骨骼。我们在此检测前缀，前端据 BoneData.Glow
// 设 emissive/emissiveIntensity。
const glowingPrefix = "ysmglow"

// isGlowBone 判定骨骼名是否为发光骨骼（前缀 "ysmGlow"，大小写不敏感）。
// 上游用区分大小写的 startsWith；实际模型文件均用小写 "ysmGlow" 前缀
// （如 ysmGlowFrontHeadlights），故 ToLower 后比较更宽松、不背离上游语义。
func isGlowBone(name string) bool {
	return strings.HasPrefix(strings.ToLower(name), glowingPrefix)
}

// bonePivotInfo 骨骼 pivot 预收集结果（与 overwrite 决策一致）
type bonePivotInfo struct {
	pivot     vec3
	hasParent bool
	hasRot    bool
}

// collectBonePivots 预收集所有骨骼的 pivot，按 overwrite 规则决定保留哪个。
// overwrite 规则：首次出现保留；后续同名骨骼仅在「无 parent→有 parent」或
// 「同有 parent 且无旋转→有旋转」时覆盖——与 buildModelGroup 主循环完全一致
// （bug-chronicle #14 防线）。
func collectBonePivots(model types.BedrockModel) (pivots map[string]vec3, first map[string]bonePivotInfo) {
	first = make(map[string]bonePivotInfo)
	pivots = make(map[string]vec3, len(model.Bones))
	for _, b := range model.Bones {
		np := vec3{b.Pivot[0], b.Pivot[1], b.Pivot[2]}
		fi, exists := first[b.Name]
		if !exists {
			first[b.Name] = bonePivotInfo{np, b.Parent != "", hasBoneRotation(b.Rotation)}
			pivots[b.Name] = np
			continue
		}
		newHasParent := b.Parent != ""
		newHasRot := hasBoneRotation(b.Rotation)
		overwrite := (!fi.hasParent && newHasParent) ||
			(fi.hasParent && newHasParent && !fi.hasRot && newHasRot)
		if overwrite {
			pivots[b.Name] = np
			first[b.Name] = bonePivotInfo{np, newHasParent, newHasRot}
		}
	}
	return pivots, first
}

// buildBoneLocalData 计算单条骨骼的本地位置和旋转
func buildBoneLocalData(b types.Bone2D, bp vec3, pivots map[string]vec3) (localPos [3]float64, localRot [4]float64, parentID *string) {
	localRot = [4]float64{0, 0, 0, 1}
	if hasBoneRotation(b.Rotation) {
		localRot = eulerToQuaternion(-b.Rotation[0], -b.Rotation[1], b.Rotation[2])
	}
	if b.Parent != "" {
		parentID = &b.Parent
		if pp, ok := pivots[b.Parent]; ok {
			localPos = [3]float64{pp.x - bp.x, bp.y - pp.y, bp.z - pp.z}
		} else {
			localPos = [3]float64{-bp.x, bp.y, bp.z}
		}
	} else {
		localPos = [3]float64{-bp.x, bp.y, bp.z}
	}
	return localPos, localRot, parentID
}

// assembleBones 第一遍：遍历 model.Bones，构建 bones[] + boneIdx + boneCubes。
// 同名骨骼去重规则与 collectBonePivots 完全一致（bug-chronicle #14 防线）。
func assembleBones(model types.BedrockModel, pivots map[string]vec3) (bones []BoneData, boneIdx map[string]int, boneCubes map[string][]types.Cube2D) {
	boneIdx = make(map[string]int)
	boneCubes = make(map[string][]types.Cube2D)
	for _, b := range model.Bones {
		bp := pivots[b.Name]
		localPos, localRot, parentID := buildBoneLocalData(b, bp, pivots)

		if idx, exists := boneIdx[b.Name]; exists {
			existingHasParent := bones[idx].ParentID != nil
			newHasParent := b.Parent != ""
			existingHasRot := !isIdentityQuat(bones[idx].LocalRotation)
			newHasRot := !isIdentityQuat(localRot)
			overwrite := (!existingHasParent && newHasParent) ||
				(existingHasParent && newHasParent && !existingHasRot && newHasRot)
			if overwrite {
				bones[idx].ParentID = parentID
				bones[idx].LocalPosition = localPos
				bones[idx].LocalRotation = localRot
				boneCubes[b.Name] = append([]types.Cube2D{}, b.Cubes...)
			} else {
				boneCubes[b.Name] = mergeCubes(boneCubes[b.Name], b.Cubes)
			}
		} else {
			boneIdx[b.Name] = len(bones)
			bones = append(bones, BoneData{
				ID:            b.Name,
				Name:          b.Name,
				ParentID:      parentID,
				LocalPosition: localPos,
				LocalRotation: localRot,
				Glow:          isGlowBone(b.Name),
			})
			boneCubes[b.Name] = append([]types.Cube2D{}, b.Cubes...)
		}
	}
	return bones, boneIdx, boneCubes
}

// buildBoneByNameIndex 构建 boneByName 反查表（model.Bones 原始索引），
// 供 fillMissingBones / repairBrokenParentChain 使用。
func buildBoneByNameIndex(model types.BedrockModel) map[string]int {
	boneByName := make(map[string]int, len(model.Bones))
	for i, b := range model.Bones {
		boneByName[b.Name] = i
	}
	return boneByName
}

// assembleMeshes 第二遍：将合并后的 cube 转为 mesh 数据。
// 注意：即使骨骼没有 cube，也要保留在 bones 列表中（它是子骨骼的父节点）。
func assembleMeshes(bones []BoneData, boneIdx map[string]int, boneCubes map[string][]types.Cube2D, pivots map[string]vec3, model types.BedrockModel, texW, texH float64) ([]MeshData, []BoneData) {
	var meshes []MeshData
	boneDone := make(map[string]bool)
	for _, b := range model.Bones {
		if _, exists := boneIdx[b.Name]; !exists {
			continue
		}
		if boneDone[b.Name] {
			continue
		}
		boneDone[b.Name] = true

		bonePivot, hasPivot := pivots[b.Name]
		if !hasPivot {
			bonePivot = vec3{b.Pivot[0], b.Pivot[1], b.Pivot[2]}
		}
		if idx, ok := boneIdx[b.Name]; ok {
			bones[idx].CubeCount = len(boneCubes[b.Name])
		}
		for ci, c := range boneCubes[b.Name] {
			meshData := buildCubeMeshData(c, bonePivot, texW, texH, b.Name, ci)
			if meshData != nil {
				meshes = append(meshes, *meshData)
			}
		}
	}
	return meshes, bones
}

// fillMissingBones 补充缺失骨骼（包括纯 parent 引用、无 cube 的中间骨骼）。
func fillMissingBones(bones []BoneData, boneIdx map[string]int, pivots map[string]vec3, boneByName map[string]int, model types.BedrockModel) []BoneData {
	allBoneNames := make(map[string]bool)
	for _, b := range model.Bones {
		allBoneNames[b.Name] = true
		if b.Parent != "" {
			allBoneNames[b.Parent] = true
		}
	}
	for name := range allBoneNames {
		if _, exists := boneIdx[name]; !exists {
			bp, hasPivot := pivots[name]
			var parentName string
			var localPos [3]float64
			found := false
			if idx, ok := boneByName[name]; ok {
				b := model.Bones[idx]
				found = true
				parentName = b.Parent
				if b.Parent != "" {
					if pp, ok := pivots[b.Parent]; ok {
						localPos = [3]float64{pp.x - bp.x, bp.y - pp.y, bp.z - pp.z}
					} else {
						parentName = ""
						localPos = [3]float64{-bp.x, bp.y, bp.z}
					}
				} else {
					localPos = [3]float64{-bp.x, bp.y, bp.z}
				}
			}
			if !found {
				if !hasPivot {
					log.Printf("[spec] ⚠️ 骨骼 %q 无 pivot（纯 parent 引用）", name)
				}
				localPos = [3]float64{-bp.x, bp.y, bp.z}
				parentName = ""
			}
			var parentID *string
			if parentName != "" {
				parentID = &parentName
			}
			boneIdx[name] = len(bones)
			bones = append(bones, BoneData{
				ID:            name,
				Name:          name,
				ParentID:      parentID,
				LocalPosition: localPos,
				LocalRotation: [4]float64{0, 0, 0, 1},
				Glow:          isGlowBone(name),
			})
		}
	}
	return bones
}

// repairBrokenParentChain 后处理：修复断裂的父子链。
func repairBrokenParentChain(bones []BoneData, pivots map[string]vec3, boneByName map[string]int, model types.BedrockModel) []BoneData {
	boneNameSet := make(map[string]bool)
	for _, b := range bones {
		boneNameSet[b.Name] = true
	}
	for i := range bones {
		if bones[i].ParentID == nil {
			continue
		}
		ancestor := *bones[i].ParentID
		visited := map[string]bool{bones[i].Name: true}
		for {
			_, ancHasPivot := pivots[ancestor]
			if boneNameSet[ancestor] && ancHasPivot {
				break
			}
			found := false
			if idx, ok := boneByName[ancestor]; ok {
				b := model.Bones[idx]
				if b.Parent != "" && !visited[b.Parent] {
					ancestor = b.Parent
					visited[ancestor] = true
					found = true
				}
			}
			if !found {
				ancestor = ""
				break
			}
		}

		bp, hasBp := pivots[bones[i].Name]
		if !hasBp {
			// code_review P2-4：缺 pivot 时保留原 LocalPosition，不重写为塌到原点
			log.Printf("[threejs] repairBrokenParentChain: bone %s 无 pivot，保留原 LocalPosition", bones[i].Name)
			continue
		}
		if ancestor != "" {
			ancPivot, hasAnc := pivots[ancestor]
			if !hasAnc {
				log.Printf("[threejs] repairBrokenParentChain: ancestor %s 无 pivot，保留原 LocalPosition", ancestor)
				continue
			}
			bones[i].ParentID = &ancestor
			bones[i].LocalPosition = [3]float64{ancPivot.x - bp.x, bp.y - ancPivot.y, bp.z - ancPivot.z}
		} else {
			bones[i].ParentID = nil
			bones[i].LocalPosition = [3]float64{-bp.x, bp.y, bp.z}
		}
	}
	return bones
}

// attachArms 后处理：将 RightArm/LeftArm 挂到 Arm 下面（YSMParser 解码 .ysm 后丢失的层级）。
func attachArms(bones []BoneData, pivots map[string]vec3) []BoneData {
	for i := range bones {
		if bones[i].Name == "RightArm" && bones[i].ParentID == nil {
			for j := range bones {
				if bones[j].Name == "Arm" && bones[j].ParentID != nil {
					raPivot, hasRA := pivots["RightArm"]
					armPivot, hasArm := pivots["Arm"]
					if !hasRA || !hasArm {
						log.Printf("[threejs] attachArms: RightArm/Arm 缺 pivot (RA=%v Arm=%v)，跳过", hasRA, hasArm)
						break
					}
					bones[i].ParentID = &bones[j].Name
					bones[i].LocalPosition = [3]float64{armPivot.x - raPivot.x, raPivot.y - armPivot.y, raPivot.z - armPivot.z}
					break
				}
			}
		}
		if bones[i].Name == "LeftArm" && bones[i].ParentID == nil {
			for j := range bones {
				if bones[j].Name == "Arm" && bones[j].ParentID != nil {
					laPivot, hasLA := pivots["LeftArm"]
					armPivot, hasArm := pivots["Arm"]
					if !hasLA || !hasArm {
						log.Printf("[threejs] attachArms: LeftArm/Arm 缺 pivot (LA=%v Arm=%v)，跳过", hasLA, hasArm)
						break
					}
					bones[i].ParentID = &bones[j].Name
					bones[i].LocalPosition = [3]float64{armPivot.x - laPivot.x, laPivot.y - armPivot.y, laPivot.z - armPivot.z}
					break
				}
			}
		}
	}
	return bones
}
