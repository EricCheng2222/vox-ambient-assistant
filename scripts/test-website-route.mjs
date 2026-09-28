import assert from "node:assert/strict";
import { detectWebsiteRequest, isOpenableWebsite } from "../lib/website-route.ts";

const opens = (text, name, url) => {
  const result = detectWebsiteRequest(text);
  assert.ok(result, `${text} should open a website`);
  assert.equal(result.name, name, text);
  if (url) assert.equal(result.url, url, text);
  assert.ok(isOpenableWebsite(result.url), `${text} gives a safe link`);
};

opens("幫我打開YouTube", "YouTube", "https://www.youtube.com/");
opens("幫我打開 YouTube", "YouTube", "https://www.youtube.com/");
opens("open youtube", "YouTube", "https://www.youtube.com/");
opens("開 Netflix", "Netflix");
opens("打開 gmail", "Gmail");
opens("open YouTube Music", "YouTube Music");
opens("go to example.com", "example.com", "https://example.com/");
opens("在 YouTube 搜尋 lo-fi 音樂", "YouTube", "https://www.youtube.com/results?search_query=lo-fi%20%E9%9F%B3%E6%A8%82");
opens("search cat videos on youtube", "YouTube", "https://www.youtube.com/results?search_query=cat%20videos");
opens("打開 Google 地圖", "Google Maps");
opens("幫我開蝦皮", "Shopee");

for (const text of ["YouTube 是什麼", "what is youtube", "I watched YouTube yesterday", "我昨天看了 YouTube", "", "打開計算機"]) {
  assert.equal(detectWebsiteRequest(text), null, `${JSON.stringify(text)} is not a website request`);
}

assert.equal(isOpenableWebsite("javascript:alert(1)"), false);
assert.equal(isOpenableWebsite("http://example.com/"), false);
assert.equal(isOpenableWebsite("https://user:pw@example.com/"), false);
assert.equal(isOpenableWebsite("file:///etc/passwd"), false);

console.log("Website routing checks passed.");
