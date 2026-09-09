// ADR-217 环 B：IndexedDB 存储引擎已下沉 frontend/src/utils/storage/idb.ts（中性层，
// 消除 workers/stats.worker.ts → backend 反向环）。本文件仅 re-export 保持
// web-fs*/web-store/web-fs-auth 等既有消费方（6 处）命名/签名兼容，零改动。
export * from "@/utils/storage/idb.ts";
