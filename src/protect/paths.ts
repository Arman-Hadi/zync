/** Normalize folder setting to vault-relative path without trailing slash. */
export function normalizeFolderPath(folder: string): string {
  const n = folder
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (!n || n === ".") return "";
  return n;
}

/** Normalize a vault-relative file path. */
export function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "");
}

/** True if path is a Markdown note inside the protected folder. */
export function isProtectedMarkdownPath(path: string, protectedFolder: string): boolean {
  const folder = normalizeFolderPath(protectedFolder);
  if (!folder) return false;
  const p = normalizeVaultPath(path);
  if (!p.toLowerCase().endsWith(".md")) return false;
  return p.startsWith(folder + "/");
}

export function isMarkdownPath(path: string): boolean {
  return normalizeVaultPath(path).toLowerCase().endsWith(".md");
}
