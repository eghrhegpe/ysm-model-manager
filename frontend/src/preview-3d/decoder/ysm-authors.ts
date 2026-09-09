// ===== ysm.json authors 元数据解析（单一事实源）=====
// 背景：YSM 模型元数据有两条解析通道——
//   ① parse-ysm-json.ts（纯 JSON 直解，非加密容器）
//   ② ysm-meta-parser.ts（WASM 解码后的 ysm.json）
// 二者原各自内联一份 authors 构造（filter+map / for+continue 两种写法），产物结构
// 逐字相同却各写一遍：改一处漏一处即静默分叉（如新增字段、调整头像回落策略）。
// 本文件收口为唯一实现，两条通道共用，杜绝双写漂移。
// 零应用层依赖（不 import backend/features/views/preview-3d 其他模块）：纯数据归一化。

/** ysm.json metadata.authors 的原始条目（未校验，字段全可选） */
export interface RawYsmAuthor {
  name?: string;
  role?: string;
  avatar?: string;
}

/** 归一化后的作者条目 */
export interface YsmAuthor {
  name: string;
  role: string;
  /** 恒 null：YSM 容器不携带 http 头像地址，头像走 avatarPath 由 avatars 映射回填 */
  avatarUrl: string | null;
  /** 容器内头像相对路径，缺失回落空串（消费方按空串跳过） */
  avatarPath: string;
}

/** ysm.json 顶层 metadata 的可解析子集（两条通道的入参形状） */
export interface YsmAuthorMetadata {
  authors?: RawYsmAuthor[] | null;
}

/**
 * 归一化 ysm.json metadata.authors。
 * 规则（与历史实现逐字等价，勿单侧修改）：
 *   - 非数组 / 缺失 → 空数组（不抛异常，元数据缺失不影响模型主体解析）
 *   - name 为空的条目整条丢弃（无名作者无展示意义，且下游按 name 建索引）
 *   - role 缺失回落 ""，avatar 缺失回落 ""，avatarUrl 恒 null
 */
export function parseYsmAuthors(metadata: YsmAuthorMetadata | null | undefined): YsmAuthor[] {
  const raw = metadata?.authors;
  if (!Array.isArray(raw)) return [];
  const out: YsmAuthor[] = [];
  for (const au of raw) {
    if (!au?.name) continue;
    out.push({
      name: au.name,
      role: au.role || "",
      avatarUrl: null,
      avatarPath: au.avatar || "",
    });
  }
  return out;
}
