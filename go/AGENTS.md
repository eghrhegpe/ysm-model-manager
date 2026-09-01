# Go 后端（go/）— AI 行为手册

> AI 处理 `go/` 代码时自动加载的后端专属约束。全项目规则见仓库根 `AGENTS.md`；边界悖论与硬事实见 `docs/architecture.md` §Go→JS；治理红线见 `docs/governance-rules.md`。

## 构建 / 验证

```bash
go build ./go/...               # 改 Go 后必跑
node scripts/doctor.mjs --docs  # 只改文档时用（秒级）
node scripts/doctor.mjs         # 发版前全量闸门
```

- 改 Go 代码 → **必须** `go build ./go/...` 通过
- 测试在包内以 `*_test.go` 命名，`go test ./go/...` 可选；新增关键逻辑要有单测
- 改完即提交（`git add go/` + commit），别攒批

## 包结构与落地

| 包 | 职责 |
|----|------|
| `ysm` `geometry` `threejs` | YSM 格式解析、几何、3D 数据准备 |
| `importer` `installer` `instance` `packs` `scanner` `dedup` | 模型导入 / 安装 / 实例化 / 整合包 / 扫描 / 去重 |
| `download` `sync` `updater` | 下载、同步、版本更新 |
| `fileops` `fsutil` `paths` `recycle` `watcher` | 文件操作、硬链接、路径安全、回收站、监听 |
| `avatar` | 创作者头像提取 |
| `conc` | 通用泛型并发工具（`Parallel`：worker 池 + 输入序收集 + ok 跳过；统一 app_scan/app_model 手写池） |
| `version` `logs` `tags` | 版本、日志、标签 |
| `types` | 跨包共享类型定义 |
| `litematic` | MCEdit Lite 图格式支持 |
| `internal/app` | Wails 应用入口与绑定注册 |
| `cli` | CLI 命令（脱离 GUI 的模型管理/诊断/缓存操作） |
| `executil` | 外部进程执行辅助（隐藏窗口等） |

- **新文件放对应包**，不按行数机械切包；一个包内一个文件放一个可独立工作的功能
- `types/` 只放**跨包复用**的类型；包内私有类型留在本包
- `internal/` 下的包**仅本仓库内可 import**（Go 可见性规则），不要从外部工具链引用

## Go → JS 边界铁律

> 根 AGENTS §「工作准则·职责归属」 + `docs/architecture.md` §绑定模式是主来源，这里列 Go 侧的落地动作。

- **`[]byte` 走 JSON 即 base64**：Go `[]byte` 经 JSON 序列化自动变 base64 字符串（JSON 规范行为）。前端拿到的是 base64，不是裸字节；Go 侧无需手动编码，JS 侧 `atob` / `Buffer.from(..., 'base64')` 解码
- **`bool` 三态陷阱**：Go `bool` 默认 `false`，无法区分"值为假"和"未设置"。需要三态时**改用 `*bool`（指针）或显式 `Optional` 包裹类型**，不要用 `bool` + 额外标记
- **`struct` 导出即绑定**：Wails 绑定只暴露**导出字段**（大写开头）。要传给前端的结构体，字段必须大写 + 带 `` `json:"..."` `` tag；不要靠字段名猜测
- **`json:"-"` 屏蔽内部字段**：不需要的字段用 `json:"-"` 显式排除，避免 JSON 噪声和契约漂移
- **错误不要丢**：Go 函数返回 `error`，调用方必须处理。禁止 `if err != nil {}` 吞错；至少 `log` 或 `return`

## Wails 绑定契约

- **绑定由 `npm run generate:bindings` 生成**，禁止手写（见根 AGENTS §「工作准则·职责归属」）
- 命令必须带 `-ts` 参数：产出 `.ts` 文件，前端以 `.js` 后缀 import、由 vite `wailsBindingsResolve` 重定向
- **改 Go 侧导出函数签名 → 必须重新 generate:bindings**；否则前端拿到的是旧契约
- 绑定函数名先 `grep` 在 `internal/app/` 确认，不要凭空写
- 返回结构体要加 `//go:binding` 注释或确保在 `internal/app` 的绑定注册表里

## Go 专属坑点

- **RE2 不支持负向前瞻 `(?!`**：Go 正则引擎是 RE2，写正则时遇到 `(?!...)` 必报错。改用正向断言组合或先过滤后匹配
- **Windows `os.Rename` 会 `ERROR_SHARING_VIOLATION`**：目标文件被进程打开时重命名失败。涉及删除/移动的操作，先 `os.Remove`（Go 在 Windows 下删除成功但保留文件名到下次 `FindFirst` 前可见），或先断共享再重命名
- **硬链接跨分区失败**：NTFS 硬链接不允许跨驱动器卷。`fsutil/hardlink` 里的跨设备回退逻辑是必要防线，不要"简化"
- **`sync.Once` 只执行一次**：并发初始化用 `sync.Once` 安全；但**重置场景不能用**，改 `sync.Mutex` + 手动状态
- **文件路径用 `filepath` 不用字符串拼接**：`filepath.Join`、`filepath.Clean`、`filepath.Abs`。禁止 `"C:\\" + name` 式拼接
- **不要裸 `os.Open` 做批量读取**：大文件用 `bufio.Reader`，带超时用 `context.Context` + `ioutil.NopCloser`
- **日志用统一 `logs` 包**：不要到处 `fmt.Println`；调试信息走 `logs.Debug` 或根 AGENTS「环形日志面板」

## 提交纪律

- `git add go/` 精准提交，别混入 `frontend/` 改动
- commit message 用 `fix:` / `feat:` / `refactor:` 等约定前缀
- 改动跨包时，在汇报里说明"为什么"跨了建议边界