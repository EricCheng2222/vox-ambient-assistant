import assert from "node:assert/strict";
import { answerLinks, answerLinkRanges } from "../lib/answer-links.ts";

assert.deepEqual(answerLinks("Rate: NT$25,152. [Source: GHA DISCOVERY](https://www.ghadiscovery.com/Capella-Hotels-Resorts)."), [
  { text: "Rate: NT$25,152. " },
  { text: "Source: GHA DISCOVERY", href: "https://www.ghadiscovery.com/Capella-Hotels-Resorts" },
  { text: "." },
]);
assert.deepEqual(answerLinks("See https://www.example.com/report?date=2026#rates, then http://other.example/."), [
  { text: "See " }, { text: "example.com", href: "https://www.example.com/report?date=2026#rates" },
  { text: ", then " }, { text: "other.example", href: "http://other.example/" }, { text: "." },
]);
// Parentheses can belong to a URL or to the surrounding sentence.
assert.deepEqual(answerLinks("([Report](https://example.com/a_(b)))."), [
  { text: "(" }, { text: "Report", href: "https://example.com/a_(b)" }, { text: ")." },
]);
assert.equal(answerLinks("HTTPS://EXAMPLE.COM/a_(b)！")[0].href, "https://example.com/a_(b)");
assert.equal(answerLinks("[官方](https://example.com/價格)")[0].text, "官方");
for (const text of ["Plain text [as it is].", "[Bad](javascript:alert(1))", "[Bad](data:text/html,hello)", "[Bad](file:///etc/passwd)", "[Private](https://user:password@example.com/)", "[Bad](https://)"]) {
  assert.deepEqual(answerLinks(text), [{ text }]);
}
assert.deepEqual(answerLinks(""), []);
// A source label containing punctuation stays one link, with exact offsets for list layout.
const linked = "[Source: hotel — report](https://example.com/a_(b))";
assert.deepEqual(answerLinkRanges(`Read ${linked} today.`), [{ start: 5, end: 5 + linked.length, text: "Source: hotel — report", href: "https://example.com/a_(b)" }]);
console.log("Named citations, bare URLs, punctuation and link validation: ok");
