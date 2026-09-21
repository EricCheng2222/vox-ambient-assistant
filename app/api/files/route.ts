import { requireAuthorized } from "@/lib/auth";
import { formatMemoryContext } from "@/lib/memory";
import { listMemories } from "@/lib/memory-store";
import { getCurrentTimeContext } from "@/lib/time-context";
import {
  deleteAgentFile,
  getAgentFile,
  listAgentFiles,
  readAgentFile,
  saveAgentFile,
} from "@/lib/file-store";

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
              "Choose the most useful downloadable file type for this explicit file-creation request. Respect a named format. Otherwise choose by purpose: notes, checklists, plans, and reports use Markdown; tabular rows use CSV; structured machine-readable data uses JSON; a standalone web document uses HTML; plain prose can use text; and executable source should use the named code language.",
            criteria: {
              markdown_note: "A general note or saved piece of writing in Markdown.",
              markdown_checklist: "An actionable checklist or to-do list in Markdown.",
              markdown_plan: "A plan, roadmap, agenda, or organized steps in Markdown.",
              markdown_report: "A brief, report, proposal, summary, or memo in Markdown.",
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
  const unauthorized = await requireAuthorized(request);
  if (unauthorized) return unauthorized;

  try {
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) {
      return Response.json(
        { files: await listAgentFiles() },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const file = await getAgentFile(id);
    if (!file) return Response.json({ error: "File not found." }, { status: 404 });
    const object = await readAgentFile(file);
    if (!object) return Response.json({ error: "File content is unavailable." }, { status: 404 });

    return new Response(object.body, {
      headers: {
        "Content-Type": `${file.mimeType}; charset=utf-8`,
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
  const unauthorized = await requireAuthorized(request);
  if (unauthorized) return unauthorized;

  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const text = body.text?.trim().slice(0, 12000) ?? "";
  if (!text) return Response.json({ error: "A file request is required." }, { status: 400 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "File creation is not configured." }, { status: 503 });

  try {
    const kind = await chooseFileKind(text);
    const config = FILE_KINDS[kind];
    const remembered = await listMemories(16).catch(() => []);
    const memoryContext = remembered.length ? `\n\n${formatMemoryContext(remembered)}` : "";
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": "vox-private-file-creator",
      },
      body: JSON.stringify({
        model: "gpt-5.6-terra",
        input: text,
        instructions:
          `Create the complete content for a downloadable ${config.purpose} file with extension .${config.extension}. Follow the user's requested language; use Traditional Chinese and natural Taiwan wording for Chinese. Return a short human title, a concise lowercase ASCII filename base without an extension, and the exact complete file content. Do not wrap the content in an extra Markdown code fence. Do not claim the file was saved; the application handles saving. For code, make it complete and include helpful comments only when useful. For CSV, include a header row. For JSON, output valid JSON as the content string. For HTML, create a self-contained accessible document without external scripts.` +
          `\n\n${getCurrentTimeContext()}` +
          memoryContext,
        reasoning: { effort: "low" },
        max_output_tokens: 7000,
        store: false,
        text: {
          verbosity: "medium",
          format: {
            type: "json_schema",
            name: "generated_file",
            strict: true,
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                filename_base: { type: "string" },
                content: { type: "string" },
              },
              required: ["title", "filename_base", "content"],
              additionalProperties: false,
            },
          },
        },
      }),
    });
    const payload = (await response.json()) as Parameters<typeof readOutputText>[0];
    if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
    const generated = JSON.parse(readOutputText(payload)) as {
      title?: string;
      filename_base?: string;
      content?: string;
    };
    const title = generated.title?.trim().slice(0, 140) || config.purpose;
    const content = generated.content ?? "";
    if (!content.trim()) throw new Error("The generated file was empty");
    if (new TextEncoder().encode(content).byteLength > 512_000) {
      throw new Error("The generated file exceeded the size limit");
    }

    const name = `${safeBaseName(generated.filename_base ?? title)}.${config.extension}`;
    const file = await saveAgentFile({
      name,
      title,
      purpose: config.purpose,
      mimeType: config.mimeType,
      content,
    });
    return Response.json({ file, kind, source: "jev" }, { status: 201 });
  } catch (error) {
    console.error("File creation failed", error);
    return Response.json({ error: "Vox could not create that file yet." }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const unauthorized = await requireAuthorized(request);
  if (unauthorized) return unauthorized;

  const body = (await request.json().catch(() => ({}))) as { id?: string };
  const id = body.id?.trim() ?? "";
  if (!id) return Response.json({ error: "File id is required." }, { status: 400 });

  try {
    const file = await getAgentFile(id);
    if (!file) return Response.json({ error: "File not found." }, { status: 404 });
    await deleteAgentFile(file);
    return Response.json({ deletedId: id });
  } catch (error) {
    console.error("File deletion failed", error);
    return Response.json({ error: "The file could not be deleted." }, { status: 503 });
  }
}
