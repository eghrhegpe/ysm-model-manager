// 临时理论推断：上游 calculateBoneMatrix vs 我们 BoneData 的矩阵布局映射。
// 用法: node tests/theory-matrix-layout.mjs
// 目的: 确认 ADR-042 四项（scale/隐藏联动/glow/世界坐标回填）的改动范围。

// ===== 上游公式（NativeModelRenderer.java:177-249 提炼）=====
//
// 每骨骼 12 个 float 的 boneParams[]：
//   [0..2]  animRx/Ry/Rz   动画旋转（弧度）
//   [3..5]  animTx/Ty/Tz   动画平移（模型空间，1/16 缩放前）
//   [6..8]  animSx/Sy/Sz   动画缩放
//   [9..11] unk1/unk2/unk3 状态标记
//
// calculateBoneMatrix(idx) 公式：
//   parentMatrix = (bone.parentIdx != -1) ? calculateBoneMatrix(parentIdx) : rootPose
//   localMat = parentMatrix.copy()
//   localMat.translate(
//     (bone.pivotX - animTx) * 0.0625,    // X 轴：pivot 减 animT
//     (bone.pivotY + animTy) * 0.0625,    // Y 轴：pivot 加 animT（符号相反）
//     (bone.pivotZ + animTz) * 0.0625     // Z 轴：pivot 加 animT
//   )
//   localMat.rotateZ(animRz)
//   localMat.rotateY(animRy)
//   localMat.rotateX(animRx)
//   if (animSx != 1 || animSy != 1 || animSz != 1):
//     localMat.scale(animSx, animSy, animSz)
//   // 世界坐标回填（unk3 == 1 时）
//   if (unk3 == 1.0 && stateBuffer != null && isVisible):
//     stateBuffer[idx*4 + 0] = -localMat.m30() * 16
//     stateBuffer[idx*4 + 1] =  localMat.m31() * 16
//     stateBuffer[idx*4 + 2] =  localMat.m32() * 16
//   localMat.translate(-bone.pivotX/16, -bone.pivotY/16, -bone.pivotZ/16)
//
// 可见性判定（calculateBoneMatrix 内）：
//   if (animSx == 0 && animSy == 0 && animSz == 0): isVisible = false
//   if (parentIdx != -1 && !visibleCache[parentIdx]): isVisible = false  // 父隐子隐

// ===== 我们的 BoneData 布局（go/threejs/spec.go:35-42）=====
//
// type BoneData struct {
//   ID            string     // 骨骼名
//   Name          string     // 同上
//   ParentID      *string    // 父骨骼名（nil = 根骨骼）
//   LocalPosition [3]float64 // 本地位置（相对父 pivot）
//   LocalRotation [4]float64 // 四元数 [x,y,z,w]
//   CubeCount     int        // 挂载立方体数
// }
//
// buildBoneLocalData 公式（spec-bones.go:46-62）：
//   if hasParent:
//     localPos = [pp.x - bp.x, bp.y - pp.y, bp.z - pp.z]  // 相对父 pivot
//   else:
//     localPos = [-bp.x, bp.y, bp.z]  // 根骨骼：取反 X
//   if hasRotation:
//     localRot = eulerToQuaternion(-b.Rotation[0], -b.Rotation[1], b.Rotation[2])

// ===== 映射推断 =====

const findings = [];

// Finding 1: scale 是动画驱动，不是静态骨骼属性
findings.push({
  id: "SCALE_ANIM_DRIVEN",
  severity: "INFO",
  title: "scale 是动画驱动，BoneData 无需加 Scale 字段",
  upstream: "animSx/Sy/Sz 来自 boneParams[idx*12+6..8]，由动画每帧写入",
  ours: "BoneData 无 Scale 字段；前端动画系统应直接写 THREE.Bone.scale",
  conclusion: "ADR-042 'scale 未建模' 指的是**动画管线**未传递 scale，不是 BoneData 缺字段",
  action: "在前端动画求值器（molang → bone transform）里补 scale 通道",
});

// Finding 2: 隐藏联动是运行时状态，不是骨骼属性
findings.push({
  id: "HIDDEN_RUNTIME_STATE",
  severity: "INFO",
  title: "隐藏联动是运行时状态，matrixData[9..10] 每帧更新",
  upstream: "setHidden(selfHidden, skipChildRendering) 写 matrixData[9] 和 [10]",
  ours: "BoneData 无 Hidden/HideChildren 字段",
  conclusion: "隐藏联动应在**前端动画系统**里实现：parent.hidden → children.hidden",
  action: "在 setBoneVisible(boneName, visible) 里递归设置子骨骼 visible",
});

// Finding 3: glow 是骨骼名前缀判定，不是材质通道
findings.push({
  id: "GLOW_NAME_PREFIX",
  severity: "INFO",
  title: "glow 基于骨骼名前缀 'ysmGlow'，不是材质属性",
  upstream: "GeoBone.glow = name.startsWith(GLOWING_PREFIX); NativeModelRenderer:152 用 LightTexture.pack(15,15)",
  ours: "BoneData 无 Glow 字段；前端 THREE.MeshStandardMaterial 无 emissive 通道",
  conclusion: "glow 需要在**骨骼名解析**时识别前缀，渲染时设 emissive/emissiveIntensity",
  action: "在 buildBoneLocalData 里检测 'ysmGlow' 前缀，BoneData 加 Glow bool 字段",
});

