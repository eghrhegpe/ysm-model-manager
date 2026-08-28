# ADR-124：i18n 键名三段式规范

- **状态**：已采纳（Accepted）
- **被取代**：[ADR-045] 已被本 ADR 收编（"i18n 框架"层面"扁平键"的决定保留，键名结构由本 ADR 升级为三段式）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-28
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：
  - 翻译文件：`frontend/src/core/i18n/locales/{zh-CN,en,ja}.ts`
  - 翻译函数：`frontend/src/core/i18n/t.ts`
  - 一致性测试：`frontend/src/core/i18n/locales-consistency.test.ts`
  - 命名检查脚本：`scripts/i18n-key-naming.mjs`（本 ADR 新增）
  - 取代 [ADR-045]（i18n 框架）

---

## 1. 背景（Context）

ADR-045 确立"扁平化命名空间 + `.` 分隔"作为 i18n 键名约定，运行近 1 年。语言包已长到 **1195 键**（zh-CN / en / ja 三语严格同步），证明基础约定有效。

但在使用中暴露两个与"键名结构"相关的痛点（大模型/翻译人员/新成员场景）：

### 1.1 痛点 A：大模型对"高频实体"歧义敏感

以"骨骼"（bone / skeleton）为例，**全文件 18 处**含骨骼相关键：

```
advFilter.minGtMaxBones         ← 高级筛选
dialog.bones                    ← 弹窗
diagnostics.assetsBones         ← 诊断面板
preview.skeletonTab             ← 3D 预览 Tab
preview.skeletonLabel           ← 3D 预览 标签
preview.boneLabels              ← 3D 预览 导出字段
preview.exportBones             ← 3D 预览 动作按钮
preview.bones                   ← 3D 预览 区域标题
preview.bonesLabel              ← 3D 预览 区域标签
preview.boneCount               ← 3D 预览 统计
preview.bone.selectHint         ← 3D 预览 提示语
skeleton.currentBinding         ← 主应用 填充面板
skeleton.componentExclusive     ← 主应用 填充面板
skeleton.slots                  ← 主应用 填充面板
web.boneCount                   ← 网页模式
... 共 18 处
```

问题：

- 大模型收到"把 3D 预览里的'骨骼'提示语改下"，无法区分 `preview.bone.selectHint`（要改的）vs `preview.skeletonTab`（Tab 标题）vs `skeleton.*`（无关的主应用填充面板）。
- 翻译人员拿到 `preview.bones` "Bones"，不知道这是 Tab 标题、区域标题还是按钮文本——必须回查调用代码。

### 1.2 痛点 B：`preview.*` 命名空间下 286 个键"实体直挂 root"

`preview.*` 命名空间是最大头（287 键），其中 **286 键只有两段**（`preview.<实体>`），没有"角色"维度。例如：

```
preview.fog            preview.fogColor        preview.fogDensity
preview.shadowMapSize  preview.shadowNormalBias preview.ssOpacity
preview.zoom           preview.zoomIn          preview.zoomOut
```

全部混在一起。开发改"光影设置里的'阴影贴图尺寸'"时，只能靠 grep `shadowMapSize` 单点命中；想"批量找所有 fog 相关文案"也得靠模糊搜索。

### 1.3 痛点 C：`menu.*` `error.*` 等统一语义命名空间无歧义

`menu.*` (15 键) 全是右键菜单项，`error.*` (24 键) 全是错误消息——**这类"自身就是角色"的命名空间不需要再加角色前缀**。本 ADR 不强求一刀切。

---

## 2. 决策（Decision）

### 2.1 键名结构升级为三段式：`<模块>.<角色>.<实体>`

```
        ^^^^^         ^^^^^         ^^^^^
        命名空间       UI 角色       业务实体
        （位置）     （做什么）     （指什么）
```

#### 角色白名单（强制）

