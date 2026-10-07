import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";

const { buildPptx, buildDocx } = await import("../lib/office-files.ts");

const deck = buildPptx({
  title: "AI 進展 <2026> & beyond",
  subtitle: "回顧與展望",
  slides: [
    { title: "里程碑", bullets: ["Transformer", "多模態 & 代理"], notes: "先講歷史。" },
    { title: "Risks", bullets: [], notes: "" },
  ],
});
const parts = unzipSync(deck);
const names = Object.keys(parts);
// A title slide plus one per entry, each wired into the package.
for (const part of ["[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels", "ppt/theme/theme1.xml", "ppt/slideMasters/slideMaster1.xml", "ppt/slideLayouts/slideLayout1.xml", "ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide3.xml"]) {
  assert.ok(names.includes(part), part);
}
assert.ok(!names.includes("ppt/slides/slide4.xml"));
const presentation = strFromU8(parts["ppt/presentation.xml"]);
assert.equal(presentation.match(/<p:sldId /g).length, 3);
const presentationRels = strFromU8(parts["ppt/_rels/presentation.xml.rels"]);
for (const id of presentation.match(/r:id="(rId\d+)"/g).map((value) => value.slice(6, -1))) assert.ok(presentationRels.includes(`Id="${id}"`), id);
const types = strFromU8(parts["[Content_Types].xml"]);
for (const name of names.filter((value) => /^ppt\/.*\.xml$/.test(value) && !value.includes("_rels"))) assert.ok(types.includes(`/${name}`), name);
// Text is escaped, and notes are attached only where there are any.
const first = strFromU8(parts["ppt/slides/slide1.xml"]);
assert.ok(first.includes("AI 進展 &lt;2026&gt; &amp; beyond"));
assert.ok(strFromU8(parts["ppt/slides/slide2.xml"]).includes("多模態 &amp; 代理"));
assert.ok(names.includes("ppt/notesSlides/notesSlide2.xml"));
assert.ok(!names.includes("ppt/notesSlides/notesSlide3.xml"));
assert.ok(strFromU8(parts["ppt/slides/_rels/slide2.xml.rels"]).includes("notesSlide2.xml"));
assert.ok(!strFromU8(parts["ppt/slides/_rels/slide3.xml.rels"]).includes("notesSlide"));
// A long deck is capped.
assert.equal(Object.keys(unzipSync(buildPptx({ title: "t", slides: Array.from({ length: 80 }, (_, i) => ({ title: `s${i}`, bullets: ["a"] })) }))).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, 41);

const doc = unzipSync(buildDocx({ title: "報告", sections: [{ heading: "摘要", paragraphs: ["A <b> & c"], bullets: ["重點"] }, { heading: "", paragraphs: ["Tail"], bullets: [] }] }));
assert.deepEqual(Object.keys(doc).sort(), ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
const body = strFromU8(doc["word/document.xml"]);
assert.ok(body.includes("報告") && body.includes("摘要") && body.includes("A &lt;b&gt; &amp; c") && body.includes("重點") && body.includes("Tail"));
assert.equal(body.match(/<w:p>/g).length, 5);

console.log("Office file checks passed.");
