// ===== parse-java-model.ts — MC Java 版 block/item 模型解析器（ADR-080）=====
// POC `poc/mc-java-model/parse-java-model.mjs` 纯 TS 移植（21/21 断言验证口径）。
// 零 Three/DOM 依赖（可单测）。加载抽象为 `PackEntryReader`（Go binding 返回 base64）。
//
// 坐标/UV 口径（POC 锁定，勿改）：
// - 模型坐标 0-16 像素（x 东 / y 上 / z 南），渲染层 ÷16 转米
// - face.uv 为纹理像素坐标，原点纹理左上、v 向下（MC 语义）
// - 输出 UV 为 Three.js 域（flipY=true 加载纹理）：v_three = 1 - v_mc
// - 顶点顺序/UV 角映射：prismarine-viewer（与 MC 渲染一致）

import { b64ToBytes } from "./base64.ts";

// ===== 面 → 4 顶点（[x?, y?, z?, u角, v角]，u/v 为 MC 语义 0/1 角）=====
const ELEM_FACES: Record<string, { dir: [number, number, number]; corners: [number, number, number, number, number][] }> = {
  up: {
    dir: [0, 1, 0],
    corners: [[0, 1, 1, 0, 1], [1, 1, 1, 1, 1], [0, 1, 0, 0, 0], [1, 1, 0, 1, 0]],
  },
  down: {
    dir: [0, -1, 0],
    corners: [[1, 0, 1, 0, 1], [0, 0, 1, 1, 1], [1, 0, 0, 0, 0], [0, 0, 0, 1, 0]],
  },
  east: {
    dir: [1, 0, 0],
    corners: [[1, 1, 1, 0, 0], [1, 0, 1, 0, 1], [1, 1, 0, 1, 0], [1, 0, 0, 1, 1]],
  },
  west: {
    dir: [-1, 0, 0],
    corners: [[0, 1, 0, 0, 0], [0, 0, 0, 0, 1], [0, 1, 1, 1, 0], [0, 0, 1, 1, 1]],
  },
  north: {
    dir: [0, 0, -1],
    corners: [[1, 0, 0, 0, 1], [0, 0, 0, 1, 1], [1, 1, 0, 0, 0], [0, 1, 0, 1, 0]],
  },
  south: {
    dir: [0, 0, 1],
    corners: [[0, 0, 1, 0, 1], [1, 0, 1, 1, 1], [0, 1, 1, 0, 0], [1, 1, 1, 1, 0]],
  },
};

// ===== 类型 =====

/** 单面解析产物（像素坐标 + Three 域 UV） */
export interface JavaModelFace {
  face: string;
  dir: [number, number, number];
  /** 4 顶点 × 3 = 12 个，模型像素坐标（0-16） */
  verts: number[];
  /** 4 顶点 × 2 = 8 个，Three 域 UV（v 已翻转） */
  uv: number[];
  /** 纹理条目路径（assets/<ns>/textures/<path>.png）或 null（纯色/缺失） */
  texEntry: string | null;
  /** 纯色纹理 #RRGGBB（texEntry 为 null 时可能非空） */
  texColor: string | null;
  tintindex: number | null;
  cullface: string | null;
}

export interface JavaModelResult {
  /** 展示名（去命名空间/扩展名/block|item 前缀） */
  name: string;
  /** 完整条目路径 assets/<ns>/models/.../xxx.json */
  entry: string;
  faces: JavaModelFace[];
  elementCount: number;
  ambientocclusion: boolean;
  /** 合并后的 display（含 parent 继承） */
  display: Record<string, unknown>;
  gui_light: string | null;
}

/** 条目读取器：Go binding ReadPackEntry 包装（返回 base64 或 null） */
export type PackEntryReader = (entry: string) => Promise<string | null>;

// ===== 工具 =====

