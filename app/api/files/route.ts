import { requireUser } from "@/lib/auth";
import { formatMemoryContext } from "@/lib/memory";
import { listMemories } from "@/lib/memory-store";
import { loadProfileContext } from "@/lib/profile-store";
import { formatTaskContext, parseRecentMessages } from "@/lib/conversation-context";
import { getCurrentTimeContext } from "@/lib/time-context";
import {
  API_BUDGET_MESSAGE,
  isProviderBudgetError,
  ProviderBudgetError,
} from "@/lib/provider-error";
import {
  deleteAgentFile,
  getAgentFile,
  listAgentFiles,
  readAgentFile,
  saveAgentFile,
} from "@/lib/file-store";
import { askFirstAvailable, EXPERT_MODELS } from "@/lib/models";
import { buildDocx, buildPptx, DOCX_MIME, PPTX_MIME, type Deck, type WordDocument } from "@/lib/office-files";

const FILE_KINDS = {
  markdown_note: { purpose: "Note", extension: "md", mimeType: "text/markdown" },
  markdown_checklist: {
    purpose: "Checklist",
    extension: "md",
    mimeType: "text/markdown",
  },
  markdown_plan: { purpose: "Plan", extension: "md", mimeType: "text/markdown" },
  markdown_report: {
    purpose: "Report",
    extension: "md",
    mimeType: "text/markdown",
  },
  csv_table: { purpose: "Table", extension: "csv", mimeType: "text/csv" },
  json_data: { purpose: "Data", extension: "json", mimeType: "application/json" },
  html_page: { purpose: "Web page", extension: "html", mimeType: "text/html" },
  plain_text: { purpose: "Text", extension: "txt", mimeType: "text/plain" },
  // Built by Vox from structured content, so they always open (see lib/office-files.ts).
  slides_deck: { purpose: "Slides", extension: "pptx", mimeType: PPTX_MIME },
  word_document: { purpose: "Document", extension: "docx", mimeType: DOCX_MIME },
  python_code: { purpose: "Python", extension: "py", mimeType: "text/x-python" },
  javascript_code: {
    purpose: "JavaScript",
    extension: "js",
    mimeType: "text/javascript",
  },
  typescript_code: {
    purpose: "TypeScript",
    extension: "ts",
    mimeType: "text/typescript",
  },
} as const;

type FileKind = keyof typeof FILE_KINDS;

const stringList = { type: "array", items: { type: "string" } } as const;
/** What the model returns: the file's text, or structured content for slides and documents. */
const GENERATED_SCHEMAS = {
  text: {
    type: "object",
    properties: { title: { type: "string" }, filename_base: { type: "string" }, content: { type: "string" } },
    required: ["title", "filename_base", "content"],
    additionalProperties: false,
  },
  slides: {
    type: "object",
    properties: {
      title: { type: "string" },
      subtitle: { type: "string" },
      filename_base: { type: "string" },
      slides: {
        type: "array",
        items: {
          type: "object",
          properties: { title: { type: "string" }, bullets: stringList, notes: { type: "string" } },
          required: ["title", "bullets", "notes"],
          additionalProperties: false,
        },
      },
    },
    required: ["title", "subtitle", "filename_base", "slides"],
    additionalProperties: false,
  },
  document: {
    type: "object",
    properties: {
      title: { type: "string" },
      filename_base: { type: "string" },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: { heading: { type: "string" }, paragraphs: stringList, bullets: stringList },
          required: ["heading", "paragraphs", "bullets"],
          additionalProperties: false,
        },
      },
    },
    required: ["title", "filename_base", "sections"],
    additionalProperties: false,
  },
} as const;

function readOutputText(payload: {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}) {
  if (payload.output_text) return payload.output_text;
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text ?? "")
    .join("\n")
    .trim();
}

function fallbackKind(text: string): FileKind {
  const value = text.toLowerCase();
  if (/\b(slides?|slide deck|deck|presentation|powerpoint|pptx|keynote)\b|簡報|投影片/.test(value)) return "slides_deck";
  if (/\b(word|docx)\b|word ?檔|word ?文件/.test(value)) return "word_document";
  if (/\b(csv|spreadsheet|table)\b/.test(value)) return "csv_table";
  if (/\bjson\b/.test(value)) return "json_data";
  if (/\b(html|web ?page)\b/.test(value)) return "html_page";
  if (/\bpython\b/.test(value)) return "python_code";
  if (/\btypescript\b/.test(value)) return "typescript_code";
  if (/\bjavascript\b/.test(value)) return "javascript_code";
  if (/\bchecklist|to[- ]?do\b/.test(value)) return "markdown_checklist";
  if (/\bplan|roadmap\b/.test(value)) return "markdown_plan";
  if (/\breport|brief|proposal\b/.test(value)) return "markdown_report";
  if (/\btext file|\.txt\b/.test(value)) return "plain_text";
  return "markdown_note";
}

