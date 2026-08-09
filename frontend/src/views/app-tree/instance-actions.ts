// ===== 整合包右键操作实现 =====
import { friendlyError } from "../../utils/dom/errors.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { bus } from "../../bus.ts";
import type { AppTree } from "./index.ts";
import { getApp } from "../../wails/app.ts";
import { requireMcRoot } from "../../core/handlers/require-mcroot.ts";

// 参数契约对齐 Go 侧 logs.go Logger.Add 签名：AddImportLog(modelName, sourcePath, targetDir, fileSize, status, errMsg)。
// Operation 恒为 "import"（诊断页按此分组）；sourcePath = 源，targetDir = 目标——调用方务必按此口径传参。
function addImportLog(
  modelName: string,
  sourcePath: string,
  targetDir: string,
  fileSize: number,
  status: string,
  errMsg: string,
): void {
  getApp().then((mod) => {
      mod.AddImportLog?.(modelName, sourcePath, targetDir, fileSize, status, errMsg);
    })
    .catch(() => {});
}

// 安装模型到整合包：打开文件选择器 -> 导入
export function initInstanceActions(vm: AppTree): Array<() => void> {
  const unsubs: Array<() => void> = [];

  unsubs.push(
    bus.on("instance:install", async ({ name: insName }) => {
      try {
        const { SelectDirectory, ListVersionInstances } = await getApp();
        const filePaths = await SelectDirectory();
        if (!filePaths) return;
        // 获取整合包目录
        const cfg = await (
          await getApp()
        ).LoadAppConfig();
        const mcRoot = cfg.mcRoot || "";
        if (!mcRoot) {
          bus.emit("toast:show", {
            msg: "请先配置游戏目录",
            duration: 3000,
            type: "warn",
          });
          return;
        }
        const instances = (await ListVersionInstances(mcRoot)) || [];
        const ins = instances.find((i) => i.Name === insName);
        if (!ins || !ins.CustomDir) {
          bus.emit("toast:show", {
            msg: "未找到整合包目录",
            duration: 3000,
            type: "error",
          });
          return;
        }
        // 选择一个 .ysm 文件导入
        const { InstallModelWithOverlay } =
          await getApp();
        // 绑定签名仅 2 参（overlay 布尔已移除，原 JS 第三参 false 被忽略）
        const result = await InstallModelWithOverlay(
          filePaths,
          ins.CustomDir,
        );
        // 口径：modelName=整合包名，sourcePath=用户选择的源目录，targetDir=目标整合包目录
        addImportLog(
          insName,
          filePaths,
          ins.CustomDir,
          0,
          result ? "success" : "skipped",
          result ? "安装成功" : "文件已存在",
        );
        bus.emit("stats:refresh");
        bus.emit("toast:show", {
          msg: result ? `✅ 已安装到 ${insName}` : "⏭️ 文件已存在",
          duration: 3000,
          type: result ? "success" : "info",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ ${friendlyError(e)}`,
          duration: 5000,
          type: "error",
        });
      }
    }),
  );

  unsubs.push(
    bus.on("instance:sync", async ({ name: insName }) => {
      try {
        const {
          GetRepoRoot,
          ListVersionInstances,
          SyncCustomToRepo,
        } = await getApp();
        const mcRoot = await requireMcRoot();
        const repoRoot = GetRepoRoot ? await GetRepoRoot(RESOURCE_TYPES.YSM) : "";
        if (!mcRoot || !repoRoot) {
          bus.emit("toast:show", {
            msg: "请先配置路径",
            duration: 3000,
            type: "warn",
          });
          return;
        }
        const instances = (await ListVersionInstances(mcRoot)) || [];
        const ins = instances.find((i) => i.Name === insName);
        if (!ins || !ins.CustomDir) {
          bus.emit("toast:show", {
            msg: "未找到整合包",
            duration: 3000,
            type: "error",
          });
          return;
        }
        // 同步键口径对齐 Go 侧 sync_push.go SyncCustomToRepo：去重 = Hash 优先 + 原始 Name 兜底，
        // 复制保留相对路径。前端不再自行按 .ban 剥离的裸名 Set 计数，直接信任 Go 返回值
        // （单一事实来源），避免前端口径与 Go 不一致导致「📤 N」撒谎或漏同步。
        const uploaded = await SyncCustomToRepo(ins.CustomDir, repoRoot);
        bus.emit("stats:refresh");
        bus.emit("toast:show", {
          msg: `🔄 ${insName} 同步完成 | 📤 ${uploaded}`,
          duration: 3000,
          type: "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ ${friendlyError(e)}`,
          duration: 5000,
          type: "error",
        });
      }
    }),
  );

  return unsubs;
}