/** base64 → UTF-8 文本（JSON 含中文描述等，不能直接用 atob） */
function b64ToText(b64: string): string {
  return new TextDecoder("utf-8").decode(b64ToBytes(b64));
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** 模型名 → 条目路径（无命名空间默认 minecraft） */
export function modelEntryFor(name: string): string {
  const n = name.includes(":") ? name : `minecraft:${name}`;
  const [ns, p] = n.split(":");
  return `assets/${ns}/models/${p}.json`;
}

/** 统一入口：完整条目路径原样返回；模型名（parent 引用）走 modelEntryFor */
function entryOf(name: string): string {
  return name.startsWith("assets/") ? name : modelEntryFor(name);
}

/** 纹理引用 → 条目路径（无命名空间默认 minecraft） */
function textureEntryFor(ref: string): string {
  const r = ref.includes(":") ? ref : `minecraft:${ref}`;
  const [ns, p] = r.split(":");
  return `assets/${ns}/textures/${p}.png`;
}

// ===== parent 链解析 =====

interface ResolvedModel {
  textures: Record<string, string>;
  elements: Array<Record<string, unknown>>;
  display: Record<string, unknown>;
  ambientocclusion: boolean;
  gui_light: string | null;
}

/** 解析模型（parent 链递归合并：textures/display 逐 key、elements 子整替） */
async function resolveModel(
  name: string,
  read: PackEntryReader,
  jsonCache: Map<string, Record<string, unknown>>,
  visited: Set<string>,
  isRoot = false,
): Promise<ResolvedModel> {
  const entry = entryOf(name);
  if (visited.has(entry)) throw new Error(`parent 循环引用: ${entry}`);
  visited.add(entry);

  let raw = jsonCache.get(entry);
  if (!raw) {
    const b64 = await read(entry);
    if (!b64) {
      if (isRoot) throw new Error(`模型缺失: ${entry}`);
      return { textures: {}, elements: [], display: {}, ambientocclusion: true, gui_light: null };
    }
    raw = JSON.parse(b64ToText(b64)) as Record<string, unknown>;
    jsonCache.set(entry, raw);
  }

  let parent: ResolvedModel = { textures: {}, elements: [], display: {}, ambientocclusion: true, gui_light: null };
  if (typeof raw.parent === "string") {
    const p = raw.parent as string;
    if (!p.startsWith("builtin/")) {
      parent = await resolveModel(p, read, jsonCache, visited);
    }
  }

  const tex = (raw.textures ?? {}) as Record<string, string>;
  const disp = (raw.display ?? {}) as Record<string, unknown>;
  return {
    textures: { ...parent.textures, ...tex },
    elements: (raw.elements as Array<Record<string, unknown>> | undefined) ?? parent.elements,
    display: { ...parent.display, ...disp },
    ambientocclusion:
      typeof raw.ambientocclusion === "boolean" ? (raw.ambientocclusion as boolean) : parent.ambientocclusion,
    gui_light: (raw.gui_light as string | undefined) ?? parent.gui_light,
  };
}

// ===== 纹理变量解析 =====

function resolveTextureRef(
  ref: string,
  textures: Record<string, string>,
  visited: Set<string>,
): { kind: "texture"; entry: string } | { kind: "color"; color: string } | null {
  // 纯色值（#RRGGBB）优先判定——不能落入变量分支（# 前缀冲突）
  if (COLOR_RE.test(ref)) return { kind: "color", color: ref };
  if (ref.startsWith("#")) {
    if (visited.has(ref)) throw new Error(`纹理变量循环引用: ${ref}`);
    visited.add(ref);
    const val = textures[ref.slice(1)];
    if (val === undefined) return null; // 缺失变量 → 渲染兜底/跳过
    return resolveTextureRef(val, textures, visited);
  }
  return { kind: "texture", entry: textureEntryFor(ref) };
}

// ===== element → 面数据 =====

function buildRotationMatrix(axis: string, degree: number): number[][] {
  const rad = (degree * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const i0 = { x: 0, y: 1, z: 2 }[axis] ?? 1;
  const i1 = (i0 + 1) % 3;
  const i2 = (i0 + 2) % 3;
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  m[i0][i0] = 1;
  m[i1][i1] = cos;
  m[i1][i2] = -sin;
  m[i2][i1] = +sin;
  m[i2][i2] = cos;
  return m;
}

function matmul(m: number[][], v: number[]): number[] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

interface ElementLike {
  from: number[];
  to: number[];
  faces?: Record<string, Record<string, unknown>>;
  rotation?: { axis?: string; angle?: number; origin?: number[] };
}

/** 构建元素面数据（UV 归一化 + v 翻转 + face rotation） */
async function buildElementFaces(
  el: ElementLike,
  textures: Record<string, string>,
): Promise<JavaModelFace[]> {
  const [minx, miny, minz] = el.from;
  const [maxx, maxy, maxz] = el.to;

  // 元素几何旋转（rotate + origin 补偿，prismarine 同款）
  let rotMat: number[][] | null = null;
  let rotShift: number[] | null = null;
  if (el.rotation && el.rotation.axis && typeof el.rotation.angle === "number") {
    rotMat = buildRotationMatrix(el.rotation.axis, el.rotation.angle);
    const o = el.rotation.origin ?? [8, 8, 8];
    const ro = matmul(rotMat, o);
    rotShift = [o[0] - ro[0], o[1] - ro[1], o[2] - ro[2]];
  }

  const out: JavaModelFace[] = [];
  for (const [face, fdRaw] of Object.entries(el.faces ?? {})) {
    const spec = ELEM_FACES[face];
    if (!spec) continue;
    const fd = (fdRaw ?? {}) as Record<string, unknown>;

    // 4 顶点（像素坐标，应用元素旋转）
    const verts: number[] = [];
    for (const c of spec.corners) {
      let v = [c[0] ? maxx : minx, c[1] ? maxy : miny, c[2] ? maxz : minz];
      if (rotMat && rotShift) {
        v = matmul(rotMat, v);
        v = [v[0] + rotShift[0], v[1] + rotShift[1], v[2] + rotShift[2]];
      }
      verts.push(...v);
    }

    // UV：像素矩形 → 4 角 → face rotation → 归一化 + v 翻转
    // 归一化分母恒 16（MC 模型 uv 的 16 = 一整张纹理，与 PNG 实际尺寸无关——
    // 高清资源包只换 png 不改 uv；按 PNG 尺寸做分母会只取左上 1/N）。
    // 注意归一化须整式 /16：u = (u1 + 角*(u2-u1)) / 16——局部矩形 [4,4,12,12] → [0.25,0.75]，
    // 拆成 u1 + 角*(u2-u1)/16 会在全铺 UV (0..16) 时碰巧输出 0..1，但局部 UV 越界（行业口径：uv 恒 /16）。
    const uvPx = (fd.uv as number[] | undefined) ?? [0, 0, 16, 16];
    const [u1, v1, u2, v2] = uvPx;
    const rotDeg = (fd.rotation as number | undefined) ?? 0;
    const cos = Math.cos((rotDeg * Math.PI) / 180);
    const sn = -Math.sin((rotDeg * Math.PI) / 180); // prismarine 同款（MC 域内视觉顺时针）

    const texRef =
      typeof fd.texture === "string" ? resolveTextureRef(fd.texture, textures, new Set()) : null;

    const uv: number[] = [];
    for (const c of spec.corners) {
      let u = (u1 + (c[3] * (u2 - u1))) / 16;
      let v = (v1 + (c[4] * (v2 - v1))) / 16;
      if (rotDeg !== 0) {
        const bu = (u - 0.5) * cos - (v - 0.5) * sn + 0.5;
        const bv = (u - 0.5) * sn + (v - 0.5) * cos + 0.5;
        u = bu;
        v = bv;
      }
      uv.push(u, 1 - v); // MC 域 → Three 域（flipY=true）：v 翻转
    }

    out.push({
      face,
      dir: spec.dir,
      verts,
      uv,
      texEntry: texRef?.kind === "texture" ? texRef.entry : null,
      texColor: texRef?.kind === "color" ? texRef.color : null,
      tintindex: (fd.tintindex as number | null | undefined) ?? null,
      cullface: (fd.cullface as string | null | undefined) ?? null,
    });
  }
  return out;
}

// ===== 顶层入口 =====

/**
 * 解析资源包内 block/item 模型（parent 链递归）。
 * @param entry 模型条目路径（assets/<ns>/models/.../xxx.json）
 * @param read 条目读取器（base64 或 null）
 * @returns 解析结果；条目缺失/JSON 非法返回 null
 */
export async function parseJavaModel(
  entry: string,
  read: PackEntryReader,
): Promise<JavaModelResult | null> {
  const jsonCache = new Map<string, Record<string, unknown>>();
  try {
    const model = await resolveModel(entry, read, jsonCache, new Set(), true);
    const faces: JavaModelFace[] = [];
    for (const el of model.elements) {
      faces.push(...(await buildElementFaces(el as unknown as ElementLike, model.textures)));
    }
    // 展示名：去命名空间 / models 前缀 / block|item / 扩展名
    const short = entry.replace(/^assets\/[^/]+\/models\/(?:block|item)\//, "").replace(/\.json$/, "");
    return {
      name: short,
      entry,
      faces,
      elementCount: model.elements.length,
      ambientocclusion: model.ambientocclusion,
      display: model.display,
      gui_light: model.gui_light,
    };
  } catch {
    return null;
  }
}

/** 判定模型是否"完整可渲染"：至少一个面有纹理或纯色（纯模板如 cube/cube_all 返回 false） */
export function isRenderableModel(m: JavaModelResult | null): m is JavaModelResult {
  return !!m && m.faces.some((f) => f.texEntry !== null || f.texColor !== null);
}

