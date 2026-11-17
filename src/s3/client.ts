import { requestUrl } from "obsidian";
import type { ZyncSettings, RemoteObject } from "../types";
import { signRequest } from "./sigv4";

export class S3Error extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "S3Error";
  }
}

function s3Fail(action: string, status: number): S3Error {
  return new S3Error(`S3 ${action} failed (${status})`, status);
}

function trimSlashes(s: string): string {
  return s.replace(/^\/+|\/+$/g, "");
}

function joinKey(prefix: string, path: string): string {
  const p = trimSlashes(prefix);
  const rest = path.replace(/^\/+/, "");
  if (!p) return rest;
  return `${p}/${rest}`;
}

function keyToPath(prefix: string, key: string): string | null {
  const p = trimSlashes(prefix);
  if (!p) return key;
  const withSlash = p + "/";
  if (!key.startsWith(withSlash) && key !== p) return null;
  if (key === p) return null;
  return key.slice(withSlash.length);
}

export class S3Client {
  constructor(private settings: ZyncSettings) {}

  updateSettings(settings: ZyncSettings) {
    this.settings = settings;
  }

  private endpointBase(): string {
    const raw = this.settings.endpoint.trim().replace(/\/+$/, "");
    if (!raw) {
      return `https://s3.${this.settings.region}.amazonaws.com`;
    }
    if (!/^https?:\/\//i.test(raw)) {
      return `https://${raw}`;
    }
    return raw;
  }

  private objectUrl(key: string): URL {
    const base = this.endpointBase();
    const bucket = this.settings.bucket.trim();
    if (this.settings.forcePathStyle) {
      return new URL(`${base}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`);
    }
    // Virtual-hosted–style: https://bucket.endpoint/key
    const u = new URL(base);
    u.hostname = `${bucket}.${u.hostname}`;
    u.pathname = "/" + key.split("/").map(encodeURIComponent).join("/");
    return u;
  }

  private listUrl(params: Record<string, string>): URL {
    const base = this.endpointBase();
    const bucket = this.settings.bucket.trim();
    let url: URL;
    if (this.settings.forcePathStyle) {
      url = new URL(`${base}/${bucket}`);
    } else {
      url = new URL(base);
      url.hostname = `${bucket}.${url.hostname}`;
      url.pathname = "/";
    }
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    return url;
  }

  private async signedRequest(
    method: string,
    url: URL,
    body?: ArrayBuffer,
    extraHeaders?: Record<string, string>,
  ) {
    const headers: Record<string, string> = { ...(extraHeaders ?? {}) };
    if (body && !headers["content-type"]) {
      headers["content-type"] = "application/octet-stream";
    }

    const signed = await signRequest({
      method,
      url,
      headers,
      body,
      accessKeyId: this.settings.accessKeyId,
      secretAccessKey: this.settings.secretAccessKey,
      region: this.settings.region || "auto",
    });

    const res = await requestUrl({
      url: url.toString(),
      method,
      headers: signed.headers,
      body,
      throw: false,
    });

    return res;
  }

  async testConnection(): Promise<void> {
    const url = this.listUrl({
      "list-type": "2",
      "max-keys": "1",
      prefix: trimSlashes(this.settings.prefix) ? trimSlashes(this.settings.prefix) + "/" : "",
    });
    const res = await this.signedRequest("GET", url);
    if (res.status >= 300) {
      throw s3Fail("list", res.status);
    }
  }