async function chooseFileKind(text: string): Promise<FileKind> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) return fallbackKind(text);

  try {
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "jev-latest",
        state: { request: text },
        questions: {
          file_kind: {
            type: "choice",
            instructions:
              "Choose the most useful downloadable file type for this explicit file-creation request. Respect a named format. Otherwise choose by purpose: a presentation, slide deck, or anything to present page by page uses slides; a document meant for Word, or to print, hand in, or send as a formal document, uses a Word document; notes, checklists, plans, and reports use Markdown; tabular rows use CSV; structured machine-readable data uses JSON; a standalone web document uses HTML; plain prose can use text; and executable source should use the named code language.",
            criteria: {
              markdown_note: "A general note or saved piece of writing in Markdown.",
              markdown_checklist: "An actionable checklist or to-do list in Markdown.",
              markdown_plan: "A plan, roadmap, agenda, or organized steps in Markdown.",
              markdown_report: "A brief, report, proposal, summary, or memo in Markdown.",
              slides_deck: "A presentation or slide deck (PowerPoint), including any request for slides or a number of slide pages.",
              word_document: "A Word document (.docx): a formal document, letter, essay, or handout to print or send.",
              csv_table: "Tabular information that belongs in CSV.",
              json_data: "Structured machine-readable data in JSON.",
              html_page: "A self-contained HTML document or web page.",
              plain_text: "Unformatted plain text.",
              python_code: "Python source code.",
              javascript_code: "JavaScript source code.",
              typescript_code: "TypeScript source code.",
            },
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`Jev returned ${response.status}`);
    const payload = (await response.json()) as {
      answers?: { file_kind?: { choice?: string } };
    };
    const choice = payload.answers?.file_kind?.choice as FileKind | undefined;
    return choice && choice in FILE_KINDS ? choice : fallbackKind(text);
  } catch (error) {
    console.error("Jev file classification failed", error);
    return fallbackKind(text);
  }
}

function safeBaseName(value: string) {
  const clean = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 72);
  return clean || `vox-file-${Date.now()}`;
}

