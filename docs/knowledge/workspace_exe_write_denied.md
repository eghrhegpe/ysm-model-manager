---
kind: workspace_exe_write_denied
name: 仓内二进制写用户目录被静默拒绝（代理沙箱按镜像位置拦截）
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
  - wails3 dev / 仓内 bin 下 exe 写失败；同一 exe 复制到仓外跑恢复正常
pitfalls:
  - "**拦截键是 exe 镜像路径在 AI 代理工作区内，与文件名/哈希无关**（2026-09-27 四组对照实验实锤）：仓内 bin 的 exe 必失败，复制到 %TEMP% 原名跑零失败；从未被标记的探针复制进 bin 立即失败"
  - 症状极具迷惑性：读全正常 + 目录 ACL/属主全正常 + 代码就是裸 os.CreateTemp（go/fsutil/write.go:44 createTempFile = os.CreateTemp 无花样），会把排查引向「代码 bug / ACL / 目录锁 / 沙箱令牌」死胡同
  - "**火绒（HipsDaemon 在跑）是被冤枉的红鲱鱼**：其防护记录无任何 YSM 条目（仅无关 ssh.exe）；「有安全软件在跑」不等于「是它干的」，先看它的防护记录有无条目再定罪"
  - ACL 里的 CodexSandboxUsers:(RX) 继承项（Codex CLI 沙箱产物）同样是无害红鲱鱼；AI 代理 shell 令牌经 whoami /groups 核实无沙箱组，前后台任务写探测均成功
  - 变量剥离要彻底：第一次换名实验同时改变了「名字+位置」两个变量，差点把「按名字拦截」的错误结论写进卡里——**一次只动一个变量**
处置：
  - 立即恢复：把构建产物复制到仓外再跑（cp bin/xxx.exe %TEMP%/ 后运行即可全功能）
  - 正式发布/安装的 exe 在仓外，终端用户不受影响；仅影响「从仓内直接运行构建产物」的开发/调试场景
  - 长治：在代理沙箱设置中为工作区二进制放行用户目录写入（或接受「仓外跑 dev 产物」的工作流）
  - 代码侧无需也不应改动：WriteFileAtomic/CreateTemp 无问题，失败已按 ADR-044 sentinel 留痕
quick_groups:
  - 排查「读正常写拒绝」类雷霆：先做「换位置」对照实验（仓内 vs 仓外），再查 ACL/令牌/安全软件记录
quick_intents:
  - 应用临时文件创建全部失败但功能正常
  - 同一 exe 换个位置跑行为不同
quick_risk_lines:
  - go/fsutil/write.go|createTempFile = os.CreateTemp（:44，无花样，排除代码嫌疑的锚点）
invariant_anchors:
  - go/fsutil/write.go|各阶段失败必须经 sentinel + errors.Is 判定
---

# 仓内二进制写用户目录被静默拒绝（代理沙箱按镜像位置拦截）

## 概览

2026-09-27 排查「wails3 dev 下所有临时文件创建失败（Access is denied），但浏览功能全部正常」：实锤为 **AI 代理沙箱按 exe 镜像位置拦截**——可执行文件位于代理工作区（C:\Users\...\ysm-model-manager）内的进程，写用户目录（AppData\Roaming）被静默拒绝；复制到仓外立即恢复。非代码 bug、非 ACL、非火绒。

## 实证链（四组对照实验）

1. 目录 ACL/属主正常（user 完全控制；CodexSandboxUsers:(RX) 为 Codex CLI 沙箱的无害继承项）；Go 语义复刻探针（os.CreateTemp 同目录）自 /tmp 运行**成功**。
2. 同一 exe 的 CLI 模式 cache-clear 删除 64 文件成功——排除二进制被整体封杀（但注意：删除与创建是不同行为类别，勿过度推论）。
3. **名字 vs 位置剥离**：原名 exe 放 %TEMP% 跑 → 零失败；改名 exe 放仓内 bin → 失败。**拦截键 = 位置，不是名字**。
4. **封口**：从未被标记的探针 exe 复制进 bin 运行 → 立即失败。纯位置因素，与二进制身份无关。

## 与其他子系统关系

- go/fsutil.WriteFileAtomic（ADR-044）是全仓统一落盘口，tags/logs/配置全走它——拦截即表现为「所有临时文件创建失败」。
- 日志：「[logs] 写入日志文件失败」与绑定调用错误是唯一可见症状（拦截静默，无弹窗）。
- wails3 dev 必现的原因：构建产物 bin\ 在仓内。

## 相关

- [ysm-wasi](./ysm-wasi.md) — 同日 ADR-317 桥解码联调中首次暴露此症状，一度干扰排障方向