// Finding 4: 世界坐标回填是 GPU 渲染内部，molang 不需要
findings.push({
  id: "WORLD_COORD_GPU_INTERNAL",
  severity: "INFO",
  title: "世界坐标回填（unk3==1）是渲染内部用，molang 不消费",
  upstream: "stateBuffer[idx*4+0..2] = -localMat.m30()*16, localMat.m31()*16, localMat.m32()*16",
  ours: "BoneData 无 PIVOT_ABS 字段",
  conclusion: "世界坐标回填只在**上游 GPU 渲染路径**里用，我们用 Three.js CPU 渲染不需要",
  action: "无需实现；如果 molang 确实需要读绝对位置，用 THREE.Bone.getWorldPosition()",
});

// Finding 5: Y 轴符号差异（关键！）
findings.push({
  id: "Y_AXIS_SIGN_MISMATCH",
  severity: "WARN",
  title: "上游 translate 用 (pivotX - animTx, pivotY + animTy, pivotZ + animTz)，Y 轴符号相反",
  upstream: "localMat.translate((bone.pivotX - animTx) * 0.0625, (bone.pivotY + animTy) * 0.0625, ...)",
  ours: "buildBoneLocalData 用 [pp.x - bp.x, bp.y - pp.y, bp.z - pp.z]，Y 轴取反",
  conclusion: "我们的 Y 轴取反是为了 Bedrock → Three.js 坐标系转换；上游 Y 轴加号是因为 Bedrock Y 向上",
  action: "无需改；坐标转换已在 buildBoneLocalData 里正确处理",
});

// Finding 6: 0.0625 = 1/16 缩放因子
findings.push({
  id: "ONE_OVER_16_SCALE",
  severity: "INFO",
  title: "上游用 0.0625 (=1/16) 把 Bedrock 像素坐标缩放到模型空间",
  upstream: "localMat.translate((bone.pivotX - animTx) * 0.0625, ...)",
  ours: "我们的 LocalPosition 直接用 pivot 差值，不乘 1/16",
  conclusion: "Three.js 用 1 单位 = 1 像素，上游用 1/16 单位 = 1 像素；两者等价但缩放基准不同",
  action: "无需改；前端在 Three.js Scene 里设 camera/zoom 适配",
});

// ===== 输出推断结果 =====

console.log("===== 矩阵布局理论推断 =====\n");

for (const f of findings) {
  const icon = f.severity === "WARN" ? "⚠️" : f.severity === "ERROR" ? "❌" : "✅";
  console.log(`${icon} [${f.id}] ${f.title}`);
  console.log(`  上游: ${f.upstream}`);
  console.log(`  我们: ${f.ours}`);
  console.log(`  结论: ${f.conclusion}`);
  console.log(`  动作: ${f.action}`);
  console.log();
}

// ===== 汇总：ADR-042 四项的改动范围 =====

console.log("===== ADR-042 四项改动范围汇总 =====\n");

const actions = [
  {
    item: "scale 未建模",
    layer: "前端动画系统",
    files: ["frontend/src/features/preview-3d/animation/*.ts (推测)", "molang 求值器"],
    effort: "中",
    risk: "中",
    detail: "在 molang → bone transform 求值时，补 bone.scale = [sX, sY, sZ] 通道。上游 animSx/Sy/Sz 来自 boneParams[6..8]，我们需在动画解析时识别 scale 关键帧。",
  },
  {
    item: "隐藏联动未建模",
    layer: "前端动画系统 + UI",
    files: ["setBoneVisible 调用链", "骨骼可见性 UI"],
    effort: "低",
    risk: "低",
    detail: "在 setBoneVisible(boneName, visible) 里递归设置子骨骼 visible。上游用 matrixData[9..10] 双标记（selfHidden + hideChildren），我们用 THREE.Bone.visible 递归即可。",
  },
  {
    item: "glow 未建模",
    layer: "Go 骨骼解析 + 前端材质",
    files: ["go/threejs/spec-bones.go (buildBoneLocalData)", "BoneData 加 Glow 字段", "前端材质设 emissive"],
    effort: "低",
    risk: "低",
    detail: "在 buildBoneLocalData 里检测 'ysmGlow' 前缀，BoneData 加 Glow bool。前端渲染时对 Glow=true 的骨骼设 emissive/emissiveIntensity。",
  },
  {
    item: "世界坐标回填未建模",
    layer: "无需实现",
    files: [],
    effort: "无",
    risk: "无",
    detail: "上游 unk3==1 时把 localMat.m30/m31/m32 写入 stateBuffer，这是 GPU 渲染内部用。我们用 Three.js CPU 渲染，THREE.Bone.getWorldPosition() 可替代。如果 molang 不需要读绝对位置，此项可跳过。",
  },
];

for (const a of actions) {
  console.log(`【${a.item}】`);
  console.log(`  层次: ${a.layer}`);
  console.log(`  文件: ${a.files.join(", ") || "(无)"}`);
  console.log(`  工作量: ${a.effort} | 风险: ${a.risk}`);
  console.log(`  详情: ${a.detail}`);
  console.log();
}

// ===== 结论：是否值得继续设计？=====

console.log("===== 是否值得继续设计？=====\n");
console.log("结论：值得继续，但分两批落地。");
console.log();
console.log("第一批（低风险，可立即设计 ADR）：");
console.log("  - glow：Go 骨骼解析加前缀检测 + BoneData.Glow 字段 + 前端 emissive 材质");
console.log("  - 隐藏联动：前端 setBoneVisible 递归子骨骼");
console.log();
console.log("第二批（中风险，需核对动画管线后设计）：");
console.log("  - scale：前端动画求值器补 scale 通道，需核对 molang bone_scale 函数");
console.log("  - 世界坐标回填：暂不实现，等 molang 求值器确认是否需要读绝对位置");
console.log();
console.log("推断完成。临时文件可在设计定稿后删除。");
