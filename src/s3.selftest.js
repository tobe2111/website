// S3 SigV4 서명 자체 검증 — AWS 공식 테스트 스위트 "get-vanilla" 벡터 사용 (네트워크 불필요)
// 실행: npm run test:s3
import crypto from "node:crypto";
import { getSignatureKey } from "./s3.js";

const sha256hex = (d) => crypto.createHash("sha256").update(d).digest("hex");

const secret = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";
const region = "us-east-1", service = "service";
const amzDate = "20150830T123600Z", dateStamp = "20150830";

const canonicalRequest = [
  "GET", "/", "",
  "host:example.amazonaws.com\nx-amz-date:" + amzDate + "\n",
  "host;x-amz-date",
  sha256hex(""),
].join("\n");
const scope = `${dateStamp}/${region}/${service}/aws4_request`;
const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
const key = getSignatureKey(secret, dateStamp, region, service);
const sig = crypto.createHmac("sha256", key).update(stringToSign).digest("hex");

const expected = "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31";
if (sig === expected) {
  console.log("✅ SigV4 서명 정확 (AWS 공식 get-vanilla 벡터 통과)");
  process.exit(0);
} else {
  console.error("❌ SigV4 불일치\n computed:", sig, "\n expected:", expected);
  process.exit(1);
}
