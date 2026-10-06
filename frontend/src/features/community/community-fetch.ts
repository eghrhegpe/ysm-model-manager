// ===== 创意工坊远程索引拉取层（纯网络适配，零缓存/零后端依赖）=====
// 从 community-data.ts 拆出（ADR-040 §2.1）：三路回退拉取是干净的网络 I/O 边界，
// 与本地数据加载/合并/缓存解耦。本文件只依赖 i18n + bindings 类型，可独立测试。

import type {
  WorkshopCreator,
  WorkshopSite,
} from "@/bindings/ysm-model-manager/go/types/models.ts";
import { t } from "@/core/i18n/t.ts";
import { base64ToBytes } from "@/utils/base/primitives/base64.ts";
import { dbg } from "@/utils/debug/debug.ts";

/**
 * 三路回退拉取 JSON 数组（raw → jsdelivr → GitHub API）。
 * mirror 为 "jsdelivr" / "githubapi" 时调整优先级；api 源解 base64 后按 UTF-8 解码（禁裸 atob，见下方）。
 * 每路 8s 超时（AbortController）；全部失败返回 []。
 * @param attempts - 候选源列表（按尝试顺序）
 * @param mirror - 镜像配置，调整回退优先级
 * @param dbgTag - debug 日志模块标签（默认 "community"）
 */
async function fetchWithFallback<T>(
  attempts: Array<{ name: string; url: string; label: string }>,
  mirror?: string,
  dbgTag = "community",
): Promise<T[]> {
  // 防御：attempts 可能不足 3 项（本地 URL 场景），重排后滤掉缺失项，避免 undefined.url
  const order = mirror === "jsdelivr" ? [1, 0, 2] : mirror === "githubapi" ? [2, 0, 1] : null;
  const sorted = order
    ? order.map((i) => attempts[i]).filter((a): a is (typeof attempts)[number] => !!a)
    : attempts;

  for (const a of sorted) {
    const ctrl = new AbortController();
    const tmr = setTimeout(() => ctrl.abort(), 8000);
    try {
      const resp = await fetch(a.url, { signal: ctrl.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      let data: unknown;
      if (a.name === "api") {
        const json = (await resp.json()) as { content?: string };
        if (!json.content) throw new Error("no content");
        // GitHub API contents.content = base64(UTF-8 字节)。须 base64→字节→按 UTF-8 解码，
        // 不能裸 JSON.parse(atob(...))：atob 产 Latin-1（每字节→同码位字符），非 ASCII
        // 名会变双重编码乱码（雾雨波波沙→é¾é¨…），2026-09-21 曾以此落盘 197 条脏数据。
        // 复用 base64ToBytes 原语（同 data.ts 模型列表 api 路口径，消双实现漂移）。
        const bytes = base64ToBytes(json.content.replace(/[\r\n\s]/g, ""));
        if (!bytes) throw new Error("bad base64");
        data = JSON.parse(new TextDecoder("utf-8").decode(bytes));
      } else {
        data = await resp.json();
      }
      if (Array.isArray(data)) return data as T[];
    } catch (err) {
      if (err && (err as Error)?.name !== "AbortError") {
        dbg(dbgTag, `${a.name} failed:`, (err as Error)?.message);
      }
    } finally {
      clearTimeout(tmr);
    }
  }
  return [];
}

/**
 * 从 GitHub 拉取 creators.json（三路回退）
 */
export async function fetchCommunityCreators(
  url: string,
  mirror?: string,
): Promise<WorkshopCreator[]> {
  const attempts: Array<{ name: string; url: string; label: string }> = [
    { name: "raw", url, label: t("workshop.communityIndexLoading", { source: "raw" }) },
  ];
  // 仅在 raw URL 看起来有效时才加兜底
  if (url && !url.includes("localhost") && !url.includes("127.0.0.1")) {
    attempts.push(
      {
        name: "jsd",
        url: "https://cdn.jsdelivr.net/gh/eghrhegpe/ysm-model-manager@main/creators.json",
        label: t("workshop.communityIndexLoading", { source: "jsdelivr" }),
      },
      {
        name: "api",
        url: "https://api.github.com/repos/eghrhegpe/ysm-model-manager/contents/creators.json",
        label: t("workshop.communityIndexLoading", { source: "api" }),
      },
    );
  }
  return fetchWithFallback<WorkshopCreator>(attempts, mirror);
}

/**
 * 从 GitHub 拉取 workshop_sites.json（三路回退）
 */
export async function fetchCommunitySites(mirror?: string): Promise<WorkshopSite[]> {
  const attempts: Array<{ name: string; url: string; label: string }> = [
    {
      name: "raw",
      url: "https://raw.githubusercontent.com/eghrhegpe/ysm-model-manager/main/workshop_sites.json",
      label: t("workshop.siteIndexLoading", { source: "raw" }),
    },
    {
      name: "jsd",
      url: "https://cdn.jsdelivr.net/gh/eghrhegpe/ysm-model-manager@main/workshop_sites.json",
      label: t("workshop.siteIndexLoading", { source: "jsdelivr" }),
    },
    {
      name: "api",
      url: "https://api.github.com/repos/eghrhegpe/ysm-model-manager/contents/workshop_sites.json",
      label: t("workshop.siteIndexLoading", { source: "api" }),
    },
  ];
  // 全部源失败 → fetchWithFallback 返回 [];抛错让 withCached 不缓存失败结果（失败不缓存契约）
  const sites = await fetchWithFallback<WorkshopSite>(attempts, mirror);
  if (sites.length === 0) {
    throw new Error("fetchCommunitySites: all sources failed");
  }
  return sites;
}

/**
 * 社区索引的默认 URL（可配置为社区维护的独立 creators JSON）
 * 贡献通道：https://github.com/eghrhegpe/ysm-model-manager（仓库根目录 creators.json）
 */
export const DEFAULT_COMMUNITY_URL =
  "https://raw.githubusercontent.com/eghrhegpe/ysm-model-manager/main/creators.json";
