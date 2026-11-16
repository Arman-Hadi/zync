const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(digest);
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const keyBytes = key instanceof ArrayBuffer ? new Uint8Array(key) : new Uint8Array(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
}

async function getSignatureKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<ArrayBuffer> {
  const kDate = await hmac(enc.encode("AWS4" + secretKey), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

export interface SignRequestInput {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: ArrayBuffer | string | undefined;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
}

export interface SignedRequest {
  headers: Record<string, string>;
}

/** Sign an S3 request with AWS Signature Version 4 (Web Crypto). */
export async function signRequest(input: SignRequestInput): Promise<SignedRequest> {
  const service = input.service ?? "s3";
  const now = new Date();
  const amzDate =
    now.getUTCFullYear().toString() +
    String(now.getUTCMonth() + 1).padStart(2, "0") +
    String(now.getUTCDate()).padStart(2, "0") +
    "T" +
    String(now.getUTCHours()).padStart(2, "0") +
    String(now.getUTCMinutes()).padStart(2, "0") +
    String(now.getUTCSeconds()).padStart(2, "0") +
    "Z";
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = await sha256Hex(input.body ?? "");

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers)) {
    headers[k.toLowerCase()] = v.trim();
  }
  headers["x-amz-date"] = amzDate;
  headers["x-amz-content-sha256"] = payloadHash;
  if (!headers["host"]) {
    headers["host"] = input.url.host;
  }

  const signedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${headers[k]}\n`).join("");
  const signedHeaders = signedHeaderKeys.join(";");

  const canonicalQuery = [...input.url.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  // Encode path segments but keep slashes
  const canonicalUri =
    input.url.pathname
      .split("/")
      .map((seg) => encodeURIComponent(decodeURIComponent(seg)))
      .join("/") || "/";

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${input.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await getSignatureKey(
    input.secretAccessKey,
    dateStamp,
    input.region,
    service,
  );
  const signature = toHex(await hmac(signingKey, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  // Obsidian requestUrl sets Host / Content-Length itself — omit them from outbound headers
  const outbound: Record<string, string> = {
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    Authorization: authorization,
  };
  for (const [k, v] of Object.entries(headers)) {
    if (k === "host" || k === "content-length" || k === "authorization") continue;
    if (k === "x-amz-date" || k === "x-amz-content-sha256") continue;
    outbound[k] = v;
  }

  return { headers: outbound };
}

export async function hashArrayBuffer(data: ArrayBuffer): Promise<string> {
  return sha256Hex(data);
}
