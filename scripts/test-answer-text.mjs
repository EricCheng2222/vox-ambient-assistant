import assert from "node:assert/strict";

const { withoutLinkMarkup } = await import("../lib/answer-text.ts");

// The citation the web-search model appends, exactly as it showed up in the chat.
assert.equal(
  withoutLinkMarkup("台灣同志遊行將於 10 月 31 日在台北舉行。([taiwanpride.lgbt](https://www.taiwanpride.lgbt/2026-info-1?utm_source=openai))"),
  "台灣同志遊行將於 10 月 31 日在台北舉行。",
);
assert.equal(withoutLinkMarkup("Rooms start near NT$2,000 ([airbnb.com.tw](https://www.airbnb.com.tw/x?utm_source=openai), [booking.com](https://booking.com/y)). Book early."), "Rooms start near NT$2,000. Book early.");
assert.equal(withoutLinkMarkup("See [the Airbnb listing](https://www.airbnb.com/rooms/1) for photos."), "See the Airbnb listing for photos.");
assert.equal(withoutLinkMarkup("Source: [www.example.com/page](https://www.example.com/page)"), "Source:");
assert.equal(withoutLinkMarkup("Plain text (with a remark) stays [as it is]."), "Plain text (with a remark) stays [as it is].");
assert.equal(withoutLinkMarkup("Line one.\nLine two ([a.com](https://a.com))."), "Line one.\nLine two.");

console.log("Answer text checks passed.");
