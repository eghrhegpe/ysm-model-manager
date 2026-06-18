# YSM 模型管理器 — AI 模型分配矩阵

> 版本：v1.1 · 2026-06-18
> 订阅：OpenCode Go（按量付费）+ DeepSeek 官方 API 直连（https://api.deepseek.com）
> 用途：按项目任务场景选择最优模型，不纠结、不浪费
>
> **v1.1 变更：** 将硬骨头任务从 OpenCode 通道 DeepSeek V4 Pro（$1.74/$3.48）迁移到官方直连 DeepSeek V4 Pro（¥3/¥6 ≈ $0.42/$0.83），输入成本降 4 倍。Flash 两者价格一致，任选。

---

## 一、全局速查

```
后端 Go         → Qwen3.7 Plus / GLM-5.1 / Flash
前端 Web Components → Qwen3.7 Plus / Flash / Big Pickle
CSS / 主题      → Qwen3.7 Plus / MiMo Free / Flash
3D 渲染         → Qwen3.7 Plus / DeepSeek V4 Pro（官方直连）/ Flash
社区/工坊       → Qwen3.7 Plus / Flash / Big Pickle
小说创作        → DeepSeek V4 Flash / DeepSeek V4 Pro（官方直连）
文档/发版       → Flash / Qwen3.7 Plus / GLM-5.1
Git commit      → DeepSeek V4 Flash
架构决策        → DeepSeek V4 Pro（官方直连）/ GLM-5.1
测试            → Qwen3.7 Plus / Flash / Big Pickle Free
```

---

## 二、定价参考（$ / 1M tokens）

| 模型 | 输入 | 输出 | 缓存读取 | 缓存写入 | 等级 |
|------|------|------|----------|----------|------|
| Big Pickle | 🆓 | 🆓 | 🆓 | — | Free |
| DeepSeek V4 Flash Free | 🆓 | 🆓 | 🆓 | — | Free |
| MiMo-V2.5 Free | 🆓 | 🆓 | 🆓 | — | Free |
| North Mini Code Free | 🆓 | 🆓 | 🆓 | — | Free |
| Nemotron 3 Ultra Free | 🆓 | 🆓 | 🆓 | — | Free |
| **DeepSeek V4 Flash** (OpenCode 通道) | $0.14 | $0.28 | **$0.028** | — | 💰 |
| **DeepSeek V4 Flash** (官方直连) | ¥1 / $0.14 | ¥2 / $0.28 | **¥0.02** | — | ¥💰 |
| **Qwen3.7 Plus** | $0.40 | $1.60 | **$0.04** | $0.50 | 💰💰 |
| **Qwen3.7 Max** | $2.50 | $7.50 | $0.50 | $3.125 | 💰💰💰 |
| **GLM-5.1** | $1.40 | $4.40 | $0.26 | — | 💰💰 |
| **DeepSeek V4 Pro** (OpenCode 通道) | $1.74 | $3.48 | $0.145 | — | 💰💰 |
| **DeepSeek V4 Pro** (官方直连) | ¥3 / $0.42 | ¥6 / $0.83 | **¥0.025** | — | ¥💰 |
| **GPT 5.4 Mini** | $0.75 | $4.50 | $0.075 | — | 💰 |
| **Gemini 3 Flash** | $0.50 | $3.00 | $0.05 | — | 💰 |
| Claude Sonnet 4.6 | $3.00 | $15.00 | $0.30 | $3.75 | 💰💰💰💰 |
| Claude Opus 4.7 | $5.00 | $25.00 | $0.50 | $6.25 | 💰💰💰💰💰 |

> 写长篇时输出 token 消耗最大，输出价低 = 真正省钱的模型。

---

## 三、按项目方向分配

### 3.1 后端 Go

| 具体任务 | 推荐模型 | 理由 |
|----------|----------|------|
| DAO / CRUD / 路由 handler | **Qwen3.7 Plus** | 缓存 $0.04，日常主力，连续对话持续省钱 |
| sync 状态机 / watcher 事件链 | **GLM-5.1** | 跨文件耦合分析强，一次性攻坚，不用缓存也值 |
| 小修补 / 加字段 / optional / 改类型 | **DeepSeek V4 Flash** | 改一行两行，$0.028 缓存，不心疼 |
| Go struct 定义 / JSON 映射 | **Qwen3.7 Plus** | 常规结构化任务 |
| 重构 / 提取公共方法 | **DeepSeek V4 Pro（官方直连）** | 需要理解调用链，不能省 |

**真实账单参考：**
- 日常 1 次对话写 Go（~10K 输入 + ~2K 输出）：Qwen3.7 Plus ≈ $0.004 + $0.032 = **<$0.04**
- 第二次起缓存命中：≈ $0.0004 + $0.032 = **<$0.033**

