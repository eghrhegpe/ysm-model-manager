// ===== 作者标签模块 =====

/** 作者统计（Go ListModelAuthors 返回） */
export interface AuthorInfo {
  Name: string;
  Count: number;
}

/**
 * 从 Go 端加载作者列表
 */
export async function loadAuthors(): Promise<AuthorInfo[]> {
  try {
    const { ListModelAuthors } =
      await import("../../../bindings/ysm-model-manager/internal/app/app.js");
    return (await ListModelAuthors()) || [];
  } catch {
    return [];
  }
}
