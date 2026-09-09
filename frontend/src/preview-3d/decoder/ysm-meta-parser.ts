// ===== ysm-meta-parser — ysm.json 元数据纯解析器（P4 抽取自 wasm-decode.ts）=====
// 对齐 P1 sun-beams.ts / P2 env-pixels.ts / P3 light-presets.ts 拆分先例：把
// 不属于「WASM 解码流水线」主职责的纯解析片段下沉本文件，使 wasm-decode.ts
// 收口并发去重 / JSON 直接解析 / WASM 初始化+三重解码 / 纹理·模型·动画流水线。
// 本文件零应用层依赖（不 import backend/features/views）：纯数据解析，只读传入的
// DecodedFile[]（找 ysm.json → JSON.parse → 提取 texture/model order、default_texture、
// 动画分组/配置菜单、authors），不触达解码器任何私有状态。行为与原实现逐字等价
// （契约：wasm-decode.test.ts 的 ysm.json 相关分支用例）。
// 内容：
//   - DecodedFile / MdWsYsmMeta：WASM 解码输出文件 + ysm.json 元数据类型
//     （原 wasm-decode.ts 内部接口，提级至本文件共享；本文件不反向 import
//     wasm-decode，避免循环依赖）
//   - parseYsmMetaFromFiles：原 mdWsParseYsmMetaFromFiles（去 mdWs 前缀，同 P1
//     godRaysIntensity 风格），纯函数，正文与注释逐字保留

import { safeErrorMessage } from "@/utils/base/pure/safe-error-msg.ts";
import { extractAnimGroupsAndConfigs } from "@/utils/format/ysm-anim-config.ts";
import { type DecodedYsm, devLog } from "./utils.ts";

/** WASM 解码输出文件 */
export interface DecodedFile {
  path: string;
  data: Uint8Array;
}

/** ysm.json 元数据解析结果（WASM 输出路径使用，JSON spec 路径 ysmMeta 内联） */
export interface MdWsYsmMeta {
  ysmTexOrder: unknown[] | null;
  ysmModelOrder: unknown[] | null;
  ysmDefaultTex: string | null;
  animGroups: DecodedYsm["animGroups"];
  configMenus: DecodedYsm["configMenus"];
  authors: Array<{
    name: string;
    role: string;
    avatarUrl: string | null;
    avatarPath: string;
  }>;
  avatars: Record<string, string>;
}

export function parseYsmMetaFromFiles(files: DecodedFile[]): {
  meta: MdWsYsmMeta;
  hasYsmMeta: boolean;
} {
  const emptyMeta: MdWsYsmMeta = {
    ysmTexOrder: null,
    ysmModelOrder: null,
    ysmDefaultTex: null,
    animGroups: [],
    configMenus: [],
    authors: [],
    avatars: {},
  };
  const ysmMetaFile = files.find((f) => f.path.endsWith("ysm.json"));
  if (!ysmMetaFile) return { meta: emptyMeta, hasYsmMeta: false };

  let parsedJson: {
    files?: { player?: { texture?: unknown; model?: unknown } };
    properties?: {
      default_texture?: string | null;
      extra_animation?: Record<string, unknown> | null;
      extra_animation_classify?: Array<{
        id?: string;
        name?: string;
        extra_animation?: Record<string, unknown> | null;
      }> | null;
      extra_animation_buttons?: Array<{
        id?: string;
        name?: string;
        config_forms?: unknown;
      }> | null;
    };
    metadata?: { authors?: Array<{ name?: string; role?: string; avatar?: string }> };
  } | null = null;

  try {
    const txt = new TextDecoder().decode(ysmMetaFile.data);
    parsedJson = JSON.parse(txt);
  } catch (e) {
    devLog(`[YSM] ysm.json 元信息解析失败: ${safeErrorMessage(e)}`);
    return { meta: emptyMeta, hasYsmMeta: true };
  }

  // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
  const json = parsedJson!;
  const ysmTexOrder = json?.files?.player?.texture
    ? Array.isArray(json.files.player.texture)
      ? json.files.player.texture
      : [json.files.player.texture]
    : null;
  const ysmModelOrder = Array.isArray(json?.files?.player?.model)
    ? json.files.player.model
    : json?.files?.player?.model
      ? [json.files.player.model]
      : null;
  const ysmDefaultTex = json?.properties?.default_texture || null;
  const animCfg = extractAnimGroupsAndConfigs(json?.properties);

  const authors: MdWsYsmMeta["authors"] = [];
  if (json?.metadata?.authors) {
    for (const au of json.metadata.authors) {
      if (!au.name) continue;
      const avatarPath = au.avatar || "";
      authors.push({
        name: au.name,
        role: au.role || "",
        avatarUrl: null,
        avatarPath,
      });
    }
  }

  return {
    meta: {
      ysmTexOrder,
      ysmModelOrder,
      ysmDefaultTex,
      animGroups: animCfg.animGroups,
      configMenus: animCfg.configMenus,
      authors,
      avatars: {},
    },
    hasYsmMeta: true,
  };
}
