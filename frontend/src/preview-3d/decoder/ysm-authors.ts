// ===== re-export 壳（ADR-217 后续边界清洁 2026-09-10）=====
// 真实实现已迁至 parsers/ysm-authors.ts（纯数据归一化，属格式解析范畴）。
// 本文件保留 re-export 供既有消费者零改动，后续新消费者直接引 parsers/ysm-authors.ts。

export type { RawYsmAuthor, YsmAuthor, YsmAuthorMetadata } from "@/parsers/ysm-authors.ts";
export { parseYsmAuthors } from "@/parsers/ysm-authors.ts";
