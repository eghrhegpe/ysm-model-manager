import { describe, it, expect, vi } from "vitest";
import { showProgress } from "./data.js";

describe("showProgress", () => {
  it("renders progress box with label", () => {
    const el = document.createElement("div");
    showProgress(el, 30, "⏳ 加载中…");
    expect(el.querySelector(".gh-progress-box")).toBeTruthy();
    expect(el.querySelector(".gh-progress-text").textContent).toBe(
      "⏳ 加载中…",
    );
  });

  it("sets progress width", () => {
    const el = document.createElement("div");
    showProgress(el, 50, "test");
    const fill = el.querySelector(".gh-progress-fill");
    expect(fill.style.width).toBe("50%");
  });

  it("adds striped class when < 100", () => {
    const el = document.createElement("div");
    showProgress(el, 50, "test");
    expect(
      el.querySelector(".gh-progress-fill").classList.contains("gh-striped"),
    ).toBe(true);
  });

  it("removes striped when at 100", () => {
    const el = document.createElement("div");
    showProgress(el, 100, "done");
    expect(
      el.querySelector(".gh-progress-fill").classList.contains("gh-striped"),
    ).toBe(false);
  });
});
