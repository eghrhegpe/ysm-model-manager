// ===== 多模型同框：场景注册表（ADR-093）=====
// 单一事实来源：替代裸 allBuilt 数组，承载每个已加载模型的元数据，
// 供相机多包围盒累加 / dispatch 拾取归属 / GPU 上限 / 未来 dock 模型列表 UI 消费。
//
// 生命周期：随活跃 3D 会话。mount-preview-core 新鲜 mount（!cooperate）先
// cleanupPreview() → fullCleanup 内 sceneRegistry.reset()；会话关闭同样 reset。
// （allBuilt 仍负责逐条 dispose，注册表与之并存，不重复释放。）
//
// root 捕获用「build 前后 scene.children 差量」法（适配器无关），详见 ADR-093 §2.2。
import * as THREE from "three";
import type { PreviewScene } from "./mount-preview-core.ts";
import type { PreviewMenuNode } from "../menu/node-types.ts";
import type { BoneSelectInfo, BoneMaps } from "../model3d.ts";

/** 菜单句柄最小接口（解耦 preview-menu/core.ts 运行时依赖） */
interface MenuItemsSink {
  setAdapterItems(items: PreviewMenuNode[]): void;
}

/** 单条模型记录（角色面板 fillRoles 消费：path/rtype/menuItems/roots） */
export interface ModelEntry {
  id: string;
  path: string;
  /** 资源类型（如 ysm/EntityPlayer/vrm），取自 opts.rtype ?? adapter.id */
  rtype: string;
  /** build 前后 scene.children 差量捕获的顶层根节点（隐藏/取景/归属用；差量漏捕时为 []） */
  roots: THREE.Object3D[];
  /** 内容层句柄（dispose 等；与 allBuilt 同一引用） */
  built: PreviewScene;
  visible: boolean;
  /** 骨骼映射（dispatch 用；未接入格式为 null） */
  boneMaps: BoneMaps | null;
  /** 该模型声明式根菜单专属项（selectModel 时换菜单用；未接入为 null） */
  menuItems: PreviewMenuNode[] | null;
  /** 多模型下由统一拾取器调用：点中该模型骨骼时打开其面板（ADR-093 T5） */
  onBonePick: ((boneId: string) => void) | null;
}

/** 沿父链判定 obj 是否为 root 的后代（含自身） */
function isDescendant(obj: THREE.Object3D | null, root: THREE.Object3D): boolean {
  let n: THREE.Object3D | null = obj;
  while (n) {
    if (n === root) return true;
    n = n.parent;
  }
  return false;
}

type RegisterInput = {
  path: string;
  rtype: string;
  roots: THREE.Object3D[];
  built: PreviewScene;
  boneMaps?: BoneMaps | null;
  menuItems?: PreviewMenuNode[] | null;
  onBonePick?: ((boneId: string) => void) | null;
};

function mdSrDedupByExplicitKey(
  byAuthor: Map<string, string>,
  byName: Map<string, string>,
  input: RegisterInput
): string | null {
  const existingByPath = byAuthor.get(input.path);
  if (existingByPath) return existingByPath;
  const nameKey = `${input.rtype}::${input.path}`;
  const existingByName = byName.get(nameKey);
  if (existingByName) return existingByName;
  return null;
}

function mdSrBuildEntryFromInput(id: string, input: RegisterInput): ModelEntry {
  return {
    id,
    path: input.path,
    rtype: input.rtype,
    roots: input.roots,
    built: input.built,
    visible: true,
    boneMaps: input.boneMaps ?? null,
    menuItems: input.menuItems ?? null,
    onBonePick: input.onBonePick ?? null,
  };
}

function mdSrIndexIntoMaps(
  entries: Map<string, ModelEntry>,
  byAuthor: Map<string, string>,
  byName: Map<string, string>,
  entry: ModelEntry
): void {
  entries.set(entry.id, entry);
  byAuthor.set(entry.path, entry.id);
  byName.set(`${entry.rtype}::${entry.path}`, entry.id);
}

class SceneRegistry {
  private entries = new Map<string, ModelEntry>();
  private byAuthor = new Map<string, string>();
  private byName = new Map<string, string>();
  private seq = 0;
  private activeId: string | null = null;
  private menuSink: MenuItemsSink | null = null;

  /** 重置（会话开始/关闭时调用，清空全部模型记录） */
  reset(): void {
    this.entries.clear();
    this.byAuthor.clear();
    this.byName.clear();
    this.seq = 0;
    this.activeId = null;
    this.menuSink = null;
  }

  /**
   * 注册一个模型，返回其 id（同时置为活跃模型）。
   * roots 由调用方经 scene.children 差量捕获传入；boneMaps/menuItems 可选。
   */
  register(input: RegisterInput): string {
    const existing = mdSrDedupByExplicitKey(this.byAuthor, this.byName, input);
    if (existing) {
      this.activeId = existing;
      return existing;
    }
    const id = `m${++this.seq}`;
    const entry = mdSrBuildEntryFromInput(id, input);
    mdSrIndexIntoMaps(this.entries, this.byAuthor, this.byName, entry);
    this.activeId = id;
    return id;
  }

  unregister(id: string): void {
    const e = this.entries.get(id);
    if (e) {
      this.byAuthor.delete(e.path);
      this.byName.delete(`${e.rtype}::${e.path}`);
    }
    this.entries.delete(id);
    if (this.activeId === id) {
      const rest = [...this.entries.keys()];
      this.activeId = rest.length ? rest[rest.length - 1] : null;
    }
  }

  getAll(): ModelEntry[] {
    return [...this.entries.values()];
  }
  getVisible(): ModelEntry[] {
    return this.getAll().filter((e) => e.visible);
  }
  get(id: string): ModelEntry | undefined {
    return this.entries.get(id);
  }
  /** 当前已加载模型数量 */
  count(): number {
    return this.entries.size;
  }

  /** 设置/取消可见性（同时切换其 roots 的 Object3D.visible） */
  setVisible(id: string, v: boolean): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.visible = v;
    for (const r of e.roots) r.visible = v;
  }

  /** 可见模型的全部根节点（相机累加取景用） */
  visibleRoots(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const e of this.getVisible()) out.push(...e.roots);
    return out;
  }

  /** 设置菜单句柄（会话级，供 selectModel 换菜单） */
  setMenuSink(sink: MenuItemsSink | null): void {
    this.menuSink = sink;
  }

  /** 置活跃模型 + 若有菜单项则换菜单（dispatch 点中时调用） */
  setActive(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.activeId = id;
    if (this.menuSink && e.menuItems) this.menuSink.setAdapterItems(e.menuItems);
  }
  getActiveId(): string | null {
    return this.activeId;
  }

  /**
   * 给定被射线击中的 Object3D，沿父链反查归属哪个已注册模型（root 包容）。
   * 命中则返回该模型记录，否则 undefined。
   */
  pickModelByObject(obj: THREE.Object3D | null): ModelEntry | undefined {
    if (!obj) return undefined;
    for (const e of this.entries.values()) {
      for (const r of e.roots) {
        if (isDescendant(obj, r)) return e;
      }
    }
    return undefined;
  }
}

/** 模块级单例（随活跃会话 reset） */
export const sceneRegistry = new SceneRegistry();

/** 同场景最大模型数（超量追加被拒，ADR-093 T6） */
export const MAX_MODELS = 8;