### 3.2 前端 Web Components

项目使用 Custom Elements v1 + Shadow DOM，每组件拆分为 index / tpl / data / render / events / utils。

| 具体任务 | 推荐模型 | 理由 |
|----------|----------|------|
| 组件生命周期编排（index.js） | **Qwen3.7 Plus** | 需要理解 Shadow DOM 上下文 |
| 事件绑定（events.js） | **DeepSeek V4 Flash** | 模式固定，addEventListener 套路化 |
| HTML 模板（tpl.js / row-tpl.js） | **Big Pickle Free** 🆓 | 纯字符串，不需要推理 |
| 数据逻辑（data.js） | **Qwen3.7 Plus** | 涉及 filter/sort/map，需要一定理解 |
| 渲染逻辑（render.js） | **DeepSeek V4 Flash** | innerHTML 拼接，模板化 |
| 虚拟滚动 / RAF 性能优化 | **DeepSeek V4 Pro（官方直连）** | 需要跨帧分析内存泄漏 |
| 批量补齐新组件（按已有模式） | **North Mini Code Free** 🆓 | 3B 模型，模式复制极快 |

### 3.3 CSS / 主题系统

项目现有 4 套主题（cyber / warm / pro / mint），CSS 变量驱动。

| 具体任务 | 推荐模型 | 理由 |
|----------|----------|------|
| 新主题创作（变量体系 + 配色） | **Qwen3.7 Plus** | 色感平衡好，输出 $1.60 不贵 |
| 动效设计（关键帧 / 过渡 / stagger） | **MiMo-V2.5 Free** 🆓 | 你偏好的模型，创意发散强 |
| 批量补齐组件样式（按现有模式） | **DeepSeek V4 Flash** | 套模板量产，不需要推理架构 |
| 无障碍治理（`.no-animations` 覆盖） | **North Mini Code Free** 🆓 | 简单规则扫描 |
| CSS 变量治理（硬编码→var()） | **Qwen3.7 Plus** | 需要理解语义映射 |

**注意：** 项目 CSS 通过 JS 模板字符串注入 Shadow DOM（`<style>` 标签），非 `adoptedStyleSheets`。给 CSS 任务的 prompt 中不要写 `adoptedStyleSheets`，应写 `style 标签注入`。

### 3.4 3D 渲染（Three.js / WebGL）

参考 `docs/3D/3D-RENDERING-PLAN.md`，涉及骨骼解析、矩阵运算、材质光照、截图渲染。

| 具体任务 | 推荐模型 | 理由 |
|----------|----------|------|
| 骨骼解析 / 矩阵运算 | **DeepSeek V4 Pro（官方直连）** | 数学推理要求高，不能省 |
| 材质 / 纹理 / 光照调试 | **Qwen3.7 Plus** | 视觉理解 + 编码平衡好 |
| 加载器 / 文件解析 | **Qwen3.7 Plus** | 常规 IO + 格式解析逻辑 |
| 性能调优 / 内存泄漏排查 | **DeepSeek V4 Pro（官方直连）** 或 **GLM-5.1** | 需要跨帧分析 |
| 简单几何工具函数 | **DeepSeek V4 Flash** | 数学公式固定，Flash 够用 |
| 截图渲染管线 | **Qwen3.7 Plus** | 常规渲染逻辑 |

### 3.5 社区 / 创意工坊 / GitHub

| 具体任务 | 推荐模型 | 理由 |
|----------|----------|------|
| 下载队列（STATE 持久化） | **DeepSeek V4 Flash** | 逻辑链短，Flash 够用 |
| 创作者管理（cr- 系列组件） | **Qwen3.7 Plus** | 模板 + 数据 + 事件交织 |
| GitHub API 对接 | **Qwen3.7 Plus** | 需要理解 OAuth / REST API |
| 批量补齐空状态 / loading / skeleton | **Big Pickle Free** 🆓 | 模板化工作，免费做 |
| GitHub 搜索结果渲染 | **DeepSeek V4 Flash** | 数据驱动渲染 |

### 3.6 小说创作（《巴别塔》技术工程小说）

参考 `docs/novel/SKELETON.md`。

| 具体任务 | 推荐模型 | 理由 |
|----------|----------|------|
| 骨架展开→章节草稿 | **DeepSeek V4 Flash** | 178K token 仅 $0.0009，整本设定一次灌入 |
| 关键段落精修 | **DeepSeek V4 Pro（官方直连）** | ¥6/1M 输出，文笔好能改出质感 |
| 技术逻辑校正（Go/3D 术语） | **Qwen3.7 Plus** | 技术准确性优先 |
| 章节标题 / 摘要 / 引子 | **Big Pickle Free** 🆓 | 随手出 |
| 跨章情节一致性检查 | **GLM-5.1** | 长上下文 + 逻辑推理 |

