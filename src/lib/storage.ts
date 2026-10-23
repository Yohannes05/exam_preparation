/**
 * Port of backend/app/Services/SupabasePublicStorage.php.
 *
 * Stores publicly readable lesson assets in Supabase Storage when
 * configured; falls back to the local filesystem (./public/uploads)
 * in development, mirroring Laravel's 'public' disk.
 */

import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

export type FilePayload = { bytes: ArrayBuffer; name: string; contentType: string };

export function storageEnabled(): boolean {
  const storage = config.supabase.storage;
  return Boolean(storage.url && storage.bucket && storage.key);
}

function objectUrl(storedPath: string): string {
  const storage = config.supabase.storage;
  const segments = ltrim(storedPath, "/").split("/").map(encodeURIComponent);
  return `${rtrim(storage.url, "/")}/storage/v1/object/${encodeURIComponent(storage.bucket)}/${segments.join("/")}`;
}

async function request(): Promise<HeadersInit> {
  const storage = config.supabase.storage;
  return {
    apikey: storage.key,
    Authorization: `Bearer ${storage.key}`,
  };
}

export async function upload(file: FilePayload, directory: string): Promise<string> {
  const extension = extensionOf(file.name);

  if (!storageEnabled()) {
    const storedPath = `${directory}/${randomName()}.${extension}`;
    const target = path.join(process.cwd(), "public", "uploads", storedPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(file.bytes));
    return storedPath;
  }

  const storedPath = `${directory.replace(/^\/+|\/+$/g, "")}/${randomName()}.${extension}`;
  const response = await fetch(objectUrl(storedPath), {
    method: "POST",
    headers: {
      ...(await request()),
      "Content-Type": file.contentType || "application/octet-stream",
      "x-upsert": "false",
    },
    body: Buffer.from(file.bytes),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`Supabase Storage upload failed: HTTP ${response.status}`);
  }

  return storedPath;
}

export async function deleteFile(storedPath: string | null | undefined): Promise<void> {
  if (!storedPath) return;

  const resolved = storedPathUrl(storedPath);
  if (!resolved) return;

  if (!storageEnabled()) {
    try {
      await unlink(path.join(process.cwd(), "public", "uploads", resolved));
    } catch {
      // Already gone — deleting a missing local file is not an error.
    }
    return;
  }

  const response = await fetch(objectUrl(resolved), {
    method: "DELETE",
    headers: await request(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Supabase Storage delete failed: HTTP ${response.status}`);
  }
}

/** Public URL for a stored path (passes through absolute URLs untouched). */
export function url(storedPath: string | null | undefined): string {
  if (!storedPath) return "";

  if (/^https?:\/\//i.test(storedPath)) return storedPath;

  if (!storageEnabled()) {
    return `/uploads/${storedPath.split("/").map(encodeURIComponent).join("/")}`;
  }

  const segments = ltrim(storedPath, "/").split("/").map(encodeURIComponent);
  return `${rtrim(config.supabase.storage.url, "/")}/storage/v1/object/public/${encodeURIComponent(
    config.supabase.storage.bucket,
  )}/${segments.join("/")}`;
}

/**
 * The stored-path form of a value: full public URLs are converted back
 * to their bucket-relative path so delete() can act on them.
 */
function storedPathUrl(value: string): string | null {
  if (!/^https?:\/\//i.test(value)) return value;

  const base = rtrim(config.supabase.storage.url || "", "/");
  const bucket = encodeURIComponent(config.supabase.storage.bucket || "");
  const prefix = base
    ? `${base}/storage/v1/object/public/`
    : "";
  const bucketPrefix = `${prefix}${bucket}/`;
  if (!prefix || !value.startsWith(bucketPrefix)) return null;

  return decodeURIComponent(value.slice(bucketPrefix.length));
}

function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  return match ? match[1].toLowerCase() : "bin";
}

function randomName(): string {
  return globalThis.crypto.randomUUID();
}

function rtrim(value: string, char: string): string {
  return value.endsWith(char) ? value.slice(0, -char.length) : value;
}

function ltrim(value: string, char: string): string {
  return value.startsWith(char) ? value.slice(char.length) : value;
}
