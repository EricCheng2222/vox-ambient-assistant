import { strToU8, zipSync } from "fflate";

// PowerPoint and Word files built from plain structured content (titles,
// bullets, paragraphs). The model writes the content; this code writes the
// file, so what the user downloads always opens. No I/O.

export type Deck = {
  title: string;
  subtitle?: string;
  slides: Array<{ title: string; bullets: string[]; notes?: string }>;
};

export type WordDocument = {
  title: string;
  sections: Array<{ heading: string; paragraphs: string[]; bullets?: string[] }>;
};

export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function esc(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const NS_P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const FONTS = '<a:latin typeface="Helvetica Neue"/><a:ea typeface="PingFang TC"/>';

// 16:9, in EMU.
const W = 12_192_000;
const H = 6_858_000;
const INK = "18212E";
const SOFT = "5B6675";
const ACCENT = "2457D6";

function rels(entries: Array<[id: string, type: string, target: string]>) {
  return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`)
    .join("")}</Relationships>`;
}

function textBox(id: number, name: string, x: number, y: number, w: number, h: number, paragraphs: string, anchor = "t") {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

function run(text: string, size: number, color: string, bold = false) {
  return `<a:r><a:rPr lang="zh-TW" sz="${size}"${bold ? ' b="1"' : ""} dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${FONTS}</a:rPr><a:t>${esc(text)}</a:t></a:r>`;
}

function bar(id: number, x: number, y: number, w: number, h: number, color: string) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Accent"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`;
}

function slideXml(shapes: string) {
  return `${XML}<p:sld ${NS_A} ${NS_R} ${NS_P}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function notesXml(text: string) {
  return `${XML}<p:notes ${NS_A} ${NS_R} ${NS_P}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-TW"/><a:t>${esc(text)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

const THEME = `${XML}<a:theme ${NS_A} name="Vox"><a:themeElements><a:clrScheme name="Vox"><a:dk1><a:srgbClr val="${INK}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="${SOFT}"/></a:dk2><a:lt2><a:srgbClr val="F3F6FB"/></a:lt2><a:accent1><a:srgbClr val="${ACCENT}"/></a:accent1><a:accent2><a:srgbClr val="1F9D8B"/></a:accent2><a:accent3><a:srgbClr val="D98A00"/></a:accent3><a:accent4><a:srgbClr val="C2410C"/></a:accent4><a:accent5><a:srgbClr val="7C3AED"/></a:accent5><a:accent6><a:srgbClr val="0EA5E9"/></a:accent6><a:hlink><a:srgbClr val="${ACCENT}"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="Vox"><a:majorFont><a:latin typeface="Helvetica Neue"/><a:ea typeface="PingFang TC"/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Helvetica Neue"/><a:ea typeface="PingFang TC"/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Vox"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

const EMPTY_TREE = `<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>`;

/** A 16:9 PowerPoint: a title slide, then one slide per entry, with speaker notes. */
export function buildPptx(deck: Deck): Uint8Array {
  const slides = deck.slides.slice(0, 40);
  const margin = 838_200;
  const pages: string[] = [
    slideXml(
      bar(2, 0, 0, W, 228_600, ACCENT) +
        textBox(3, "Title", margin, 2_133_600, W - margin * 2, 1_676_400, `<a:p>${run(deck.title.slice(0, 140), 4800, INK, true)}</a:p>`, "b") +
        textBox(4, "Subtitle", margin, 3_962_400, W - margin * 2, 914_400, `<a:p>${run((deck.subtitle ?? "").slice(0, 200), 2200, SOFT)}</a:p>`),
    ),
    ...slides.map((slide, index) => {
      const bullets = slide.bullets.slice(0, 7);
      // Fewer, shorter points get larger type.
      const longest = Math.max(0, ...bullets.map((bullet) => bullet.length));
      const size = bullets.length <= 4 && longest <= 60 ? 2400 : bullets.length <= 5 && longest <= 90 ? 2000 : 1700;
      const body = bullets.length
        ? bullets
            .map(
              (bullet) =>
                `<a:p><a:pPr marL="342900" indent="-342900"><a:lnSpc><a:spcPct val="110000"/></a:lnSpc><a:spcAft><a:spcPts val="1000"/></a:spcAft><a:buClr><a:srgbClr val="${ACCENT}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>${run(bullet.slice(0, 260), size, INK)}</a:p>`,
            )
            .join("")
        : "<a:p><a:endParaRPr lang=\"en-US\"/></a:p>";
      return slideXml(
        bar(2, margin, 685_800, 685_800, 57_150, ACCENT) +
          textBox(3, "Title", margin, 838_200, W - margin * 2, 990_600, `<a:p>${run(slide.title.slice(0, 120), 3200, INK, true)}</a:p>`, "ctr") +
          textBox(4, "Body", margin, 2_057_400, W - margin * 2, 3_886_200, body) +
          textBox(5, "Page", W - margin - 914_400, H - 533_400, 914_400, 304_800, `<a:p><a:pPr algn="r"/>${run(String(index + 2), 1200, SOFT)}</a:p>`),
      );
    }),
  ];
  const notes = ["", ...slides.map((slide) => (slide.notes ?? "").trim().slice(0, 2000))];
  const files: Record<string, Uint8Array> = {};
  const add = (path: string, xml: string) => {
    files[path] = strToU8(xml);
  };

  add(
    "[Content_Types].xml",
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${pages
      .map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`)
      .join("")}${notes
      .map((note, index) => (note ? `<Override PartName="/ppt/notesSlides/notesSlide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>` : ""))
      .join("")}</Types>`,
  );
  add("_rels/.rels", rels([["rId1", "officeDocument", "ppt/presentation.xml"]]));
  add(
    "ppt/presentation.xml",
    `${XML}<p:presentation ${NS_A} ${NS_R} ${NS_P}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>${pages
      .map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 10}"/>`)
      .join("")}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="${H}" cy="9144000"/></p:presentation>`,
  );
  add(
    "ppt/_rels/presentation.xml.rels",
    rels([
      ["rId1", "slideMaster", "slideMasters/slideMaster1.xml"],
      ["rId2", "notesMaster", "notesMasters/notesMaster1.xml"],
      ["rId3", "theme", "theme/theme1.xml"],
      ...pages.map((_, index): [string, string, string] => [`rId${index + 10}`, "slide", `slides/slide${index + 1}.xml`]),
    ]),
  );
  add("ppt/theme/theme1.xml", THEME);
  add("ppt/theme/theme2.xml", THEME);
  add(
    "ppt/slideMasters/slideMaster1.xml",
    `${XML}<p:sldMaster ${NS_A} ${NS_R} ${NS_P}>${EMPTY_TREE}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
  );
  add("ppt/slideMasters/_rels/slideMaster1.xml.rels", rels([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"], ["rId2", "theme", "../theme/theme1.xml"]]));
  add("ppt/slideLayouts/slideLayout1.xml", `${XML}<p:sldLayout ${NS_A} ${NS_R} ${NS_P} type="blank">${EMPTY_TREE.replace(/<p:bg>.*?<\/p:bg>/u, "")}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  add("ppt/slideLayouts/_rels/slideLayout1.xml.rels", rels([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]));
  add(
    "ppt/notesMasters/notesMaster1.xml",
    `${XML}<p:notesMaster ${NS_A} ${NS_R} ${NS_P}>${EMPTY_TREE}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:notesMaster>`,
  );
  add("ppt/notesMasters/_rels/notesMaster1.xml.rels", rels([["rId1", "theme", "../theme/theme2.xml"]]));
  pages.forEach((xml, index) => {
    add(`ppt/slides/slide${index + 1}.xml`, xml);
    const slideRels: Array<[string, string, string]> = [["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"]];
    if (notes[index]) {
      slideRels.push(["rId2", "notesSlide", `../notesSlides/notesSlide${index + 1}.xml`]);
      add(`ppt/notesSlides/notesSlide${index + 1}.xml`, notesXml(notes[index]));
      add(`ppt/notesSlides/_rels/notesSlide${index + 1}.xml.rels`, rels([["rId1", "notesMaster", "../notesMasters/notesMaster1.xml"], ["rId2", "slide", `../slides/slide${index + 1}.xml`]]));
    }
    add(`ppt/slides/_rels/slide${index + 1}.xml.rels`, rels(slideRels));
  });
  return zipSync(files, { level: 6 });
}

function wordRun(text: string, size: number, bold = false, color = INK) {
  return `<w:r><w:rPr><w:rFonts w:ascii="Helvetica Neue" w:hAnsi="Helvetica Neue" w:eastAsia="PingFang TC"/>${bold ? "<w:b/>" : ""}<w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

/** A Word document: a title, then headed sections of paragraphs and bullet points. */
export function buildDocx(document: WordDocument): Uint8Array {
  const body: string[] = [`<w:p><w:pPr><w:spacing w:after="360"/></w:pPr>${wordRun(document.title.slice(0, 160), 52, true)}</w:p>`];
  for (const section of document.sections.slice(0, 60)) {
    if (section.heading.trim()) {
      body.push(`<w:p><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/></w:pPr>${wordRun(section.heading.slice(0, 160), 32, true, ACCENT)}</w:p>`);
    }
    for (const paragraph of section.paragraphs.slice(0, 40)) {
      body.push(`<w:p><w:pPr><w:spacing w:after="160" w:line="320" w:lineRule="auto"/></w:pPr>${wordRun(paragraph.slice(0, 4000), 23)}</w:p>`);
    }
    for (const bullet of (section.bullets ?? []).slice(0, 40)) {
      body.push(`<w:p><w:pPr><w:spacing w:after="80" w:line="300" w:lineRule="auto"/><w:ind w:left="480" w:hanging="280"/></w:pPr>${wordRun("•  ", 23, false, ACCENT)}${wordRun(bullet.slice(0, 1000), 23)}</w:p>`);
    }
  }
  return zipSync(
    {
      "[Content_Types].xml": strToU8(
        `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      ),
      "_rels/.rels": strToU8(rels([["rId1", "officeDocument", "word/document.xml"]])),
      "word/document.xml": strToU8(
        `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
      ),
    },
    { level: 6 },
  );
}