function contentDisposition(name: string) {
  const ascii = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  try {
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) {
      return Response.json(
        { files: await listAgentFiles(auth.user.id) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const file = await getAgentFile(auth.user.id, id);
    if (!file) return Response.json({ error: "File not found." }, { status: 404 });
    const object = await readAgentFile(file);
    if (!object) return Response.json({ error: "File content is unavailable." }, { status: 404 });

    return new Response(object.body, {
      headers: {
        "Content-Type": /^(text\/|application\/json)/u.test(file.mimeType) ? `${file.mimeType}; charset=utf-8` : file.mimeType,
        "Content-Length": String(file.size),
        "Content-Disposition": contentDisposition(file.name),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("File read failed", error);
    return Response.json({ error: "Files are temporarily unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { text?: string; recentMessages?: unknown };
  const text = body.text?.trim().slice(0, 12000) ?? "";
  if (!text) return Response.json({ error: "A file request is required." }, { status: 400 });
  const conversationContext = formatTaskContext(parseRecentMessages(body.recentMessages), text);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "File creation is not configured." }, { status: 503 });

  try {
    const kind = await chooseFileKind(text);
    const config = FILE_KINDS[kind];
    const remembered = await listMemories(auth.user.id, 16).catch(() => []);
    const profileBackground = await loadProfileContext(
      auth.user.id,
      remembered.map((memory) => memory.content),
      1200,
    );
    const memoryContext =
      (remembered.length ? `\n\n${formatMemoryContext(remembered)}` : "") +
      (profileBackground ? `\n\n${profileBackground}` : "");
    // Slides and documents are worth the strongest writer; other files stay quick.
    const models = kind === "slides_deck" || kind === "word_document" ? EXPERT_MODELS : (["gpt-5.6-terra"] as const);
    const response = await askFirstAvailable(models, (model) => fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": "vox-private-file-creator",
      },
      body: JSON.stringify({
        model,
        input: text,
        instructions:
          (kind === "slides_deck"
            ? "Write the content of a presentation that Vox will turn into a PowerPoint file. Follow the user's requested language; use Traditional Chinese and natural Taiwan wording for Chinese. Return a short human title, a one-line subtitle, a concise lowercase ASCII filename base without an extension, and the slides. The file gets a title slide automatically, so when the user asks for N slides or pages, write N minus one content slides (at least one); with no number, write 6 to 9. Each slide has a short title, three to five bullets that are concrete and specific (facts, examples, numbers you are confident of; no filler such as 'Introduction' followed by nothing), each bullet one line of at most about 20 words or 40 Chinese characters, and speaker notes of two to four sentences the presenter can say. The last slide gives takeaways or next steps. Do not claim the file was saved; the application handles saving."
            : kind === "word_document"
              ? "Write the content of a document that Vox will turn into a Word file. Follow the user's requested language; use Traditional Chinese and natural Taiwan wording for Chinese. Return a short human title, a concise lowercase ASCII filename base without an extension, and the sections in order. Each section has a heading (empty for an opening paragraph), its paragraphs as plain text without Markdown, and bullets only where a list reads better than prose (otherwise an empty list). Write complete, finished prose, not an outline. Do not claim the file was saved; the application handles saving."
              : `Create the complete content for a downloadable ${config.purpose} file with extension .${config.extension}. Follow the user's requested language; use Traditional Chinese and natural Taiwan wording for Chinese. Return a short human title, a concise lowercase ASCII filename base without an extension, and the exact complete file content. Do not wrap the content in an extra Markdown code fence. Do not claim the file was saved; the application handles saving. For code, make it complete and include helpful comments only when useful. For CSV, include a header row. For JSON, output valid JSON as the content string. For HTML, create a self-contained accessible document without external scripts.`) +
          " When the request refers to earlier discussion (for example 'put what we discussed into a file'), build the file from that conversation." +
          `\n\n${getCurrentTimeContext()}` +
          memoryContext +
          (conversationContext ? `\n\n${conversationContext}` : ""),
        reasoning: { effort: "low" },
        max_output_tokens: 7000,
        store: false,
        text: {
          verbosity: "medium",
          format: {
            type: "json_schema",
            name: "generated_file",
            strict: true,
            schema: GENERATED_SCHEMAS[kind === "slides_deck" ? "slides" : kind === "word_document" ? "document" : "text"],
          },
        },
      }),
    }));
    const payload = (await response.json()) as Parameters<typeof readOutputText>[0];
    if (!response.ok) {
      if (isProviderBudgetError(response, payload)) throw new ProviderBudgetError();
      throw new Error(`OpenAI returned ${response.status}`);
    }
    const generated = JSON.parse(readOutputText(payload)) as {
      title?: string;
      filename_base?: string;
      content?: string;
      subtitle?: string;
      slides?: Deck["slides"];
      sections?: WordDocument["sections"];
    };
    const title = generated.title?.trim().slice(0, 140) || config.purpose;
    if (kind === "slides_deck" || kind === "word_document") {
      const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : []);
      let bytes: Uint8Array;
      let pages = 0;
      if (kind === "slides_deck") {
        const slides = (Array.isArray(generated.slides) ? generated.slides : [])
          .map((slide) => ({ title: String(slide?.title ?? "").trim(), bullets: strings(slide?.bullets), notes: typeof slide?.notes === "string" ? slide.notes : "" }))
          .filter((slide) => slide.title || slide.bullets.length);
        if (!slides.length) throw new Error("The generated deck was empty");
        pages = slides.length + 1;
        bytes = buildPptx({ title, subtitle: typeof generated.subtitle === "string" ? generated.subtitle : "", slides });
      } else {
        const sections = (Array.isArray(generated.sections) ? generated.sections : [])
          .map((section) => ({ heading: String(section?.heading ?? "").trim(), paragraphs: strings(section?.paragraphs), bullets: strings(section?.bullets) }))
          .filter((section) => section.heading || section.paragraphs.length || section.bullets.length);
        if (!sections.length) throw new Error("The generated document was empty");
        bytes = buildDocx({ title, sections });
      }
      const file = await saveAgentFile(auth.user.id, {
        name: `${safeBaseName(generated.filename_base ?? title)}.${config.extension}`,
        title,
        purpose: config.purpose,
        mimeType: config.mimeType,
        content: "",
        bytes,
      });
      return Response.json({ file, kind, source: "jev", ...(pages ? { pages } : {}) }, { status: 201 });
    }
    const content = generated.content ?? "";
    if (!content.trim()) throw new Error("The generated file was empty");
    if (new TextEncoder().encode(content).byteLength > 512_000) {
      throw new Error("The generated file exceeded the size limit");
    }

    const name = `${safeBaseName(generated.filename_base ?? title)}.${config.extension}`;
    const file = await saveAgentFile(auth.user.id, {
      name,
      title,
      purpose: config.purpose,
      mimeType: config.mimeType,
      content,
    });
    return Response.json({ file, kind, source: "jev" }, { status: 201 });
  } catch (error) {
    console.error("File creation failed", error);
    return Response.json(
      {
        error:
          error instanceof ProviderBudgetError
            ? API_BUDGET_MESSAGE
            : "Vox could not create that file yet.",
      },
      { status: error instanceof ProviderBudgetError ? 402 : 502 },
    );
  }
}

export async function DELETE(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { id?: string };
  const id = body.id?.trim() ?? "";
  if (!id) return Response.json({ error: "File id is required." }, { status: 400 });

  try {
    const file = await getAgentFile(auth.user.id, id);
    if (!file) return Response.json({ error: "File not found." }, { status: 404 });
    await deleteAgentFile(auth.user.id, file);
    return Response.json({ deletedId: id });
  } catch (error) {
    console.error("File deletion failed", error);
    return Response.json({ error: "The file could not be deleted." }, { status: 503 });
  }
}
