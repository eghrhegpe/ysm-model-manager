---
kind: reference
name: win-filename-rules
tier: architecture
category: go
status: draft
source_files:
  - go/fsutil/perms.go
auto_fields:
  symbols_with_lines:
    - ContainsIllegalNameChar
    - DirPerms
    - FilePerms
use_when:
  - 用户输入的文件/文件夹名落盘前校验（重命名、新建目录、移动/复制目标段）
  - 判断某字符串是否为 Windows 非法文件名（非法字符 / 保留设备名 / 尾随点空格）
pitfalls:
  - 前端 isUnsafeFolderName（context-menu-shared.ts）是 UX 预检，**终审在 Go**——两端口径必须同步演化，单边收紧会导致「前端放行、Go 报错」体验断层
  - 保留名判定是「首个点之前整段匹配」：con.tents 与 CON.txt 同拒（Windows 判定口径）；但 con.tents（子串中缀）类如 Console_Hud 放行
  - 尾随空格校验必须吃**未 trim 原串**：前端 dstDir 拼接用未 trim 的 folder，校验若先 trim 就漏检（Windows 落盘静默剥离 → 落点漂移）
quick_groups:
  - 校验入口：ContainsIllegalNameChar（单一事实源）
quick_intents:
  - 「为什么这个名字被拒」→ 三层校验：非法字符 `\/:*?"<>|` ／ 保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9，大小写不敏感）／ 尾随点或空格
quick_risk_lines:
  - 扩展校验层时须同步前端 context-menu-shared.ts 的 WIN_RESERVED_NAMES 与本卡
invariant_anchors:
  - go/fsutil/perms.go|ContainsIllegalNameChar
  - go/fsutil/perms.go|winReservedNames
  - go/fsutil/perms.go|illegalNameChars
---

# win-filename-rules
## 概览

Windows 文件名合法性校验的单一事实源：`go/fsutil/perms.go` 的 `ContainsIllegalNameChar`。fileops.CreateDir / RenameDir / RenameFile / folder_import.WriteModelFolder 四个落盘入口均委托本函数，2026-09-06（锐评 P2 #9）扩展为三层校验。

## 核心职责

按顺序三层判定，任一命中即拒：

1. **非法字符** `\/:*?"<>|`（常量 `illegalNameChars`）；
2. **Windows 保留设备名**：CON / PRN / AUX / NUL / COM1-9 / LPT1-9（`winReservedNames`，大小写不敏感，剥首个点后的扩展名再整体匹配——CON.txt 亦拒）；
3. **尾随点/空格**（Windows 落盘静默剥离 → 用户看到的名字与实际落点漂移）。

> **跨平台收紧是有意为之（勿单侧放宽）**：第 2/3 层是 Windows 规则，但 Go 侧
> `ContainsIllegalNameChar` 无 `runtime.GOOS` 门控、对所有平台无条件生效——理由：
> 模型目录/文件可能分享给 Windows 用户打开（YSM 生态以 Windows 为主），Linux/macOS
> 上合法的 `con`/`COM1`/`backup.` 若入仓再同步到 Windows 会静默剥名/失败。
> 若未来确认纯本机场景需要放开，须 Go 与前端 `isUnsafeFolderName` **双侧同步**加
> GOOS 门控并补跨平台测试，禁止只改一侧（code_review 04449b48 #4/#5 口径）。

前端镜像实现：`frontend/src/features/context-menu/context-menu-shared.ts` 的 `isUnsafeFolderName`（UX 预检，弹窗提交前即时 toast；额外允许 `/` `\` 作嵌套分隔符按段校验）。

## 对外 API / 入口

- `fsutil.ContainsIllegalNameChar(name string) bool` — 唯一校验入口
- `isUnsafeFolderName(folder: string): boolean` — 前端预检镜像（context-menu-shared.ts）

## 与其他子系统关系

- `go/fileops/fileops.go` CreateDir/RenameDir/RenameFile 四消费点
- `go/fileops/folder_import.go` WriteModelFolder
- 前端右键菜单 `resolveDstDir`（move/copy 目标文件夹输入）

## 不变量

- 前后端口径必须同步：改 Go 侧校验层必须同步前端 `WIN_RESERVED_NAMES`/段校验，反之亦然（两侧各有表驱动测试钉住：`go/fsutil/perms_name_test.go` / `context-menu-shared.test.ts`）
- 保留名匹配口径：首个点之前整段、大小写不敏感、带扩展名变体同拒
- 尾随空格校验吃未 trim 原串

## 相关

- [doc:context-menu]（move/copy 弹窗消费方）
- ADR-038 D3（ysm.json 整组语义，另一类文件名守卫）