| 角色 | 含义 | 例子 |
|------|------|------|
| `tab` | 标签页/导航 | `preview.tab.skeleton` |
| `section` | 区域标题/分组 | `preview.section.bones` |
| `label` | 通用标签 | `preview.label.cubes` |
| `metric` | 统计/数值指标 | `preview.metric.boneCount` |
| `action` | 按钮/动作 | `preview.action.exportBones` |
| `hint` | 提示语 | `preview.hint.clickBone` |
| `msg` | 完整句子/消息 | `error.msg.networkOffline` |
| `dialog` | 对话框标题/字段 | `dialog.bones`（保留：dialog 本身就是角色） |
| `option` | 选项/枚举 | `settings.option.theme` |
| `state` | 状态描述 | `import.state.parsing` |
| `event` | 事件日志 | `audit.event.modelImported` |

> 角色不限于上表，**但必须从语义上回答"这块文案在 UI 中扮演什么角色"**。`preview.fog` 这种"实体直接挂 root"是禁止的。

#### 模块白名单

`preview` / `settings` / `diagnostics` / `content` / `dialog` / `tree` / `import` / `about` / `workshop` / `error` / `format` / `common` / `syncManager` / `webFs` / `menu` / `web` / `sync` / `recycle` / `nav` / `downloads` / `credits` / `sidebar` / `update` / `downloadQueue` / `community` / `ctx` / `repo` / `skeleton` / `advFilter` / `toast` / `perf` / `lang` / `resource` / `android` / `app` / `instances` / `oldest` / `dedup` / `rtype` / `gh` 共 41 个（按 1195 键的实际分布）。

### 2.2 兼容策略：新键必须遵守；旧键逐步迁移

| 阶段 | 范围 | 工具 |
|------|------|------|
| **CI 卡口** | 任何**新增**的键，CI 强制三段式 | `scripts/i18n-key-naming.mjs`（本 ADR 新增） |
| **旧键扫描** | 一次性扫出所有"实体直挂 root"违规键，列清单 | 同上脚本 `--list-violations` |
| **局部重构** | 仅"高频歧义实体"（bone / texture / pack / model 等）逐个 PR 迁移 | 手动；每个 PR 不超过 50 键 |
| **旧键废弃** | 旧键保留作为"语义注释"防 grep 漏掉；新键 t() 优先查 | 见 §2.3 兼容表 |

**禁止做的事**：

- ❌ 全量一次性重构 1195 键（PR 不可 review，必然引入 bug）
- ❌ 改成嵌套对象（调用方式 t() 签名要变，回归风险大）
- ❌ 强求"所有现有键"统一（绝大多数现有键没歧义，无收益）

### 2.3 旧→新兼容表机制

`t()` 内部维护一份"旧键→新键"映射表（写在 `frontend/src/core/i18n/locales/legacy-key-map.ts`），旧键命中时**优先查新键**：

```ts
// 伪代码
function t(key, params) {
  // 1. 直查
  let text = bundle[key];
  if (text !== undefined) return interpolate(text, params);

  // 2. 兼容回退：旧键→新键
  const newKey = legacyKeyMap[key];
  if (newKey && bundle[newKey] !== undefined) {
    return interpolate(bundle[newKey], params);
  }

  // 3. 警告并返回 key 本身
  warn(key);
  return key;
}
```

**好处**：
- 调用方代码 `t("preview.bones")` 完全不动
- 翻译人员改时**优先改新键**（在文档/知识卡中标注）
- 长期逐步废弃旧键

### 2.4 命名检查脚本：`scripts/i18n-key-naming.mjs`

零依赖 Node 脚本，扫三语文件：

```
node scripts/i18n-key-naming.mjs                       # CI 模式：只检查新增键
node scripts/i18n-key-naming.mjs --list-violations     # 列出所有违规旧键
node scripts/i18n-key-naming.mjs --check newKey1 newKey2  # 检查指定键
```

**CI 模式行为**：

1. 读 `git diff --name-only HEAD` 找出本次修改的语言包文件
2. 解析新增/修改的键
3. 对每个键做三段式校验：必须符合 `<模块>.<角色>.<实体>`
4. 模块必须是白名单之一；角色必须是白名单之一（或可识别为已有命名空间，如 `menu`/`error` 自身就是角色）
5. 违规时输出违规键 + 建议新键名 + 退出码 1

