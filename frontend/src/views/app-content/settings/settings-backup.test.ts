// ===== 设置导出/导入 逻辑层白名单锁（ADR-344-d1）=====
// 钉两件事：① 采集面=台账里 tier local-storage + authority browser-authority 的键（不多不少）；
// ② 回写面=同一集合（导出文件里未登记的键一律忽略）。台账是唯一事实源，这里只锁
// 「读/写面与台账口径一致」——若有人新增偏好却漏登记台账，契约测试 A 只防死键、不防漏收，
// 本测试以台账为基准再兜一层（采集漏掉某浏览器偏好 = 换机照样丢，正是 b1116645c 的病根）。
// 键族（keyPattern）：台账登记的是占位符，真实键由持有模块拼接。本测试把真实键显式列进
// 「localStorage 里的候选键」，锁「占位符必须展开成真键才能被采集/回写」——只锁登记名
// 对账的契约测试（tests/test_settings_key_ledger.ts）不覆盖这条，见知识卡 settings-persistence.md。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { exportableSettingsKeys, type SettingsKeyEntry } from "@/settings-keys";

const storageMock = vi.hoisted(() => ({
  isStorageAccessible: vi.fn((): boolean => true),
  safeGet: vi.fn((_key: string): string | null => null),
  safeSet: vi.fn((_key: string, _val: string): boolean => true),
  safeRemove: vi.fn(() => {}),
  safeKeys: vi.fn((): string[] => []),
}));

vi.mock("@/utils/base/primitives/storage.ts", () => storageMock);

// —— 编排链路夹具（锐评 2026-10-16 补：原测试只钉纯函数，initSettingsBackup 整条导入/导出
// 编排零覆盖，回滚分支与顺序契约无人看管）——
const appMocks = vi.hoisted(() => ({
  ExportSettingsJSON: vi.fn(),
  SelectImportFile: vi.fn(),
  ReadSettingsExport: vi.fn(),
  ImportSettingsData: vi.fn(),
  // 导入前备份的消费入口（锐评 P2④）：.bak-* 此前只产出、UI 无浏览/恢复
  ListSettingsBackups: vi.fn(),
  RestoreSettingsBackup: vi.fn(),
  OpenFolder: vi.fn(),
  // 配置目录来源（锐评 P3⑥）：「打开备份目录」按钮由 GetConfigPath 推导目录，不再依赖备份存在
  GetConfigPath: vi.fn(),
  // 目录存在性只读查询（锐评 P2⑤ 增强）：导入覆盖的 FilesRoot/McRoot/CustomRoots 来自旧机，
  // 前端据此检测哪些路径在本机无效并提示去「环境」页重设
  DirectoryExists: vi.fn(),
}));
const busMock = vi.hoisted(() => ({ emit: vi.fn(), on: vi.fn() }));
const toastMock = vi.hoisted(() => ({ toast: vi.fn(), toastError: vi.fn() }));
const modalConfirmMock = vi.hoisted(() => ({ modalConfirm: vi.fn() }));

vi.mock("@/views/backend-deps.ts", () => ({
  backendGetApp: vi.fn(async () => appMocks),
}));
vi.mock("@/bus", () => ({ bus: busMock }));
vi.mock("@/utils/dom/toast.ts", () => ({ toast: toastMock.toast, toastError: toastMock.toastError }));
vi.mock("@/utils/dom/modal-confirm.ts", () => modalConfirmMock);

import {
  collectExportableLocalStorage,
  applyImportedLocalStorage,
  importedKeysFrom,
  initSettingsBackup,
} from "./settings-backup.ts";

/** 台账中「随导出带走」且无 keyPattern 的键（登记名即真实键） */
const exactExportableKeys = exportableSettingsKeys()
  .filter((e) => !e.keyPattern)
  .map((e) => e.key);

