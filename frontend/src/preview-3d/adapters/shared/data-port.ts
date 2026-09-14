// ===== 适配器共享数据端口类型（2026-09-14 锐评 P2-5 方案 B 落地）=====
// 收敛 fbx/vrm/mmd 三处逐字重复的端口签名（readFileBytes 2 处、addOpLog 3 处、
// listAllFilePaths 2 处）——统一命名与形状，不改任何装配层（deps 被闭包捕获，
// mount3D 零感知）、不触碰 mmd 超集字段（batch/KTX2，避免 decoder 层跨界引用扩散）。
//
// 设计边界（刻意不为「全 optional 大统一」）：各适配器端口语义本质不同
// （mmd 读字节流、vrm 只诊断、fbx 读字节+诊断、litematic 只调 voxelCall、pack 只
// readEntry、ysm 读文本+枚举）——这里只共享「确已逐字重复的签名」，不强行把不共
// 同的能力并进同一接口。新增适配器时按需引用下列类型，不要发明新命名。

/** 读文件字节（base64 或 null；ADR-143 P2：失败返回 null，消费点已处理） */
export type ReadFileBytes = (path: string) => Promise<string | null>;

/** 目录递归枚举（同目录文件扫描；返回 null = 桥不可用/目录缺失） */
export type ListAllFilePaths = (dir: string) => Promise<string[] | null>;

/** 操作日志（环形日志面板；err 可选——失败详情） */
export type AddOpLog = (
  op: string,
  msg: string,
  status: "ok" | "fail" | "warn",
  err?: string,
) => Promise<void>;
