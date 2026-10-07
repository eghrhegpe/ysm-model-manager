// ===== web-fs 重命名/删除/移动复制（ADR-040 职责切分延续，自 web-fs.ts §11/§12/§13 拆出）=====
// 来源：web-fs.ts L474-797（INVALID_NAME_CHARS / assertValidRenameName / deleteWebModel /
// renameWebDir / renameWebFile / webMoveTargetName / rollbackWritten / collectRekeyOps /
// buildRekeyDeleteOps / rekeyWebModelGroup / moveOrCopyWebModel）。
// 职责：模型组/组内文件的重命名（rekey）、整组删除、整组移动/复制——全部为「写
// IndexedDB + 按 store 单事务」的变更原语。公共 API 由 web-fs.ts 门面 re-export 保持
// 原路径不变；本模块不触碰读取装配（web-fs-read.ts）与扫描/搜索（web-fs-scan.ts）。

import { t } from "@/core/i18n/t.ts";
import { type IdbOp, idbDel, idbGet, idbKeys, idbTx } from "./idb.ts";
import { isWebPath, parseWebDirPath, WEB_ROOT } from "./web-common.ts";
import { parseWebModelDir, parseWebModelPath } from "./web-fs-read.ts";
import { dirKey, fileKey } from "./web-fs-shared.ts";