/** 键族展开的物理键示例：台账登记的占位符对应这些真实键（见各 note，工坊键用冒号分隔） */
const FAMILY = {
  scene: "ysm-scene-cap-fog",
  scene2: "ysm-scene-cap-water",
  wsTag: "ysm-ws-active-tag:site-a",
  wsKw: "ysm-ws-search-kw:site-a",
};

/** 本测试模拟的 localStorage 候选键集合（真实场景下 localStorage 里不存在占位符登记名） */
const DEFAULT_CANDIDATES = [
  ...exactExportableKeys,
  FAMILY.scene,
  FAMILY.scene2,
  FAMILY.wsTag,
  FAMILY.wsKw,
];

/** 一条登记 → 候选集里匹配到的物理键（独立复现 matchesPattern，不 import 实现以免同源盲区） */
function physicalKeys(entry: SettingsKeyEntry, candidates: string[]): string[] {
  const p = entry.keyPattern ?? entry.key;
  const star = p.indexOf("*");
  if (star === -1) return candidates.includes(p) ? [p] : [];
  const prefix = p.slice(0, star);
  const suffix = p.slice(star + 1);
  return candidates.filter(
    (k) => k.startsWith(prefix) && k.length >= prefix.length + suffix.length && k.endsWith(suffix),
  );
}

/** 按台账 + 给定候选集推出的「应采集物理键」集合（测试基线） */
function expectedPhysical(candidates: string[]): string[] {
  const out: string[] = [];
  for (const entry of exportableSettingsKeys()) {
    out.push(...physicalKeys(entry, candidates));
  }
  return [...new Set(out)].sort();
}

const EXPECTED_PHYSICAL = expectedPhysical(DEFAULT_CANDIDATES);

beforeEach(() => {
  storageMock.isStorageAccessible.mockReturnValue(true);
  storageMock.safeGet.mockReturnValue(null);
  storageMock.safeSet.mockReset();
  storageMock.safeSet.mockReturnValue(true); // 默认落盘成功（不依赖 mockReset 的实现恢复语义）
  storageMock.safeRemove.mockReset();
  storageMock.safeKeys.mockReturnValue([...DEFAULT_CANDIDATES]);
});

describe("collectExportableLocalStorage 采集面", () => {
  it("只采台账可导出键展开后的物理键（口径=台账，键族展开成真键）", () => {
    storageMock.safeGet.mockImplementation((key: string) => `v:${key}`);
    const collected = Object.keys(collectExportableLocalStorage()).sort();
    expect(collected).toEqual(EXPECTED_PHYSICAL);
  });

  it("键族按 keyPattern 展开真键采集，不把占位符当真键", () => {
    storageMock.safeGet.mockImplementation((key: string) => `v:${key}`);
    const out = collectExportableLocalStorage();
    // 真实键被采到
    expect(out[FAMILY.scene]).toBe(`v:${FAMILY.scene}`);
    expect(out[FAMILY.wsTag]).toBe(`v:${FAMILY.wsTag}`);
    // 候选集里没有的键族键不凭空造（不猜键名）
    expect("ysm-scene-cap-fog2" in out).toBe(false);
  });

  it("未登记 localStorage 的键一律不采（换机照样丢的那类键不得混进来）", () => {
    storageMock.safeGet.mockImplementation((key: string) => `v:${key}`);
    storageMock.safeKeys.mockReturnValue([...DEFAULT_CANDIDATES, "some-unregistered-key"]);
    const out = collectExportableLocalStorage();
    expect("some-unregistered-key" in out).toBe(false);
  });

  it("值缺失（safeGet 返回 null）的键跳过", () => {
    const k = exactExportableKeys[0];
    storageMock.safeGet.mockImplementation((key: string) =>
      key === k ? null : `v:${key}`,
    );
    const out = collectExportableLocalStorage();
    expect(k in out).toBe(false);
    expect(Object.keys(out).length).toBe(EXPECTED_PHYSICAL.length - 1);
  });

  it("存储不可用时静默返回空对象（ADR-044 隐私模式）", () => {
    storageMock.isStorageAccessible.mockReturnValue(false);
    expect(collectExportableLocalStorage()).toEqual({});
    expect(storageMock.safeGet).not.toHaveBeenCalled();
  });
});

