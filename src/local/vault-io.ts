import { App, TFile, normalizePath } from "obsidian";
import type { LocalFileInfo } from "../types";

export function defaultIgnorePatterns(configDir: string): string[] {
  const cfg = configDir.replace(/^\/+|\/+$/g, "");
  const patterns = [".trash/**", "**/.DS_Store", "**/Thumbs.db"];
  if (cfg) patterns.unshift(`${cfg}/**`);
  return patterns;
}

export function parseIgnorePatterns(raw: string, configDir: string): string[] {
  const user = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  return [...defaultIgnorePatterns(configDir), ...user];
}

/** Minimal glob: * and ** and ? — path uses forward slashes */
export function matchGlob(path: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/{{GLOBSTAR}}/g, ".*");
  const re = new RegExp(`^${escaped}$`);
  return re.test(path);
}

export function isIgnored(path: string, patterns: string[]): boolean {
  return patterns.some((p) => matchGlob(path, p));
}

export function listLocalFiles(app: App, ignorePatternsRaw: string): LocalFileInfo[] {
  const patterns = parseIgnorePatterns(ignorePatternsRaw, app.vault.configDir);
  const files = app.vault.getFiles();
  const out: LocalFileInfo[] = [];
  for (const f of files) {
    if (isIgnored(f.path, patterns)) continue;
    out.push({
      path: f.path,
      mtime: f.stat.mtime,
      size: f.stat.size,
    });
  }
  return out;
}

export async function readBinary(app: App, path: string): Promise<ArrayBuffer> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    throw new Error(`Missing file: ${path}`);
  }
  return app.vault.readBinary(file);
}

export async function writeBinary(
  app: App,
  path: string,
  data: ArrayBuffer,
  mtime?: number,
): Promise<TFile> {
  const normalized = normalizePath(path);
  await ensureParentFolders(app, normalized);
  const existing = app.vault.getAbstractFileByPath(normalized);
  let file: TFile;
  if (existing instanceof TFile) {
    await app.vault.modifyBinary(existing, data, mtime != null ? { mtime } : undefined);
    file = existing;
  } else {
    file = await app.vault.createBinary(
      normalized,
      data,
      mtime != null ? { mtime } : undefined,
    );
  }
  return file;
}

export async function deleteLocal(app: App, path: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(normalizePath(path));
  if (file) {
    await app.fileManager.trashFile(file);
  }
}

export async function renameAside(app: App, path: string, stamp: string): Promise<string> {
  const file = app.vault.getAbstractFileByPath(normalizePath(path));
  if (!(file instanceof TFile)) {
    throw new Error(`Cannot conflict-rename missing file: ${path}`);
  }
  const dot = file.name.lastIndexOf(".");
  const base = dot >= 0 ? file.name.slice(0, dot) : file.name;
  const ext = dot >= 0 ? file.name.slice(dot) : "";
  const parent = file.parent?.path && file.parent.path !== "/" ? file.parent.path : "";
  let candidate = parent
    ? `${parent}/${base} (conflict ${stamp})${ext}`
    : `${base} (conflict ${stamp})${ext}`;
  let i = 2;
  while (app.vault.getAbstractFileByPath(normalizePath(candidate))) {
    candidate = parent
      ? `${parent}/${base} (conflict ${stamp}) ${i}${ext}`
      : `${base} (conflict ${stamp}) ${i}${ext}`;
    i++;
  }
  await app.fileManager.renameFile(file, normalizePath(candidate));
  return candidate;
}

async function ensureParentFolders(app: App, path: string): Promise<void> {
  const parts = path.split("/");
  if (parts.length <= 1) return;
  let cur = "";
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur ? `${cur}/${parts[i]}` : parts[i];
    const existing = app.vault.getAbstractFileByPath(cur);
    if (!existing) {
      await app.vault.createFolder(cur);
    }
  }
}
