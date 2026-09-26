// ===== ui-maps.ts — 设置页「值域语义值 → 用户可见 UI 文案」映射表 =====
// 值域枚举单一来源 = settings-schema.ts（MIRROR_SOURCES / LINK_MODES / …）；本文件收纳
// **多消费面共享**的 Record<联合, 文案键> 表。ADR-307 D3 口径不变：schema 只供值、文案键归
// 消费面；单消费面的表留在各自文件，双面共享的表落此处单点——原 LINK_MODE_UI 住在
// tpl-settings.ts 迫使 init.ts 反向 import 模板层（仅靠「纯数据无副作用」注释维系），
// 模板/绑定两层语义耦合，2026-10 锐评收编迁出。
// 护栏不变：Record 联合键域，schema 加成员漏文案键即编译期红，不靠运行时 ?? 兜底。
import type { LocaleKey } from "@/core/i18n/t.ts";
import type { LinkMode, MirrorSource } from "./settings-schema.ts";

// ===== 镜像源 UI 映射（schema 语义值 → UI 值 / 文案键；ADR-307 D3 消费面收口）=====
// Record<MirrorSource, …> ⇒ MIRROR_SOURCES 加成员时此处编译期报错，逼出 option/hint 同步。
// 原模板三行 <option> 手写裸列 = schema 宣称「option 渲染单一来源」却未接线的半截工程：
// 加第四个镜像源会出现「schema 有、下拉框静默没有」。option 与 hint 块由 MIRROR_SOURCES.map
// 派生（存在性 + 顺序随 schema，消费方 tpl-settings.ts|mirrorCardBody）；direct 的 UI 值 = ""
// （存储层同，归一逻辑见 settings-schema.ts 注）。
/** 镜像源 → { uiValue: <select> option 的 value; optionKey: 选项名; hintKey: 说明块 } */
export const MIRROR_UI: Record<
  MirrorSource,
  { uiValue: string; optionKey: LocaleKey; hintKey: LocaleKey }
> = {
  direct: {
    uiValue: "",
    optionKey: "settings.mirror.directOption",
    hintKey: "settings.mirror.directHint",
  },
  jsdelivr: {
    uiValue: "jsdelivr",
    optionKey: "settings.mirror.jsdelivrOption",
    hintKey: "settings.mirror.jsdelivrHint",
  },
  githubapi: {
    uiValue: "githubapi",
    optionKey: "settings.mirror.nameGithubapi",
    hintKey: "settings.mirror.githubapiHint",
  },
};

// ===== 链接模式：值 → 用户可见文案（模板 option 与 init 的 toast/确认框共用单表）=====
// 值域由 settings-schema|LINK_MODES 派生（ADR-307 D3 扩编）：加第四种链接模式只改 schema
// 一处，Record 文案表编译期逼出同步；默认 selected = LINK_MODE_DEFAULT。
// 本表 2026-10（锐评第七轮）自 linksCardSpec 局部提升为模块级：此前只有模板一面消费，
// 而 init.ts|stgBindLinkMode 的确认框 / toast 直接把裸枚举（copy/hardlink/symlink）塞进
// `{val}`——中文界面弹出「重新链接为 symlink 模式」，是全页唯一一处**用户可见值未过文案表**
// 的裸奔。同枚举两张表（如镜像源的 optionKey 与 nameKey）是这种分裂的前车之鉴，故单表共用。
/** 链接模式 → { labelKey: 用户可见名（下拉 option 与 toast/确认框共用）; hintKey: 卡内说明 } */
export const LINK_MODE_UI: Record<
  LinkMode,
  { labelKey: LocaleKey; hintKey: LocaleKey; hintColor?: "error" }
> = {
  copy: { labelKey: "settings.links.copy", hintKey: "settings.links.copyHint" },
  hardlink: { labelKey: "settings.links.hardlink", hintKey: "settings.links.hardlinkHint" },
  // symlink 的 hint 带错误色（与 copy/hardlink 中性提示区分——symlink 失败概率最高）
  symlink: {
    labelKey: "settings.links.symlink",
    hintKey: "settings.links.symlinkHint",
    hintColor: "error",
  },
};