// ===== §11 重命名校验 =====
// --- 重命名校验（对齐桌面 fileops.RenameDir/RenameFile：非法字符/空名/穿越拒绝）---
// 缺校验的后果：newName 含 / 或为空会制造坏 key（dir:ysm/a/b:），scanWebModels 仍能扫到，
// 但 parseWebModelDir 三段解析失败 → 该模型变成幽灵（无法删除/再次重命名），且重命名到
// 已存在模型名会静默覆盖 dir key 合并数据（桌面 os.Rename 对目标已存在报错，web 必须对齐）
const INVALID_NAME_CHARS = /[\\/:*?"<>|]/;

/** 校验重命名目标名（对齐桌面 fileops.go 非法字符 + 空名 + 路径段校验，非法则抛错） */
function assertValidRenameName(newName: string, kind: "目录" | "文件"): void {
  const kindLabel = kind === "目录" ? t("webFs.kindDir") : t("webFs.kindFile");
  const n = (newName || "").trim();
  if (!n) throw new Error(t("webFs.renameEmptyName", { kind: kindLabel }));
  if (INVALID_NAME_CHARS.test(n))
    throw new Error(t("webFs.renameInvalidChars", { kind: kindLabel }));
  if (n === "." || n === "..")
    throw new Error(t("webFs.renameInvalidPathSegment", { kind: kindLabel }));
}

// ===== §12 删除模型组 =====
// --- 删除模型组（dir + 所有 file + 元数据标记）---
export async function deleteWebModel(type: string, name: string): Promise<void> {
  // ADR-040 治理：整组删除收敛为 idbTx——dir + 全部 file + ban/tags 标记
  // files / config 分属两个 store，各自单事务（IDB 单事务仅限单 store）。
  // 跨 store 仍非原子：files 事务提交后 config 事务失败会留 ban/tags 孤儿标记，
  // 调用方需 best-effort 重试清理。
  const fileOps: IdbOp[] = [{ kind: "del", key: dirKey(type, name) }];
  const fks = await idbKeys("files", `file:${type}/${name}/`);
  for (const k of fks) fileOps.push({ kind: "del", key: k });
  const cfgOps: IdbOp[] = [];
  // 清理 ban/tags 标记（随主事务一起，原子）
  for (const prefix of ["ban:", "tags:"]) {
    const keys = await idbKeys("config", `${prefix}/web/${type}/${name}/`);
    for (const k of keys) cfgOps.push({ kind: "del", key: k });
  }
  await idbTx("files", fileOps);
  if (cfgOps.length) await idbTx("config", cfgOps);
}

// --- 重命名模型目录（dir + file + 标记整组 rekey）---
// 校验（目标已存在 / 源缺失）后复用 rekeyWebModelGroup 原语完成整组 rekey，
// 消除与 moveOrCopy 重复的内联 rekey 循环（dir + 全部 file + ban/tags，两阶段事务性）。
export async function renameWebDir(oldPath: string, newName: string): Promise<void> {
  const di = parseWebModelDir(oldPath);
  if (!di) throw new Error(t("webFs.renameInvalidPath", { path: oldPath }));
  const { type, name } = di;
  assertValidRenameName(newName, "目录");
  const finalName = newName.trim();
  // P-A 多段 name：重命名只替换末段，保留父路径（分类1/狐狸 → 分类1/大猫）
  const parent = name.includes("/") ? name.slice(0, name.lastIndexOf("/") + 1) : "";
  const newNameFull = parent + finalName;
  // 目标已存在（含重命名为同名）：对齐桌面「目标已存在」拒绝，防静默覆盖合并两模型数据
  if ((await idbGet("files", dirKey(type, newNameFull))) !== undefined) {
    throw new Error(t("webFs.renameTargetExists", { path: `${WEB_ROOT}/${type}/${newNameFull}` }));
  }
  // 旧模型必须存在（对齐桌面 os.Rename 源不存在报错，拒绝静默 no-op）
  if ((await idbGet("files", dirKey(type, name))) === undefined) {
    throw new Error(t("webFs.renameModelMissing", { path: oldPath }));
  }
  await rekeyWebModelGroup(type, name, newNameFull, true);
}

// --- 重命名单个文件（模型组内某文件 rekey，保留 .ban 后缀语义由调用方负责）---
export async function renameWebFile(oldPath: string, newName: string): Promise<void> {
  const pm = await parseWebModelPath(oldPath);
  if (!pm) throw new Error(t("webFs.renameInvalidPath", { path: oldPath }));
  const { type, name, rel } = pm;
  assertValidRenameName(newName, "文件");
  const finalName = newName.trim();
  // ysm.json 是模型目录清单（游戏按目录名识别模型）：禁止单文件改名，
  // 否则 scanWebModels 主文件 rank 从 2 掉到 0 → 模型从列表中消失（对齐桌面 fileops.RenameFile ADR-038 D3）
  if (rel.toLowerCase() === "ysm.json") {
    throw new Error(t("webFs.renameYsmJsonForbidden"));
  }
  const oldKey = fileKey(type, name, rel);
  // P-A 组内 rel 可含子目录：重命名只替换 rel 末段文件名，保留目录前缀（tex/face.png → tex/eye.png）
  const relDir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/") + 1) : "";
  const newKey = fileKey(type, name, `${relDir}${finalName}`);
  // 同名（含 trim 归一后）：无事可做，直接返回——不得走下方 idbSet+idbDel（同 key 自删 = 数据丢失回归）
  if (newKey === oldKey) return;
  // 目标已存在：对齐桌面「目标已存在」拒绝，防静默覆盖目标文件内容
  if ((await idbGet("files", newKey)) !== undefined) {
    throw new Error(
      t("webFs.renameTargetExists", { path: `${WEB_ROOT}/${type}/${name}/${finalName}` }),
    );
  }
  // 旧文件必须存在（对齐桌面 RenameFile 源不存在报错，拒绝静默 no-op）
  // 单次读取兼作「存在校验 + rekey 取值」，消除同 key 双读
  const val = await idbGet("files", oldKey);
  if (val === undefined) throw new Error(t("webFs.renameModelMissing", { path: oldPath }));
  // 单事务「写新+删旧」，避免两步非原子崩溃留双 key
  await idbTx("files", [
    { kind: "put", key: newKey, value: val },
    { kind: "del", key: oldKey },
  ]);
  // 移动按全路径 key 的 ban/tags 标记
  // 用函数替换绕过 finalName 含 $&/$1 等特殊序列时的展开（P1 注入修复）
  const newPath = oldPath.replace(/\/[^/]+$/, () => `/${finalName}`);
  for (const prefix of ["ban:", "tags:"]) {
    const oldMk = `${prefix}${oldPath}`;
    const newMk = `${prefix}${newPath}`;
    const mv = await idbGet("config", oldMk);
    if (mv !== undefined) {
      await idbTx("config", [
        { kind: "put", key: newMk, value: mv },
        { kind: "del", key: oldMk },
      ]);
    }
  }
}

// --- 模型移动/复制（组级 rekey；对齐桌面 fileops.MoveModelFile/CopyModelFile，go/fileops/fileops.go:138/220）---
// 桌面语义：MoveModelFile(src, dstDir) 把 src（文件/目录）移入 dstDir 并保留原名
// （dst = Join(dstDir, Base(src))）；CopyModelFile 同语义但保留源。
// web 适配：模型库以「模型组」为最小单位（dir:<type>/<name>: + file:<type>/<name>/<rel>，
// 无桌面「游离文件」概念）——src 为组内任意文件路径或组目录路径时，均整组移动/复制
// （dir + 全部 file + ban/tags 标记，rekey 对齐 renameWebDir 既有处理）。
// dstDir = /web/<type>/<目标文件夹>（resolveDstDir 由 GetRepoRoot + 用户输入拼接），
// 目标模型名 = <目标文件夹>/<src 组名末段>（对齐 Go 的 dst=Join(dstDir, Base(src))，
// 多段组名只保留末段，父路径随移动丢弃，如 分类1/狐狸 → 作者A/狐狸）。
// 校验（对齐 Go 错误语义）：src/dstDir 非空、dstDir 须为合法 /web/<type>/<目标> 目录、
// 源须存在（Go os.Stat 源报错）、目标不得位于源内（自嵌套，Go「目标目录不能位于源目录内」）、
// 目标已存在拒绝（Go「目标已存在」防静默覆盖）。

/**
 * 目标目录 + 源组名 → 新模型组名（对齐 Go dst=Join(dstDir, Base(src))：
 * 目标文件夹 + src 组名末段）。
 */
function webMoveTargetName(dstName: string, srcName: string): string {
  const srcBase = srcName.includes("/") ? srcName.slice(srcName.lastIndexOf("/") + 1) : srcName;
  return `${dstName}/${srcBase}`;
}

/**
 * 模型组整组 rekey：旧组名 → 新组名（dir + 全部 file + ban/tags 标记）。
 * move=true 移动（删旧 key）；move=false 复制（保留旧 key = 读旧写新）。
 * 审核 A #1（事务性）：两阶段——先写全部新 key（不删旧），全成功后才删旧 key；
 * 中途失败只回滚本次新建（best-effort），旧 key 完好 → 无 dir/file 分裂残留。
 * ADR-040 治理：每阶段按 store 收敛为单事务（idbTx）——files 一批、config 一批，
 * 单个 store 内全有或全无（IDB 单事务仅限单 store；跨 files/config 仍两段，符合
 * IDB 能力上限）。原实现逐 key idbSet/idbDel 各开事务，中途崩溃会留新旧 key 并存。
 */

/** 抽出降复杂度/复用：rekey 阶段一失败时的 best-effort 回滚——按 store 分桶删除新建 key。
 *  P1-2 修复：writtenFiles/writtenCfg 分桶对号入座，否则 config store 的 ban/tags key
 *  会被错删到 files store（no-op）→ 孤儿标记。顺序：先 files 倒序、再 config 倒序。 */
async function rollbackWritten(writtenFiles: string[], writtenCfg: string[]): Promise<void> {
  for (const k of writtenFiles.reverse()) {
    try {
      await idbDel("files", k);
    } catch {
      /* best-effort */
    }
  }
  for (const k of writtenCfg.reverse()) {
    try {
      await idbDel("config", k);
    } catch {
      /* best-effort */
    }
  }
}

/** 抽出降复杂度/复用：rekey 阶段一——读旧 key 并生成「写新 key」ops，连同回滚分桶与
 *  阶段二删旧所需数据一并返回。两阶段事务边界由调用方保持（先写全新 key，全成功后才删旧）。
 *  P1 修复：config 扫描结果缓存到 cfgKeysCache 供阶段二复用（避免重复扫描 config store）。 */
async function collectRekeyOps(
  type: string,
  oldName: string,
  newName: string,
): Promise<{
  fileOps: IdbOp[];
  cfgOps: IdbOp[];
  writtenFiles: string[];
  writtenCfg: string[];
  oldFileKeys: string[];
  cfgKeysCache: Map<string, string[]>;
}> {
  const fileOps: IdbOp[] = [];
  const cfgOps: IdbOp[] = [];
  const writtenFiles: string[] = [];
  const writtenCfg: string[] = [];
  const dv = await idbGet("files", dirKey(type, oldName));
  if (dv !== undefined) {
    fileOps.push({
      kind: "put",
      key: dirKey(type, newName),
      value: { ...(dv as Record<string, unknown>), name: newName },
    });
    writtenFiles.push(dirKey(type, newName));
  }
  const oldPrefix = `file:${type}/${oldName}/`;
  const fks = await idbKeys("files", oldPrefix);
  for (const k of fks) {
    const rel = k.slice(oldPrefix.length);
    const val = await idbGet("files", k);
    if (val !== undefined) {
      const nk = fileKey(type, newName, rel);
      fileOps.push({ kind: "put", key: nk, value: val });
      writtenFiles.push(nk);
    }
  }
  // P1 修复：收集 config keys 供阶段二复用（避免重复扫描 config store）
  const cfgKeysCache = new Map<string, string[]>();
  for (const prefix of ["ban:", "tags:"]) {
    const scanPrefix = `${prefix}/web/${type}/${oldName}/`;
    const keys = await idbKeys("config", scanPrefix);
    cfgKeysCache.set(scanPrefix, keys);
    for (const k of keys) {
      const suffix = k.slice(scanPrefix.length);
      const val = await idbGet("config", k);
      if (val !== undefined) {
        const nk = `${prefix}/web/${type}/${newName}/${suffix}`;
        cfgOps.push({ kind: "put", key: nk, value: val });
        writtenCfg.push(nk);
      }
    }
  }
  return { fileOps, cfgOps, writtenFiles, writtenCfg, oldFileKeys: fks, cfgKeysCache };
}

/** 抽出降复杂度/复用：rekey 阶段二——基于阶段一已扫旧 key 生成删旧 ops（move 时）。
 *  config 删复用阶段一缓存的 cfgKeysCache（避免重复扫描 config store）。 */
function buildRekeyDeleteOps(
  type: string,
  oldName: string,
  oldFileKeys: string[],
  cfgKeysCache: Map<string, string[]>,
): { delFileOps: IdbOp[]; delCfgOps: IdbOp[] } {
  const delFileOps: IdbOp[] = [{ kind: "del", key: dirKey(type, oldName) }];
  for (const k of oldFileKeys) delFileOps.push({ kind: "del", key: k });
  // 阶段二 config 删：复用阶段一已缓存的 keys（避免重复扫描 config store）
  const delCfgOps: IdbOp[] = [];
  for (const [, keys] of cfgKeysCache) {
    delCfgOps.push(...keys.map((k) => ({ kind: "del" as const, key: k })));
  }
  return { delFileOps, delCfgOps };
}

async function rekeyWebModelGroup(
  type: string,
  oldName: string,
  newName: string,
  move: boolean,
): Promise<void> {
  // P1-2 修复（分桶语义见 rollbackWritten）：writtenNew 按 store 分桶——回滚时必须对号入座，
  // 否则 config store 的 ban/tags key 会被错删到 files store（no-op）→ 孤儿标记
  const writtenFiles: string[] = [];
  const writtenCfg: string[] = [];
  try {
    // 阶段一：写新 key（dir + file + 标记），全成功才进阶段二；按 store 单事务提交
    // ⚠️ 读-改-写窗口：idbKeys 扫旧 key + 逐个 idbGet 读旧值与下方 idbTx 写新值
    // 之间无事务包裹。若并发的 renameOrCopy 同时改写同一组 key，读到的旧值可能与
    // 写入时的新值不一致。当前 web 端单用户操作，并发概率低；多 tab 并发时可能残留。
    const {
      fileOps,
      cfgOps,
      writtenFiles: wf,
      writtenCfg: wc,
      oldFileKeys,
      cfgKeysCache,
    } = await collectRekeyOps(type, oldName, newName);
    // 阶段一全部读 + 生成 ops 成功后才并入外层回滚桶（与原始「边读边 push 到
    // writtenX」语义对齐：未提交的 key 回滚为 no-op，已提交的 key 才被真实删除）
    writtenFiles.push(...wf);
    writtenCfg.push(...wc);
    if (fileOps.length) await idbTx("files", fileOps);
    if (cfgOps.length) await idbTx("config", cfgOps);
    // 阶段二：全部新 key 写入成功 → 删旧 key（move 时），同样按 store 单事务
    if (move) {
      const { delFileOps, delCfgOps } = buildRekeyDeleteOps(
        type,
        oldName,
        oldFileKeys,
        cfgKeysCache,
      );
      await idbTx("files", delFileOps);
      // 阶段二 config 删：复用阶段一已缓存的 keys（避免重复扫描 config store）
      if (delCfgOps.length) await idbTx("config", delCfgOps);
    }
  } catch (e) {
    await rollbackWritten(writtenFiles, writtenCfg);
    throw e;
  }
}

// ===== §13 移动/复制（组级 rekey）=====
/**
 * MoveModelFile / CopyModelFile 共用：解析 + 校验 + 组级 rekey。
 * move=true 移动（删源）；move=false 复制（保留源）。失败 reject（对齐 Go error → binding reject）。
 */
export async function moveOrCopyWebModel(
  src: string,
  dstDir: string,
  move: boolean,
): Promise<void> {
  // 非 /web/ 路径 → 无效源路径（对齐 Go「源文件必须在仓库内」）；
  // 合法 /web/ 路径但模型组不存在（parseWebModelPath 反向匹配不到 dir key）→ 模型不存在
  if (!isWebPath(src)) throw new Error(t("webFs.moveInvalidSrc", { path: src }));
  const pm = await parseWebModelPath(src);
  if (!pm) throw new Error(t("webFs.moveModelMissing", { path: src }));
  const { type, name } = pm;
  // dstDir 须为 /web/<type>/<目标> 目录形态（目标名非空由 parseWebDirPath 保证）
  const di = parseWebDirPath(dstDir);
  if (!di) throw new Error(t("webFs.moveInvalidDstDir", { path: dstDir }));
  const dstName = di.name.trim();
  if (!dstName) throw new Error(t("webFs.moveInvalidDstDir", { path: dstDir }));
  // 审核 A #2：目标文件夹名 + 源组名末段分别做非法字符/空名校验（拼接后的 newName
  // 是多段路径含 "/" 合法，assertValidRenameName 禁 "/" 只适用于单段重命名）
  assertValidRenameName(dstName, "目录");
  // 目标模型名 = 目标文件夹/<src 组名末段>（对齐 Go dst=Join(dstDir, Base(src))）
  const newName = webMoveTargetName(dstName, name);
  const srcBase = newName.slice(newName.lastIndexOf("/") + 1);
  assertValidRenameName(srcBase, "目录");
  // 自嵌套检查（目标**严格**位于源内）须先于「目标已存在」——对齐 Go fileops.go:313-320
  //（自嵌套）先于 :326（目标已存在）：两条同时命中时 Go 报的是自嵌套。
  // 注意 `newName === name`（目标 == 源自身）不属于自嵌套：Go 侧此时 dstDir 是 src 的父
  // 目录，relToSrc 为 ".." 不算嵌套，dst=Join(dstDir,Base(src))=src 命中 stat 存在报
  // 「目标已存在」——故等值分支必须留在下方存在性检查里，不可随此支上移。
  if (newName.startsWith(`${name}/`)) {
    throw new Error(t("webFs.moveNested", { path: dstDir }));
  }
  // 防覆盖：目标组已存在 → 拒绝（对齐 Go「目标已存在」；含目标 == 源自身移动——
  // Go 对 dst===src 命中 stat(dst) 存在报「目标已存在」，web 侧 dir key 即源自身）
  if ((await idbGet("files", dirKey(type, newName))) !== undefined) {
    throw new Error(t("webFs.moveTargetExists", { path: `${WEB_ROOT}/${type}/${newName}` }));
  }
  await rekeyWebModelGroup(type, name, newName, move);
}
