// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./cli-bridge.ts", () => ({ executeCLI: vi.fn() }));

import { executeCLI } from "./cli-bridge.ts";
import {
  downloadYSMHubModel,
  getYSMHubModel,
  listYSMHubAuthors,
  listYSMHubModels,
  loginYSMHub,
} from "./ysmhub.ts";

const success = (value: unknown) => ({
  status: "success" as const,
  command: "hub-models",
  data: { output: JSON.stringify(value) },
});

beforeEach(() => vi.clearAllMocks());

describe("YSM Hub service", () => {
  it("passes list filters to the desktop CLI bridge", async () => {
    vi.mocked(executeCLI).mockResolvedValue(success({ items: [], total: 0, page: 2, page_size: 12, total_pages: 0 }));

    await listYSMHubModels({ query: "fox", author: "Alex", sort: "most_liked", page: 2, pageSize: 12 });

    expect(executeCLI).toHaveBeenCalledWith("hub-models", {
      format: "json",
      q: "fox",
      author: "Alex",
      sort: "most_liked",
      page: 2,
      "page-size": 12,
    });
  });

  it("loads author categories through the desktop CLI bridge", async () => {
    vi.mocked(executeCLI).mockResolvedValue(success({ items: [{ name: "Alex", model_count: 2 }] }));

    await expect(listYSMHubAuthors()).resolves.toMatchObject({ items: [{ name: "Alex", model_count: 2 }] });
    expect(executeCLI).toHaveBeenCalledWith("hub-authors", { format: "json" });
  });

  it("accepts detail envelopes and bare model responses", async () => {
    vi.mocked(executeCLI)
      .mockResolvedValueOnce(success({ model: { id: 1, slug: "fox", title: "Fox" }, versions: [{ id: 2 }] }))
      .mockResolvedValueOnce(success({ id: 3, slug: "cat", title: "Cat" }));

    await expect(getYSMHubModel("fox")).resolves.toMatchObject({ model: { slug: "fox" }, versions: [{ id: 2 }] });
    await expect(getYSMHubModel("cat")).resolves.toMatchObject({ model: { slug: "cat" }, versions: [] });
  });

  it("passes the selected version and repository directory to downloads", async () => {
    vi.mocked(executeCLI).mockResolvedValue(success({ path: "C:/models/fox.ysm" }));

    await expect(downloadYSMHubModel(10, 20, "C:/models")).resolves.toEqual({ path: "C:/models/fox.ysm" });
    expect(executeCLI).toHaveBeenCalledWith("hub-download", {
      format: "json",
      id: "10",
      "version-id": "20",
      "save-dir": "C:/models",
    });
  });

  it("reports invalid JSON and OAuth failures", async () => {
    vi.mocked(executeCLI)
      .mockResolvedValueOnce({ status: "success", command: "hub-models", data: { output: "not-json" } })
      .mockResolvedValueOnce({ status: "error", command: "hub-login", error: { code: "oauth", message: "denied" } });

    await expect(listYSMHubModels()).rejects.toThrow("invalid JSON");
    await expect(loginYSMHub()).rejects.toThrow("denied");
  });
});
