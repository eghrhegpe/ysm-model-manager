// ===== 骨骼名导出 =====
// 从 index.js _loadModel2D 拆分：导出骨骼名按钮
/**
 * 在容器底部添加 "📋 导出骨骼名" 按钮
 * @param {HTMLElement} container - 父容器
 * @param {object} model - BedrockModel 对象（含 boneCount, cubeCount, texWidth, texHeight, bones[]）
 * @param {string} modelPath - 模型文件路径（用于生成文件名）
 */
export function setupBoneExport(container, model, modelPath) {
  const boneRow = document.createElement("div");
  boneRow.className = "ysm-export-row";
  const boneBtn = document.createElement("button");
  boneBtn.textContent = "📋 导出骨骼名";
  boneBtn.className = "ysm-export-btn";
  const boneHint = document.createElement("span");
  boneHint.className = "ysm-hint";
  boneHint.textContent = `${model.boneCount} 骨骼`;
  boneBtn.onclick = () => {
    const lines = [];
    lines.push(`骨骼总数: ${model.boneCount}`);
    lines.push(`立方体总数: ${model.cubeCount}`);
    lines.push(`纹理: ${model.texWidth || "?"}×${model.texHeight || "?"}`);
    lines.push("─".repeat(30));
    for (const b of model.bones) {
      const cs = b.cubes || [];
      lines.push(
        `${b.name}${cs.length ? ` (${cs.length} 方)` : " (结构骨骼,无方)"}`,
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.download =
      (modelPath.split("/").pop().split("\\").pop() || "model") + "_bones.txt";
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  };
  boneRow.appendChild(boneBtn);
  boneRow.appendChild(boneHint);
  container.appendChild(boneRow);
}
