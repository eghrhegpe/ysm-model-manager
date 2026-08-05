// ===== 作者标签模块 =====
import { getApp } from "../../wails/app.ts";

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
      await getApp();
    return (await ListModelAuthors()) || [];
  } catch {
    return [];
  }
}
