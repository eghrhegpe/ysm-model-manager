// ===== app-tree bus 事件处理 =====
import {
  ToggleModelEnable,
  SelectDirectory,
  SaveAppConfig,
} from "../../../wailsjs/go/main/App.js";
import { loadEntries, fallbackEntries } from "./loader.js";

export function bindBusEvents(vm) {
  const unsubs = [];

  // 启用/禁用
  unsubs.push(
    bus.on("entry:toggle", async ({ path }) => {
      try {
        await ToggleModelEnable(path);
      } catch (_) {}
      await reload(vm);
    }),
  );

  // 选择仓库目录
  unsubs.push(
    bus.on("dir:select-repo", async () => {
      try {
        const dir = await SelectDirectory();
        if (!dir) return;
        await SaveAppConfig(dir, "", "copy");
        vm._repoRoot = dir;
        await reload(vm);
      } catch (_) {
        vm._entries = fallbackEntries();
        vm._renderTree();
      }
    }),
  );

  // 去重
  unsubs.push(
    bus.on("entries:dedup", () => {
      bus.emit("toast:show", {
        msg: "🔗 去重功能开发中",
        duration: 2000,
        type: "info",
      });
    }),
  );

  // 回收站
  unsubs.push(
    bus.on("recycle:open", () => {
      bus.emit("toast:show", {
        msg: "🗑️ 回收站功能开发中",
        duration: 2000,
        type: "info",
      });
    }),
  );

  return unsubs;
}

async function reload(vm) {
  try {
    const r = await loadEntries();
    if (r) {
      vm._repoRoot = r.repoRoot;
      vm._entries = r.entries;
    } else {
      vm._entries = fallbackEntries();
    }
  } catch (_) {
    vm._entries = fallbackEntries();
  }
  vm._renderTree();
}
