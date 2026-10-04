import { chromium } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:19387";
const out = process.argv[3] || "artifacts/e2e-shot.png";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: out, fullPage: false });
console.log("title:", await page.title());
console.log("saved:", out);
await browser.close();
