# 编码奇谭：YSM 巴别塔演义

> 在一座由四种语言搭建的巴别塔里，每堵墙本该保护你，却在暗处开了裂缝。

本页只是门牌，**不维护章节索引**。索引由脚本从目录树生成，见下。

| 去哪里 | 文件 | 说明 |
|--------|------|------|
| 读目录 | [index.md](index.md) | **全量章节索引**（自动生成，勿手改） |
| 查世界观 / 角色 / 冲突 | [SKELETON.md](SKELETON.md) | 三幕结构、技术设定、角色表 |
| 续写前必读 | [AGENTS.md](AGENTS.md) | 目录规范、决策链路、禁则 |
| 早期叙事（历史稿） | [development-saga.md](development-saga.md) | 事件驱动演义史 |

---

## 结构一句话

- **创业三部曲**（`act-1-babel` / `act-2-walls` / `act-3-cartographer`）：🧊 已冻结，事件驱动，16 章。
- **区域志**（vol 4+）：按代码区域锚定 10 区域 + `appendix/` 4 组。**改了代码 → 看路径 → 命中区域 → 写章**。

## 新增章节怎么做

```bash
# 1. 走 AGENTS.md 决策链路定位区域，目录不存在就建（空目录不入库，写章时自然产生）
mkdir -p "docs/novel/03-UI器官"
# 2. 放 NN-标题.md
# 3. 重跑索引生成器（唯一的索引维护动作）
node scripts/build-novel-index.mjs
```
