import { executeCLI, type CLIResponse } from "./cli-bridge.ts";

export interface YSMHubModel {
  id: number | string;
  slug: string;
  title: string;
  short_description?: string | null;
  description?: string | null;
  description_html?: string | null;
  cover_image_url?: string | null;
  background_image_url?: string | null;
  owner_name?: string | null;
  download_count?: number;
  view_count?: number;
  favorite_count?: number;
  like_count?: number;
  updated_at?: string;
  download_visibility?: string;
  [key: string]: unknown;
}

export interface YSMHubVersion {
  id: number | string;
  model_id?: number | string;
  version_name?: string | null;
  changelog?: string | null;
  is_recommended?: number | boolean;
  created_at?: string;
  [key: string]: unknown;
}

export interface YSMHubPage {
  items: YSMHubModel[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface YSMHubDetail {
  model: YSMHubModel;
  versions: YSMHubVersion[];
  tags?: unknown[];
  links?: unknown[];
}

function responseError(response: CLIResponse): Error {
  return new Error(response.error?.message || "YSM Hub request failed");
}

function parseOutput<T>(response: CLIResponse): T {
  if (response.status !== "success") throw responseError(response);
  const output = response.data?.output;
  if (!output) throw new Error("YSM Hub returned an empty response");
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new Error("YSM Hub returned invalid JSON");
  }
}

export async function listYSMHubModels(options: {
  query?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<YSMHubPage> {
  const response = await executeCLI("hub-models", {
    format: "json",
    q: options.query || undefined,
    sort: options.sort || undefined,
    page: options.page || 1,
    "page-size": options.pageSize || 24,
  });
  return parseOutput<YSMHubPage>(response);
}

export async function getYSMHubModel(slug: string): Promise<YSMHubDetail> {
  const response = await executeCLI("hub-model", { format: "json", slug });
  const value = parseOutput<YSMHubDetail | YSMHubModel>(response);
  if (typeof value === "object" && value !== null && "model" in value && Array.isArray((value as YSMHubDetail).versions)) {
    return value as YSMHubDetail;
  }
  return { model: value as YSMHubModel, versions: [] };
}

export async function downloadYSMHubModel(
  modelId: number | string,
  versionId: number | string | undefined,
  saveDir: string,
): Promise<{ path: string; file_name?: string; file_size?: number }> {
  const response = await executeCLI("hub-download", {
    format: "json",
    id: String(modelId),
    "version-id": versionId === undefined ? undefined : String(versionId),
    "save-dir": saveDir,
  });
  return parseOutput(response);
}

export async function loginYSMHub(): Promise<void> {
  const response = await executeCLI("hub-login", { scope: "read download" });
  if (response.status !== "success") throw responseError(response);
}