**已验证：（2026-06-16 账单）**
- DeepSeek V4 Flash：177,774 输入 + 1,079 输出 = **$0.0009**
- 铺草稿阶段放心用 Flash，一条对话写半本书都花不了 1 分钱

### 3.7 文档 / 发版 / Git

| 具体任务 | 推荐模型 | 理由 |
|----------|----------|------|
| release notes 结构提取（git log→结构化） | **GLM-5.1** | 跨文件耦合分析强 |
| release notes 润色（干骨架→可读文案） | **Qwen3.7 Plus** | 排版好，会写给人看的文字 |
| git commit message 代笔 | **DeepSeek V4 Flash** | git diff → 单行消息，固定套路 |
| 代码注释 / README 生成 | **Qwen3.7 Plus** | 需要理解上下文 |
| 架构文档更新（architecture.md） | **DeepSeek V4 Pro（官方直连）** | 需要准确理解模块边界 |

### 3.8 架构决策 / 跨层设计

| 具体任务 | 推荐模型 | 理由 |
|----------|----------|------|
| Go↔JS 对接契约设计 | **DeepSeek V4 Pro（官方直连）** | 边界语义分析（null/undefined/bool 三态/base64） |
| 模块拆分 / 重构方案 | **GLM-5.1** | 跨文件耦合看得准 |
| 性能瓶颈定位 | **DeepSeek V4 Pro（官方直连）** | 推理链深，需要假设→验证循环 |
| 技术选型评估 | **GLM-5.1** | 多因素权衡，逻辑严谨 |

### 3.9 测试

| 具体任务 | 推荐模型 | 理由 |
|----------|----------|------|
| Go table-driven 测试 | **Qwen3.7 Plus** | 按现有模式补齐，需要理解业务 |
| JS vitest 单元测试 | **DeepSeek V4 Flash** | 模板化，不费脑 |
| 测试边界 case 设计 | **DeepSeek V4 Pro（官方直连）** | 需要推理遗漏场景 |
| 已有测试维护（补 case） | **Big Pickle Free** 🆓 | 模式固定 |

---

## 四、会话经济学

### 缓存命中才是真省钱

```
Qwen3.7 Plus 连续写 Go:
  第 1 条：$0.40 输入（无缓存）
  第 2 条起：$0.04 输入（缓存命中）
  输出每条：$1.60 / 1M tokens ≈ $0.003/200tokens
```

**不要频繁切模型。** 一个会话用到底，缓存命中率上去了，均价就下来了。

### 贵模型什么时候值得用

| 模型 | 单次使用上限 | 超过就别用了 |
|------|------------|-------------|
| Qwen3.7 Plus | 无限制 | — |
| DeepSeek V4 Flash | 无限制 | — |
| DeepSeek V4 Pro（官方直连） | 无限制 | 输出 ¥6/1M，非攻坚不用 |
| DeepSeek 官方 R1 | 大推理解码慎用 | 写普通代码 |
| GLM-5.1 | 每周 ≤ 5 次架构 | 改一行代码 |
| Claude 系列 | 不用于本项目 | 输出 $15~75/1M，写不起 |

### 免费模型的局限

| 模型 | 适合 | 不适合 |
|------|------|--------|
| Big Pickle | 简单模板 / 标题 / 一行修改 | 复杂逻辑 / 长上下文 |
| MiMo Free | 动效创意 / 发散 brainstorm | 精确编码 / 技术推理 |
| North Mini Code Free | 模式复制 / 简单补全 | 多步任务 |
| Nemotron 3 Ultra Free | 一次性灌数百文件梳理脉络 | 工具调用不稳，别做精细活 |

---

## 五、切换流程（工单制）

当你要分配一个任务时，在 prompt 开头附上：

````
## 任务分配
模型: [模型名]
方向: [项目方向，如 3.2 前端 Web Components]
参考: [相关文件路径]
约束: [AGENTS.md 禁令 / 设计规范]
done-when: [验收条件]
````

### 示例

````
## 任务分配
模型: Qwen3.7 Plus
方向: 3.2 前端 Web Components — app-tree row-tpl.js 新行类型
参考: frontend/js/components/app-tree/row-tpl.js
约束: Shadow DOM 内，CSS 通过 style 标签注入，不用 adoptedStyleSheets
done-when: 新行类型渲染正确，npx vite build 不红
````

---

## 六、相关文档

- [AGENTS.md 模型索引](../AGENTS.md) — (需要更新，当前列的是旧免费模型)
- [架构文档](architecture.md)
- [任务计划](TASK_PLAN.md)
- [3D 渲染计划](../3D/3D-RENDERING-PLAN.md)
- [定价来源：OpenCode 价目表]