  async listAll(): Promise<RemoteObject[]> {
    const prefix = trimSlashes(this.settings.prefix);
    const prefixWithSlash = prefix ? prefix + "/" : "";
    const out: RemoteObject[] = [];
    let token: string | undefined;

    do {
      const params: Record<string, string> = {
        "list-type": "2",
        "max-keys": "1000",
      };
      if (prefixWithSlash) params.prefix = prefixWithSlash;
      if (token) params["continuation-token"] = token;

      const url = this.listUrl(params);
      const res = await this.signedRequest("GET", url);
      if (res.status >= 300) {
        throw s3Fail("list", res.status);
      }

      const xml: string = res.text;
      const contents: RegExpMatchArray[] = Array.from(
        xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g),
      );
      for (const match of contents) {
        const block: string = match[1] ?? "";
        const key = textOf(block, "Key");
        if (!key) continue;
        // Skip directory placeholders and internal manifest
        if (key.endsWith("/")) continue;
        const path = keyToPath(this.settings.prefix, key);
        if (!path) continue;
        if (path === "_zync/manifest.json" || path.startsWith("_zync/")) continue;

        const sizeText = textOf(block, "Size") ?? "0";
        const modifiedText = textOf(block, "LastModified") ?? "";
        const etagText = textOf(block, "ETag") ?? "";
        out.push({
          key,
          path,
          size: Number(sizeText),
          lastModified: Date.parse(modifiedText) || 0,
          etag: etagText.replace(/"/g, ""),
        });
      }

      const truncated = textOf(xml, "IsTruncated") === "true";
      const nextToken = textOf(xml, "NextContinuationToken");
      token = truncated ? nextToken || undefined : undefined;
    } while (token);

    return out;
  }

  objectKey(path: string): string {
    return joinKey(this.settings.prefix, path);
  }

  async getObject(path: string): Promise<{
    body: ArrayBuffer;
    etag: string;
    metaMtime?: number;
    metaHash?: string;
  }> {
    const key = this.objectKey(path);
    const url = this.objectUrl(key);
    const res = await this.signedRequest("GET", url);
    if (res.status === 404) {
      throw new S3Error("Not found", 404);
    }
    if (res.status >= 300) {
      throw s3Fail("get", res.status);
    }
    const headers = lowerHeaders(res.headers);
    return {
      body: res.arrayBuffer,
      etag: (headers["etag"] || "").replace(/"/g, ""),
      metaMtime: headers["x-amz-meta-zync-mtime"]
        ? Number(headers["x-amz-meta-zync-mtime"])
        : undefined,
      metaHash: headers["x-amz-meta-zync-hash"],
    };
  }

  async putObject(
    path: string,
    body: ArrayBuffer,
    meta: { mtime: number; hash: string },
  ): Promise<{ etag: string }> {
    const key = this.objectKey(path);
    const url = this.objectUrl(key);
    const res = await this.signedRequest("PUT", url, body, {
      "content-type": "application/octet-stream",
      "x-amz-meta-zync-mtime": String(meta.mtime),
      "x-amz-meta-zync-hash": meta.hash,
    });
    if (res.status >= 300) {
      throw s3Fail("put", res.status);
    }
    const headers = lowerHeaders(res.headers);
    return { etag: (headers["etag"] || "").replace(/"/g, "") };
  }

  async deleteObject(path: string): Promise<void> {
    const key = this.objectKey(path);
    const url = this.objectUrl(key);
    const res = await this.signedRequest("DELETE", url);
    if (res.status >= 300 && res.status !== 404) {
      throw s3Fail("delete", res.status);
    }
  }

  async headObject(path: string): Promise<{
    etag: string;
    size: number;
    lastModified: number;
    metaMtime?: number;
    metaHash?: string;
  } | null> {
    const key = this.objectKey(path);
    const url = this.objectUrl(key);
    const res = await this.signedRequest("HEAD", url);
    if (res.status === 404) return null;
    if (res.status >= 300) {
      throw s3Fail("head", res.status);
    }
    const headers = lowerHeaders(res.headers);
    return {
      etag: (headers["etag"] || "").replace(/"/g, ""),
      size: Number(headers["content-length"] || "0"),
      lastModified: Date.parse(headers["last-modified"] || "") || 0,
      metaMtime: headers["x-amz-meta-zync-mtime"]
        ? Number(headers["x-amz-meta-zync-mtime"])
        : undefined,
      metaHash: headers["x-amz-meta-zync-hash"],
    };
  }
}

function textOf(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  if (!m) return null;
  return decodeXml(m[1]);
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function lowerHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}