**`--list-violations` 模式**：

扫描全部 1195 键，输出违规清单（不退出 1）：

```
[VIOLATION] preview.bones → 建议 preview.section.bones
[VIOLATION] preview.boneCount → 建议 preview.metric.boneCount
[VIOLATION] preview.skeletonTab → 建议 preview.tab.skeleton
...
共 286 个违规键（preview.* 命名空间）
```

### 2.5 第一个重构 PR：11 个"骨骼"键

作为"三段式迁移"的最小可示范 PR，重构 18 个骨骼相关键中的 11 个（保留 7 个已合规或为命名空间根的）：

| 旧键 | 新键 |
|------|------|
| `preview.skeletonTab` | `preview.tab.skeleton` |
| `preview.skeletonLabel` | `preview.label.skeleton` |
| `preview.bones` | `preview.section.bones` |
| `preview.bonesLabel` | `preview.label.bones` |
| `preview.boneLabels` | `preview.field.boneNames` |
| `preview.exportBones` | `preview.action.exportBoneNames` |
| `preview.boneCount` | `preview.metric.boneCount` |
| `preview.bone.selectHint` | `preview.hint.clickBone` |
| `advFilter.minGtMaxBones` | `advFilter.validation.minGtMaxBones` |
| `diagnostics.assetsBones` | `diagnostics.metric.assetsBones` |
| `web.boneCount` | `web.metric.boneCount` |

剩余 7 个保留原名（`dialog.bones` / `credits.render3dDesc` / `skeleton.*` 3 个 / `preview.skeletonStructure` / `web.boneCount` 已含 `metric` 但 key 模式合规 → 实际是 `dialog.bones` 保留因 `dialog` 本身就是角色、`skeleton.*` 是命名空间根等）。

---

## 3. 后果（Consequences）

### 3.1 正面

- **大模型/翻译人员消歧**：`preview.metric.boneCount` 一看就是"3D 预览的统计指标：骨骼数"，和 `skeleton.*` 填充面板零冲突。
- **CI 卡口**新增键，三段式从源头强制，旧键不再"劣币驱逐良币"。
- **最小迁移成本**：旧键保留 + 兼容表，调用方零改动。
- **可分批做**：每个 PR 不超过 50 键，可持续。
- **教学价值**：以"骨骼"为正向案例，沉淀 i18n 命名规范到知识卡。

### 3.2 负面

- **键数量略增**：每个旧键多 1 段（`.section` / `.tab` 等），但命名空间天然分布，不会爆炸。
- **需要维护兼容表**：`legacy-key-map.ts` 长期存在，每次迁移 PR 减一行。
- **教育成本**：新成员需理解"角色"概念，AGENTS.md / 知识卡需更新。

### 3.3 已知遗留

- **不强制重构所有旧键**：`preview.*` 下另外 ~275 个旧键靠脚本标记违规清单，不强求一次性迁移。
- **`menu.*` / `error.*` 等"自身就是角色"的命名空间不强制三段式**（保留现状）；如未来要重构，需另开 ADR 评估。
- **Wails 绑定名、Go 字段名等"非 i18n 键"不受本 ADR 约束**。

---

## 4. 数据溯源

| 来源 | 关键数据 | 结论 |
|------|---------|------|
| 1195 键语言包扫描（2026-08-28） | `preview.*` 287 键中 286 键只有两段 | 痛点 B 量化 |
| 18 个"骨骼"相关键（zh-CN.ts grep） | 命名空间分散在 7 处 | 痛点 A 量化 |
| 大模型/翻译人员误改测试 | "骨骼"改 1 处引发 4 处错改 | 痛点 A 案例 |
| `scripts/i18n-key-naming.mjs`（新增） | CI 模式 | §2.4 实现 |
| `frontend/src/core/i18n/locales/legacy-key-map.ts`（新增） | 旧键→新键兼容表 | §2.3 实现 |

<!-- 文件名: i18n-key-naming-three-segment.md → 实际文件 ADR-124-i18n-key-naming-three-segment.md -->
