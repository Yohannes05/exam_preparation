/**
 * Port of backend/app/Services/TelegraphPublisher.php.
 *
 * Publishes a chapter's notes to telegra.ph as a single article and stores
 * the resulting URL/path on the chapter. HTML note content is converted to
 * Telegraph's node format using linkedom (a light DOM implementation).
 */

import type { PrismaClient } from "@prisma/client";
import { parseHTML } from "linkedom";
import { config } from "./config";
import { url as storageUrl } from "./storage";

type TelegraphNode = string | { tag: string; attrs?: Record<string, string>; children?: TelegraphNode[] };

type ChapterData = {
  id: number;
  order: number;
  title: string;
  telegraphUrl: string | null;
  telegraphPath: string | null;
  subject: {
    name: string;
    order: number;
    grade: { level: number };
  };
  notes: Array<{ title: string; content: string; imageFile: string | null }>;
};

export async function publishChapterNotes(db: PrismaClient, chapterId: number): Promise<{ url: string; path: string }> {
  const token = config.telegraph.accessToken;
  if (!token) {
    throw new Error("Set TELEGRAPH_ACCESS_TOKEN in .env before publishing chapter notes.");
  }

  const chapter = (await db.chapter.findUnique({
    where: { id: chapterId },
    include: {
      subject: { include: { grade: true } },
      notes: {
        orderBy: [{ order: "asc" }, { id: "asc" }],
        select: { title: true, content: true, imageFile: true },
      },
    },
  })) as ChapterData | null;

  if (!chapter) throw new Error("Chapter not found.");
  if (chapter.notes.length === 0) {
    throw new Error("Add at least one note to this chapter before publishing.");
  }

  const content: TelegraphNode[] = [];
  for (const note of chapter.notes) {
    content.push({ tag: "h3", children: [note.title] });
    content.push(...htmlNodes(note.content));
    if (note.imageFile) {
      const imageUrl = storageUrl(note.imageFile);
      if (/^https?:\/\//i.test(imageUrl)) {
        content.push({ tag: "img", attrs: { src: imageUrl } });
      }
    }
  }

  const json = JSON.stringify(content);
  if (json.length > 64_000) {
    throw new Error(
      "This chapter article is over Telegraph's 64 KB limit. Shorten the note content before publishing.",
    );
  }

  const title = `Grade ${chapter.subject.grade.level} · ${chapter.subject.name} · Chapter ${chapter.order || ""} ${chapter.title}`.trim();
  const payload = {
    access_token: token,
    title,
    content: json,
    author_name: config.app.name,
  };

  const page = chapter.telegraphPath
    ? (await telegraphRequest(`editPage/${chapter.telegraphPath}`, { ...payload, return_content: "false" })).result
    : (await telegraphRequest("createPage", { ...payload, return_content: "false" })).result;

  const result = { url: String(page.url ?? ""), path: String(page.path ?? "") };
  await db.chapter.update({
    where: { id: chapter.id },
    data: { telegraphUrl: result.url, telegraphPath: result.path },
  });

  return result;
}

async function telegraphRequest(
  method: string,
  payload: Record<string, string>,
): Promise<{ result: { url?: string; path?: string } }> {
  const response = await fetch(`https://api.telegra.ph/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(payload),
    signal: AbortSignal.timeout(20_000),
  });

  const body = (await response.json().catch(() => null)) as
    | { ok?: boolean; error?: string; result?: { url?: string; path?: string } }
    | null;

  if (!response.ok || !body?.ok) {
    throw new Error(String(body?.error ?? "Telegraph publishing failed."));
  }

  return body as { result: { url?: string; path?: string } };
}

/** Convert an HTML fragment to the flat node list Telegraph expects. */
function htmlNodes(html: string): TelegraphNode[] {
  const ALLOWED = new Set([
    "p", "br", "h3", "h4", "strong", "b", "em", "i", "u", "s",
    "blockquote", "pre", "code", "ul", "ol", "li", "a", "img",
  ]);

  const { document } = parseHTML(`<div id="root">${html}</div>`);
  const root = document.querySelector("#root");

  if (!root) return [{ tag: "p", children: [""] }];

  const nodes: TelegraphNode[] = [];
  for (const child of root.childNodes) {
    nodes.push(...convert(child));
  }
  return nodes.length ? nodes : [{ tag: "p", children: [""] }];

  function convert(node: Node): TelegraphNode[] {
    if (node.nodeType === 3) {
      // Text node.
      const text = (node.textContent ?? "").trim();
      return text === "" ? [] : [text];
    }
    if (node.nodeType !== 1) return []; // Element; comments and others dropped.

    const element = node as unknown as {
      tagName: string;
      getAttribute(name: string): string;
    };
    const children: TelegraphNode[] = [];
    for (const child of node.childNodes) {
      children.push(...convert(child));
    }

    const tag = element.tagName.toLowerCase();
    if (!(tag in ALLOWED) && !ALLOWED.has(tag)) return children;

    const attrs: Record<string, string> = {};
    if (tag === "a") {
      const href = element.getAttribute("href") ?? "";
      if (href && /^https?:\/\//i.test(href)) attrs.href = href;
    }
    if (tag === "img") {
      const src = element.getAttribute("src") ?? "";
      if (!/^https?:\/\//i.test(src)) return [];
      attrs.src = src;
    }

    const entry: { tag: string; attrs?: Record<string, string>; children?: TelegraphNode[] } = { tag };
    if (Object.keys(attrs).length) entry.attrs = attrs;
    if (!["br", "img"].includes(tag)) entry.children = children;

    return [entry];
  }
}
