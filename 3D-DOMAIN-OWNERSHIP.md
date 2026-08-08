# 3D 渲染域文件所有权（临时协作约定）

> 分支：`fix/3d-render-alignment`（渲染对齐修复，见 [ADR-041](docs/adr/ADR-041-spec-render-alignment.md)）
> 有效期：本分支存活期间。合并回 main 后本文件删除。
> 约定对象：所有并发运行的 AI/协作者。

## 状态：✅ 修复完成（2026-08-08）

五类差异全部解决，`tests/port-verification/compare.mjs` 对 upstream 模型全字段归零
（黎歌 0/1958、双月 0/5678）。独占区文件已修改完毕，可以解除只读约束，但**合并回
main 前**如其他 AI 继续改动独占区，仍可能与本分支冲突。

## 独占区（本分支修复中，其他 AI **只读不写**）

```
go/threejs/                  # spec.go 核心算法（ExportScale/旋转/0厚度/同名/UV）
go/types/bedrock.go          # BedrockModel 结构（spec.go 上游，改结构会炸编译）
go/geometry/                 # Bedrock JSON 解析（uv/inflate 字段语义）
frontend/src/utils/3d/       # model3d.ts / model2d.ts（前端渲染消费 spec）
frontend/src/app-preview/    # preview-wasm.ts 等（WASM 解码 + 3D 预览）
```

理由：以上文件的改动会直接改变**所有模型**的 spec 输出或渲染结果；双方同时改同一区域会引发语义冲突（结构变更导致编译失败、口径双向修改难以裁决）。

## 开放区（其他 AI 照常）

- `go/updater/`、`scripts/`、`docs/`、`frontend/src/views/`（app-content/app-tree 等非 3D 视图）、其余一切。

## 已确认的既有改动（本分支不碰）

- 工作区未提交：`go/updater/update.go`、`go/updater/update_test.go`、`frontend/src/views/app-content/community-data.ts`、`frontend/src/views/app-content/index.ts`、`frontend/src/views/app-tree/bus-handlers.ts` —— 属其他 AI 的工作，本分支不 add 不提交。

## 验收标准

修复完成后 `tests/port-verification/compare.mjs` 对 upstream 模型输出中：
- localRotation 真差异归零（Z 轴符号）
- 0 厚度 cube 不再被丢弃（mesh 数量一致）
- 位置/UV 差异收敛到 float 精度级（≤1e-3）
- ExportScale 口径裁决（固定 1/16 vs 前端动态 scale）后记录 ADR
