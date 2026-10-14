---
kind: mutable-ref-discipline
name: 可变引用判据（{v:T} 何时该用）
tier: leaf
category: core
status: active
source_files:
  - frontend/src/views/app-content/site/workshop-tabs.ts
auto_fields:
  symbols_with_lines:
    - createWorkshopRefs
    - initWorkshopTabs
    - WorkshopRefs
use_when:
  - 写了 { v: T } 包装器但不确定是否必要
  - 想拆掉别人的 { v: T }，不确定会不会引入 stale 闭包 bug
  - 跨组件共享可变状态，不知道该用引用语义还是值语义
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - "{v:T} 包装器什么时候才需要"
quick_risk_lines:
  - "拆 {v:T} 前先判断是引用语义还是值语义——引用语义（数组/对象/函数整体替换）持有 refs 的闭包天然可见，包装层是多余的；值语义（boolean/number 跨 async 边界）必须保留包装，拆了就读不到新值"
  - "别为「统一风格」无差别清扫：仓内 24 处里过半在 3D 生命周期族，那些 {v} 有真实理由（跨 async 边界共享中止标志）"
pitfalls:
  - "拆包装层是**零行为变更重构**，验收判据是原测试全绿——不是看代码更短。刀A 拆 WorkshopRefs 时 38 个测试全绿才算数"
  - "反向陷阱：给引用语义字段**补**包装层同样错——多一层间接不解决任何问题，只让调用点从 `refs.allSites` 变成 `refs.allSitesRef.v`"
  - "判据只看「闭包捕获了什么」，不看「字段是数组还是布尔」"
---

# 可变引用判据（{v:T} 何时该用）

## 概览

前端跨组件共享可变状态时，仓内存在两种手法：**直接持有引用**（`refs.allSites`）与 **`{ v: T }` 包装器**（`refs.wsEditModeRef.v`）。两者都不是错的——**用错场景才是错的**，而且两种方向的错都真实发生过：

- 引用语义字段套包装层 → 冗余间接层，调用点平白多 `.v`（刀A 修的 `WorkshopRefs` 四字段）
- 值语义状态拆掉包装层 → **stale 闭包 bug**：闭包捕获的是值拷贝，异步回来后读到的永远是旧值

本卡给**判据**，不给清扫清单——仓内 `{v:T}` 分布随重构演化，判断标准才是长期资产。

## 核心职责

### 判据：看闭包捕获了什么

| 场景 | 该用 | 为什么 |
|------|------|--------|
| 字段是**数组/对象/函数**，整体替换 | **直接持有**（`refs.allSites = sites`） | 闭包捕获的是 `refs` **对象本身**，改它的属性后所有持有者立即可见——包装层不提供任何额外能力 |
| 状态是**原始值**（`boolean`/`number`），且要跨 async 边界共享 | **`{ v: T }`** | 闭包捕获的是**值的拷贝**。`let flag = false` 被闭包读走后再改外部变量，闭包读到的永远是旧值；包装器的 `.v` 属性访问让每次读都回到同一个对象上 |
| 状态是原始值，但**只在同步作用域内用** | 直接用局部变量 | 包装层的价值只在「跨边界共享同一可变槽位」 |

**一句话**：包装层的唯一职能是**把一个可变槽位变成一个稳定对象**，从而让闭包能通过属性访问到最新值。若字段本身就是对象且消费者持有它，这个职能已经由字段自身完成。

### 仓内现状（判断标准，非清扫清单）

`{v:T}` 集中在两族，**各有理由**：

| 族 | 代表 | 保留理由 |
|----|------|---------|
| 3D 生命周期 | `mount-session.ts` / `mount-preview-core.ts` / `mount-shell.ts` | `session.aborted.v` / `isDisposed.v` 是**跨 async 边界**的中止标志——build 挂起期间用户关预览，回调里必须读到**最新**中止态 |
| 站点页 | `site/types.ts` 的 `wsEditModeRef` / `workshop-browse-mode.ts` 的 `browseMode` | 同为值语义句柄，横切 render / edit / openUrl 多处消费，靠 `.v` 保证「改一处处处生效」 |

**已拆的**：`WorkshopRefs` 的 `allSites` / `allCreators` / `repoAuthors` / `showSiteView`（引用语义，刀A）。**刻意没拆的**：同结构里的 `wsEditModeRef`——它属值语义族，与上面两族同理。

## 不变量

1. **拆包装层是零行为变更重构**：验收看原测试全绿（刀A 的标准是 38 个测试全绿），不看代码行数变短。任何"顺手改逻辑"都会把重构变成行为变更——ADR-315「搬迁不夹带」同理
2. **判据看闭包捕获什么，不看字段类型**：数组套包装层和布尔拆包装层是同一类错误（用错语义），但方向相反
3. **不为统一风格无差别清扫**：`{v:T}` 在仓内 24 处里的分布是**有理由的**——3D 生命周期族那套拆了会引入真实 stale bug。要做的是「按判据逐个核」，不是「按模式全局替换」
4. **一处拆、一处留时，必须在同处留判据**：`WorkshopRefs` 拆四个留一个（`wsEditModeRef`）之所以不会让后来人困惑，是因为拆的时候就把理由写进了类型注释——**拆留并存的场景必须显式说明为何区别对待**，否则下一个人会"顺手统一"回去

## 相关

- [app-content-site](./app-content-site.md) — `WorkshopRefs` / `WorkshopPageState` 的具体形态与「只给工厂不给单例」纪律
- [app-content](./app-content.md) — 页面编排层，refs 的创建与注入链
- [fe-layering-seams](./fe-layering-seams.md) — 跨层共享状态的注入范式