describe("importedKeysFrom 写入键判定", () => {
  it("展开键族真键、忽略未登记键，与回写面同口径", () => {
    const k = exactExportableKeys[0];
    const keys = importedKeysFrom({
      [k]: "v1",
      [FAMILY.scene]: "v2",
      [FAMILY.wsKw]: "v3",
      "not-a-ledger-key": "x",
    });
    expect([...keys].sort()).toEqual([k, FAMILY.scene, FAMILY.wsKw].sort());
  });

  it("非字符串值不算写入键（导入文件里被塞入对象/数组键）", () => {
    const k = exactExportableKeys[0];
    expect(importedKeysFrom({ [k]: null as unknown as string })).toEqual([]);
    expect(importedKeysFrom(null)).toEqual([]);
  });
});

describe("applyImportedLocalStorage 回写面", () => {
  it("只回写台账可导出键；导出文件里未登记的键一律忽略", () => {
    const k = exactExportableKeys[0];
    const applied = applyImportedLocalStorage({
      [k]: "v1",
      "not-a-ledger-key": "x",
    });
    expect(applied).toBe(1);
    expect(storageMock.safeSet).toHaveBeenCalledWith(k, "v1");
    expect(storageMock.safeSet).toHaveBeenCalledTimes(1);
  });

  it("键族键回写到真实键名（不是占位符）", () => {
    const applied = applyImportedLocalStorage({
      [FAMILY.scene]: "a",
      [FAMILY.scene2]: "b",
      [FAMILY.wsTag]: "c",
      [FAMILY.wsKw]: "d",
    });
    expect(applied).toBe(4);
    expect(storageMock.safeSet).toHaveBeenCalledWith(FAMILY.scene, "a");
    expect(storageMock.safeSet).toHaveBeenCalledWith(FAMILY.wsTag, "c");
    expect(storageMock.safeSet).not.toHaveBeenCalledWith("ysm-scene-cap-*", expect.anything());
  });

  it("跳过非字符串值与 null（防导入文件里塞入对象/数组键）", () => {
    const k = exactExportableKeys[0];
    const applied = applyImportedLocalStorage({
      [k]: null as unknown as string,
    });
    expect(applied).toBe(0);
    expect(storageMock.safeSet).not.toHaveBeenCalled();
  });

  it("safeSet 落盘失败（隐私模式竞态/配额满）不计入 applied——「已应用 N 项」不得虚高", () => {
    const k = exactExportableKeys[0];
    const k2 = exactExportableKeys[1];
    storageMock.safeSet.mockImplementation((key: string): boolean => key !== k2);
    const applied = applyImportedLocalStorage({ [k]: "v1", [k2]: "v2" });
    expect(applied).toBe(1);
    expect(storageMock.safeSet).toHaveBeenCalledTimes(2);
  });

  it("存储不可用时一律不写并返回 0", () => {
    storageMock.isStorageAccessible.mockReturnValue(false);
    const k = exactExportableKeys[0];
    expect(applyImportedLocalStorage({ [k]: "v" })).toBe(0);
    expect(storageMock.safeSet).not.toHaveBeenCalled();
  });
});

