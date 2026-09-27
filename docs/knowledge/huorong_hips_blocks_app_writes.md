---
kind: huorong_hips_blocks_app_writes
name: 火绒主动防御按二进制拦截应用写入（读写分离假象）
tier: leaf
category: go
status: active
source_files:
  - go/fsutil/write.go
auto_fields:
  symbols_with_lines:
    - ErrChmodFailed
    - ErrCloseFailed
    - ErrRenameFailed
    - ErrSyncFailed
    - ErrTempCreateFailed
    - ErrWriteFailed
    - ReadLimitedEntry
    - SHA256File
    - WriteFileAtomic
use_when:
  - 应用日志/配置出现「创建临时文件失败 ... Access is denied」，但浏览、读取全部正常
  - 同一 exe 换个文件名写恢复正常；CLI 模式某些写正常、GUI 模式创建失败
pitfalls:
  - 火绒（HipsDaemon）主动防御按**二进制身份**（文件名/哈希+信誉记忆）静默拦截写行为，弹窗被点「阻止」后长期记住且不再提示；反复拉起进程（dev 调试、AI 代理多轮起停）容易触发
  - 症状极具迷惑性：读全正常 + 目录 ACL/属主全正常 + 代码就是裸 os.CreateTemp（go/fsutil/write.go:44 createTempFile = os.CreateTemp 无花样），会把排查引向「代码 bug / ACL / 目录锁 / 沙箱令牌」死胡同
  - 同一 exe 的 CLI 模式（cache-clear 删除 64 文件）可成功、GUI 创建失败——拦截是行为分类的（创建 vs 删除），勿用「CLI 能删」推出「写没被拦」
  - 排查绝杀：**同一二进制换个文件名再跑**——换名零失败 + 原名必失败 = 按身份拦截实锤（2026-09-27 实测：ysm-renamed.exe 全程零失败且 ysm-import-logs.json 成功落盘，原名复跑必失败）
  - ACL 里的 CodexSandboxUsers:(RX) 继承项（Codex CLI 沙箱产物）是无害红鲱鱼；AI 代理 shell 令牌经 whoami /groups 核实无沙箱组，前后台任务写探测均成功
处置：
  - 火绒主界面 → 信任区/防护记录：解除对 bin\YSM-Model-Manager.exe 的阻止或加入信任区；开发期频繁起停建议信任仓内 bin 目录
  - 临时绕过：换文件名运行（信誉按名记忆，改名即新身份）
  - 代码侧无需也不应改动：WriteFileAtomic/CreateTemp 无问题，失败已按 ADR-044 sentinel 留痕
quick_groups:
  - 排查「读正常写拒绝」类雷霆：先跑换名对照实验，再查 ACL/令牌/代码
quick_intents:
  - 应用临时文件创建全部失败但功能正常
  - 同一 exe 部分操作被静默拒绝
quick_risk_lines:
  - go/fsutil/write.go|createTempFile = os.CreateTemp（:44，无花样，排除代码嫌疑的锚点）
invariant_anchors:
  - go/fsutil/write.go|各阶段失败必须经 sentinel + errors.Is 判定
---

# 火绒主动防御按二进制拦截应用写入（读写分离假象）

## 概览

2026-09-27 排查「wails3 dev 下所有临时文件创建失败（Access is denied），但浏览功能全部正常」：实锤为**火绒安全主动防御（HipsDaemon）按二进制身份静默拦截 YSM-Model-Manager.exe 的写行为**，非代码 bug、非 ACL、非沙箱令牌。

## 实证链（对照实验）

1. 目录 ACL/属主正常（user 完全控制；CodexSandboxUsers:(RX) 为 Codex CLI 沙箱的无害继承项）。
2. Go 语义复刻探针（os.CreateTemp 同目录）**成功**——排除文件系统与调用方式。
3. 同一 exe 的 CLI 模式 cache-clear 删除 64 个文件成功——排除二进制被整体封杀。
4. **换名对照**：ysm-renamed.exe 全程零失败且 ysm-import-logs.json 成功落盘；原名复跑必失败——按身份拦截实锤。
5. 前台/后台、dev/production 二进制均失败——与启动方式、构建形态无关。

## 与其他子系统关系

- go/fsutil.WriteFileAtomic（ADR-044）是全仓统一落盘口，tags/logs/配置全走它——火绒拦截即表现为「所有临时文件创建失败」。
- 日志：go/logs 的「[logs] 写入日志文件失败」与绑定调用错误是该拦截的唯一可见症状（拦截静默，无火绒弹窗残留提示）。

## 相关

- [ysm-wasi](./ysm-wasi.md) — 同日排查中一度被误认为与新桥解码相关，实为独立环境问题
