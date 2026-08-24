// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ysmHubHTML } from "./tpl-ysmhub.ts";

describe("YSM Hub page template", () => {
  it("exposes browsing controls and an explicit sign-in action", () => {
    const html = ysmHubHTML();

    expect(html).toContain('id="ysmhub-search"');
    expect(html).toContain('id="ysmhub-sort"');
    expect(html).toContain('id="ysmhub-author"');
    expect(html).toContain('id="ysmhub-search-btn"');
    expect(html).toContain('id="ysmhub-login-btn"');
    expect(html).toContain('id="ysmhub-content"');
  });
});
