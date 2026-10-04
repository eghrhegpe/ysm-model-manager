# ADR-266-d1：体积光锥进截图：离屏/预览输出设置同构（toneMapping + 曝光镜像）

- **状态**：✅ 已采纳（Implemented）
- **日期**：2026-10-04
- **决策人**：Jieling（人类首席架构师，现场拍板「判效果，做掉」）、AI 代理
- **关联主 ADR**：ADR-266
- **相关**：`frontend/src/preview-3d/screenshot/screenshot-lights.ts, frontend/src/preview-3d/screenshot/screenshot-render.ts, frontend/src/preview-3d/caps/light-cone.ts, ADR-136（截图领域归位）, ADR-246（体积光简化）, ADR-290（锥体驱动源）, ADR-126 P5（截图灯光所见即所得先例）, ADR-293（总开关门 WYSIWYG 先例）`

---

## 背景（一句）

知识卡把「截图渲染不复用锥体能力、预览与截图在体积光上本就不同构」写成了稳态，但该判据从未经语义裁决——本题裁决为**「效果」而非「编辑辅助」**：卡自陈锥体是「视觉光柱本体」（与 helper 线框互为反例，后者 i18n 明言「仅编辑辅助，不随截图输出」），ADR-084 把它与三盏灯同级，且产品已有两次 WYSIWYG 收口（ADR-126 P5 截图灯光、ADR-293 总开关门「预览全黑，截图必须全黑」）。落实时核对出第二处更深的分叉：**离屏 renderer 从未设 `toneMapping`**（three 默认 `NoToneMapping`），而预览侧由 sky 写 ACES + 曝光（`effectiveToneMappingExposure`）、pp 启用时接管 `toneMapping`——光柱（shader 内含 `<tonemapping_fragment>`）若直接挂进离屏，亮度会与预览静默分叉，且模型本体早已在同一条分叉上。

## 决策（三行）

1. **锥体进截图，且复用同一实现**：`ScreenshotLights` 扩 `volumetric` 块（驱动 spot 的槽位 + 实例参数 + `VolumetricParams`），离屏经 `VolumetricCone` 建锥——同一几何/shader/材质单源，不写第二套「截图专用光柱」。
2. **同构义务从「灯光参数」升级为「输出设置」**：离屏 renderer 的 `toneMapping` + `toneMappingExposure` **一律镜像活跃预览 renderer 的现值**（读现值，不重新推导 sky/pp 属主链——推导即手抄，手抄即分叉）。该条顺带修掉模型本体「预览 ACES / 截图 NoToneMapping」的既有隐性分叉。
3. **作废知识卡内「若日后要光柱进截图……不得顺手改」的门槛**（本 ADR 即放行凭证），并把音量光 hint 回滚为纯前景提示（「光柱不随截图导出」在进截图后成为假提示）。

## 后果（一句）

截图与预览在光柱与模型亮度上同色（旧截图偏亮、缺 filmic 曲线，属本次修正的预期变化）；回退 = 撤 `volumetric` 块即可，输出设置镜像可独立保留（它是独立的正确性修复）。已知边界：预览 renderer 缺席时（无活跃会话）无「现值」可镜像，退化为离屏默认——此时也没有预览可同构，不构成新分叉。

<!-- 文件名: volumetric-cone-in-screenshot.md → 实际文件 decisions/ADR-266-d1-volumetric-cone-in-screenshot.md（ADR-320 decisions 轻量模板） -->
