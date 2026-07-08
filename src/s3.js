// S3 호환 스토리지 클라이언트 — 외부 SDK 없이 AWS Signature V4 직접 구현
// AWS S3, Cloudflare R2, MinIO 등과 호환. Node 내장 crypto + fetch 사용.
import crypto from "node:crypto";
import { config } from "./config.js";

const sha256hex = (data) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();

// RFC 3986 엄격 인코딩 (경로 세그먼트용, '/' 는 보존 옵션)
function uriEncode(str, encodeSlash = true) {
  return String(str)
    .split("")
    .map((c) => {
      if (/[A-Za-z0-9\-._~]/.test(c)) return c;
      if (c === "/" && !encodeSlash) return c;
      return "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
    })
    .join("");
}

// (테스트 가능) 서명 키 파생 — AWS 공식 예제 벡터로 검증됨
export function getSignatureKey(secretKey, dateStamp, region, service) {
  const kDate = hmac("AWS4" + secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

// 엔드포인트/호스트/키 URL 구성
function endpointInfo() {
  const { s3 } = config;
  let host, baseUrl, pathStyle;
  if (s3.endpoint) {
    const u = new URL(s3.endpoint);
    host = u.host;
    pathStyle = s3.forcePathStyle || true; // 커스텀 엔드포인트는 기본 path-style (R2/MinIO)
    baseUrl = `${u.protocol}//${u.host}`;
  } else {
    // AWS 표준
    host = s3.region === "us-east-1" ? "s3.amazonaws.com" : `s3.${s3.region}.amazonaws.com`;
    pathStyle = s3.forcePathStyle;
    baseUrl = `https://${host}`;
  }
  return { host, baseUrl, pathStyle };
}

function objectUrl(key) {
  const { s3 } = config;
  const { host, baseUrl, pathStyle } = endpointInfo();
  if (pathStyle) return { url: `${baseUrl}/${s3.bucket}/${uriEncode(key, false)}`, host, signedPath: `/${s3.bucket}/${uriEncode(key, false)}` };
  // virtual-hosted style
  const vhost = `${s3.bucket}.${host}`;
  return { url: `https://${vhost}/${uriEncode(key, false)}`, host: vhost, signedPath: `/${uriEncode(key, false)}` };
}

// ISO8601 타임스탬프 (외부에서 주입 가능 — 테스트/결정성)
function amzDate(now) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amz: iso, stamp: iso.slice(0, 8) };
}

// 서명된 요청 헤더 생성
export function signRequest({ method, key, payload = Buffer.alloc(0), contentType, now = new Date() }) {
  const { s3 } = config;
  const { url, host, signedPath } = objectUrl(key);
  const { amz, stamp } = amzDate(now);
  const service = "s3";
  const payloadHash = sha256hex(payload);

  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amz,
  };
  if (contentType) headers["content-type"] = contentType;

  const signedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderKeys.map((k) => `${k}:${headers[k]}\n`).join("");
  const signedHeaders = signedHeaderKeys.join(";");

  const canonicalRequest = [method, signedPath, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${stamp}/${s3.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amz, scope, sha256hex(canonicalRequest)].join("\n");
  const signingKey = getSignatureKey(s3.secretAccessKey, stamp, s3.region, service);
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  headers["Authorization"] =
    `AWS4-HMAC-SHA256 Credential=${s3.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url, headers };
}

export async function putObject(key, buffer, contentType) {
  const { url, headers } = signRequest({ method: "PUT", key, payload: buffer, contentType });
  const res = await fetch(url, { method: "PUT", headers, body: buffer });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`S3 PUT 실패 ${res.status}: ${text.slice(0, 200)}`);
  }
}

export async function deleteObject(key) {
  const { url, headers } = signRequest({ method: "DELETE", key });
  const res = await fetch(url, { method: "DELETE", headers });
  if (!res.ok && res.status !== 404) {
    throw new Error(`S3 DELETE 실패 ${res.status}`);
  }
}

// 퍼블릭 접근 URL
export function publicUrl(key) {
  if (config.s3.publicBaseUrl) return `${config.s3.publicBaseUrl}/${uriEncode(key, false)}`;
  return objectUrl(key).url;
}