// —— 编排链路（导入顺序 + 删除回滚）——
// 锐评 2026-10-16 定序：**磁盘先落盘、浏览器后回写**。原因：磁盘是真相源且可回滚（.bak-*），
// 浏览器侧无备份；且 Go 写盘成功但 watcher 重启失败时也会报错，旧「先写浏览器、报错回滚」
// 会把磁盘（新）与浏览器（旧）反向分叉。顺序翻过来之后不再需要「导入前拍照 + 失败回滚」，
// 失败面收窄为「磁盘新 / 浏览器旧」。下面锁三条不变量：
//   ① 导出把偏好 map 直传绑定（不是 JSON.stringify 双重编码）；状态行路径走 esc()；
//   ② 导入顺序 = ReadSettingsExport（预览）→ 确认 → ImportSettingsData（磁盘）→ safeSet（浏览器）。
//      锐评 P2②：改用**同一个** exp 贯穿预览与落盘，不再让 Go 对同一文件读两遍（旧
//      ImportSettingsFromFile 内部会再读一次），确认时的计数与实际写入必然一致；
//   ③ 磁盘侧失败时浏览器偏好**完全不写**（旧行为是写后再回滚，新行为是根本不写）。
function mountBackupRoot(): ShadowRoot {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <div id="set-backup-status"></div>
    <button id="set-backup-export"></button>
    <button id="set-backup-import"></button>
    <button id="set-backup-restore"></button>
    <button id="set-backup-open"></button>
  `;
  return root;
}

describe("initSettingsBackup 编排链路", () => {
  const EXPORT_PATH = 'C:\\ysm\\backup"<script>x</script>.json';
  const IMPORT_RES = {
    backupPath: "C:\\ysm\\ysm_config.json.bak-20260101-000000.000",
  };
  // ReadSettingsExport 返回真实 SettingsExport（struct，非指针），format 必填；
  // 前端防御判 `!exp?.format` 而非 `!exp`（P2-⑥：`!exp` 对对象恒 false，死代码）
  const EXP_FORMAT = "ysm-settings-export";

  beforeEach(() => {
    for (const fn of Object.values(appMocks)) fn.mockReset();
    busMock.emit.mockReset();
    toastMock.toast.mockReset();
    toastMock.toastError.mockReset();
    modalConfirmMock.modalConfirm.mockReset();
    // 默认确认：既有导入用例锁的是顺序与失败面，不锁确认弹窗本身（确认/取消走下面专用用例）
    modalConfirmMock.modalConfirm.mockResolvedValue(true);
    // 默认磁盘路径全部存在：既有导入用例锁的是顺序与失败面，不锁 P2⑤ 的缺失路径检测
    appMocks.DirectoryExists.mockResolvedValue(true);
    document.body.innerHTML = "";
  });

  it("导出把偏好 map 直传绑定（非 JSON.stringify），状态行路径走 esc()", async () => {
    appMocks.ExportSettingsJSON.mockResolvedValue(EXPORT_PATH);
    const root = mountBackupRoot();
    initSettingsBackup(root);
    root.getElementById("set-backup-export")!.click();

    await vi.waitFor(() => expect(appMocks.ExportSettingsJSON).toHaveBeenCalledTimes(1));
    // 契约：参数是对象（Go 签名已收 map），不是 stringify 后的 JSON 串
    const arg = appMocks.ExportSettingsJSON.mock.calls[0][0] as unknown;
    expect(typeof arg).toBe("object");
    expect(arg).not.toBeInstanceOf(String);
    // 契约：磁盘路径经 esc() 转义后才进 innerHTML（路径来自 Go，非可信常量）。
    // 断言安全属性而非实体名：innerHTML 回读时会把 `&quot;` 反序列化成 `"`（文本节点不需转义
    // 双引号），但 `<` `>` 必须保持 `&lt;` `&gt;`——关键是不可出现真实 `<script>` 元素
    const status = root.getElementById("set-backup-status")!;
    expect(status.querySelector("script")).toBeNull();
    expect(status.innerHTML).not.toContain("<script>");
    expect(status.textContent).toContain(EXPORT_PATH);
    // 复制按钮在状态行渲染后被挂上监听
    expect(status.querySelector("#set-backup-copy")).not.toBeNull();
  });

  it("导入顺序：读校验 → 磁盘落盘 → 浏览器回写（safeSet 晚于 ImportSettingsData）", async () => {
    appMocks.SelectImportFile.mockResolvedValue("C:/ysm/ysm-settings-export.json");
    appMocks.ReadSettingsExport.mockResolvedValue({
      format: EXP_FORMAT,
      localStorage: { "ui-font-size": "14" },
    });
    appMocks.ImportSettingsData.mockResolvedValue(IMPORT_RES);
    const root = mountBackupRoot();
    initSettingsBackup(root);
    root.getElementById("set-backup-import")!.click();

    await vi.waitFor(() => expect(storageMock.safeSet).toHaveBeenCalled());
    const readOrder = appMocks.ReadSettingsExport.mock.invocationCallOrder[0];
    const importOrder = appMocks.ImportSettingsData.mock.invocationCallOrder[0];
    const writeOrder = storageMock.safeSet.mock.invocationCallOrder[0];
    expect(readOrder).toBeLessThan(importOrder);
    expect(importOrder).toBeLessThan(writeOrder);
    // 提示条数用前端台账过滤后的 applied（Go 的 len(localStorage) 未过滤、会虚高）
    expect(storageMock.safeSet).toHaveBeenCalledWith("ui-font-size", "14");
    expect(busMock.emit).toHaveBeenCalledWith("settings:imported");
  });

  it("磁盘侧失败：浏览器偏好完全不写、不 emit（旧行为是写后再回滚）", async () => {
    appMocks.SelectImportFile.mockResolvedValue("C:/ysm/ysm-settings-export.json");
    appMocks.ReadSettingsExport.mockResolvedValue({
      format: EXP_FORMAT,
      localStorage: { "ui-font-size": "14" },
    });
    appMocks.ImportSettingsData.mockRejectedValue(new Error("磁盘写入失败"));
    const root = mountBackupRoot();
    initSettingsBackup(root);
    root.getElementById("set-backup-import")!.click();

    await vi.waitFor(() => expect(toastMock.toastError).toHaveBeenCalled());
    expect(storageMock.safeSet).not.toHaveBeenCalled();
    expect(storageMock.safeRemove).not.toHaveBeenCalled();
    expect(busMock.emit).not.toHaveBeenCalled();
  });

  it("用户取消文件选择：不读盘、不写盘、不 emit、不报错", async () => {
    appMocks.SelectImportFile.mockResolvedValue("");
    const root = mountBackupRoot();
    initSettingsBackup(root);
    root.getElementById("set-backup-import")!.click();

    await vi.waitFor(() => expect(appMocks.SelectImportFile).toHaveBeenCalledTimes(1));
    expect(appMocks.ReadSettingsExport).not.toHaveBeenCalled();
    expect(storageMock.safeSet).not.toHaveBeenCalled();
    expect(busMock.emit).not.toHaveBeenCalled();
    expect(toastMock.toastError).not.toHaveBeenCalled();
  });

  it("导入前弹确认（danger），确认后才走磁盘导入与浏览器回写（P1-①）", async () => {
    appMocks.SelectImportFile.mockResolvedValue("C:/ysm/ysm-settings-export.json");
    appMocks.ReadSettingsExport.mockResolvedValue({
      format: EXP_FORMAT,
      localStorage: { "ui-font-size": "14", "ui-card-density": "compact" },
    });
    appMocks.ImportSettingsData.mockResolvedValue(IMPORT_RES);
    const root = mountBackupRoot();
    initSettingsBackup(root);
    root.getElementById("set-backup-import")!.click();

    await vi.waitFor(() => expect(modalConfirmMock.modalConfirm).toHaveBeenCalledTimes(1));
    const arg = modalConfirmMock.modalConfirm.mock.calls[0][0] as {
      title: string;
      okText: string;
      danger: boolean;
    };
    // 破坏性整份覆盖 → 危险样式 + 自定义标题/按钮（ReadSettingsExport 的 Go 侧注释本就约定「前端先确认」）
    expect(arg.danger).toBe(true);
    expect(arg.title).toBeTruthy();
    expect(arg.okText).toBeTruthy();
    // 确认在先、磁盘落盘在后（未确认绝不动磁盘）
    expect(modalConfirmMock.modalConfirm.mock.invocationCallOrder[0]).toBeLessThan(
      appMocks.ImportSettingsData.mock.invocationCallOrder[0],
    );
    expect(storageMock.safeSet).toHaveBeenCalledTimes(2); // 待应用的两个键都回写
  });

  it("用户取消导入确认：磁盘与浏览器都不动、不 emit（P1-①）", async () => {
    appMocks.SelectImportFile.mockResolvedValue("C:/ysm/ysm-settings-export.json");
    appMocks.ReadSettingsExport.mockResolvedValue({
      format: EXP_FORMAT, localStorage: { "ui-font-size": "14" } });
    modalConfirmMock.modalConfirm.mockResolvedValue(false);
    const root = mountBackupRoot();
    initSettingsBackup(root);
    root.getElementById("set-backup-import")!.click();

    await vi.waitFor(() => expect(modalConfirmMock.modalConfirm).toHaveBeenCalledTimes(1));
    expect(appMocks.ImportSettingsData).not.toHaveBeenCalled();
    expect(storageMock.safeSet).not.toHaveBeenCalled();
    expect(busMock.emit).not.toHaveBeenCalled();
    expect(toastMock.toastError).not.toHaveBeenCalled();
  });

  // —— 导入前备份的消费入口（锐评 P2④）：.bak-* 此前只产出、UI 无浏览/恢复 ——
  const BACKUPS = [
    "C:\\ysm\\ysm_config.json.bak-20260102-000000.000",
    "C:\\ysm\\ysm_config.json.bak-20260101-000000.000",
  ];

  it("恢复最近备份：确认后调 RestoreSettingsBackup(最新备份) 并 emit settings:imported（P2-④）", async () => {
    appMocks.ListSettingsBackups.mockResolvedValue(BACKUPS);
    const root = mountBackupRoot();
    initSettingsBackup(root);
    root.getElementById("set-backup-restore")!.click();

    await vi.waitFor(() => expect(appMocks.RestoreSettingsBackup).toHaveBeenCalledTimes(1));
    expect(appMocks.RestoreSettingsBackup).toHaveBeenCalledWith(BACKUPS[0]);
    expect(busMock.emit).toHaveBeenCalledWith("settings:imported");
  });

  it("用户取消恢复确认：不调 RestoreSettingsBackup、不 emit（P2-④）", async () => {
    appMocks.ListSettingsBackups.mockResolvedValue(BACKUPS);
    modalConfirmMock.modalConfirm.mockResolvedValue(false);
    const root = mountBackupRoot();
    initSettingsBackup(root);
    root.getElementById("set-backup-restore")!.click();

    await vi.waitFor(() => expect(modalConfirmMock.modalConfirm).toHaveBeenCalledTimes(1));
    expect(appMocks.RestoreSettingsBackup).not.toHaveBeenCalled();
    expect(busMock.emit).not.toHaveBeenCalled();
  });

  it("无备份：提示 toast 且不调 RestoreSettingsBackup、不弹确认（P2-④）", async () => {
    appMocks.ListSettingsBackups.mockResolvedValue([]);
    const root = mountBackupRoot();
    initSettingsBackup(root);
    root.getElementById("set-backup-restore")!.click();

    await vi.waitFor(() => expect(toastMock.toast).toHaveBeenCalledTimes(1));
    expect(appMocks.RestoreSettingsBackup).not.toHaveBeenCalled();
    expect(modalConfirmMock.modalConfirm).not.toHaveBeenCalled();
  });

  it("打开备份目录：调 OpenFolder(配置目录)，无备份也能打开（P3⑥ 修口）", async () => {
    appMocks.GetConfigPath.mockResolvedValue("C:\\ysm\\ysm_config.json");
    appMocks.ListSettingsBackups.mockResolvedValue([]); // 无备份——按钮不再自缚
    const root = mountBackupRoot();
    initSettingsBackup(root);
    root.getElementById("set-backup-open")!.click();

    await vi.waitFor(() => expect(appMocks.OpenFolder).toHaveBeenCalledTimes(1));
    expect(appMocks.OpenFolder).toHaveBeenCalledWith("C:\\ysm");
    expect(toastMock.toastError).not.toHaveBeenCalled();
  });

  it("平台数据根缺失（GetConfigPath 空）：提示不可用、不调 OpenFolder（P3⑥ 边界）", async () => {
    appMocks.GetConfigPath.mockResolvedValue("");
    const root = mountBackupRoot();
    initSettingsBackup(root);
    root.getElementById("set-backup-open")!.click();

    await vi.waitFor(() => expect(toastMock.toast).toHaveBeenCalledTimes(1));
    expect(appMocks.OpenFolder).not.toHaveBeenCalled();
  });

  it("恢复确认文案中的路径不被双重转义（P3④）", async () => {
    appMocks.ListSettingsBackups.mockResolvedValue(["C:\\a&b\\ysm_config.json.bak-20260102-000000.000"]);
    const root = mountBackupRoot();
    initSettingsBackup(root);
    root.getElementById("set-backup-restore")!.click();

    await vi.waitFor(() => expect(modalConfirmMock.modalConfirm).toHaveBeenCalledTimes(1));
    const arg = modalConfirmMock.modalConfirm.mock.calls[0][0] as { message: string };
    // modal-confirm 内部统一 esc()，调用方给原始值——& 在 message 里必须是裸的
    expect(arg.message).toContain("C:\\a&b\\");
    expect(arg.message).not.toContain("&amp;");
  });

  it("导入的路径在本机不存在：状态行给缺失警告与「去环境页」按钮，点击切到 env tab（P2⑤ 增强）", async () => {
    appMocks.SelectImportFile.mockResolvedValue("C:/ysm/ysm-settings-export.json");
    appMocks.ReadSettingsExport.mockResolvedValue({
      format: EXP_FORMAT,
      localStorage: { "ui-font-size": "14" },
      appConfig: { filesRoot: "C:/old-root", mcRoot: "C:/old-mc", customRoots: null },
    });
    appMocks.ImportSettingsData.mockResolvedValue(IMPORT_RES);
    appMocks.DirectoryExists.mockResolvedValue(false);
    // 造一个「环境」tab 按钮（mountBackupRoot 只挂备份卡，无 tab 栏），验证跳转是 click 驱动
    const root = mountBackupRoot();
    const envTab = document.createElement("button");
    envTab.className = "stg-tab";
    envTab.setAttribute("data-tab", "env");
    const clicked = vi.fn();
    envTab.addEventListener("click", clicked);
    root.appendChild(envTab);
    initSettingsBackup(root);
    root.getElementById("set-backup-import")!.click();

    await vi.waitFor(() => expect(appMocks.DirectoryExists).toHaveBeenCalledTimes(2));
    const status = root.getElementById("set-backup-status")!;
    expect(status.textContent).toContain("C:/old-root");
    const gotoBtn = status.querySelector("#set-backup-open-env") as HTMLButtonElement | null;
    expect(gotoBtn).not.toBeNull();
    gotoBtn!.click();
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("导入的路径在本机全部存在：状态行不出现缺失警告按钮（P2⑤ 增强）", async () => {
    appMocks.SelectImportFile.mockResolvedValue("C:/ysm/ysm-settings-export.json");
    appMocks.ReadSettingsExport.mockResolvedValue({
      format: EXP_FORMAT,
      localStorage: { "ui-font-size": "14" },
      appConfig: { filesRoot: "C:/ok", mcRoot: "", customRoots: null },
    });
    appMocks.ImportSettingsData.mockResolvedValue(IMPORT_RES);
    const root = mountBackupRoot();
    initSettingsBackup(root);
    root.getElementById("set-backup-import")!.click();

    await vi.waitFor(() => expect(storageMock.safeSet).toHaveBeenCalled());
    expect(
      root.getElementById("set-backup-status")!.querySelector("#set-backup-open-env"),
    ).toBeNull();
  });
});