/** Runtime-safe check for multipart files across Node versions. */
export function isUploadedFile(value: FormDataEntryValue | null): value is File {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<File>;
  return typeof candidate.name === "string"
    && typeof candidate.size === "number"
    && typeof candidate.arrayBuffer === "function"
    && typeof candidate.text === "function";
}
