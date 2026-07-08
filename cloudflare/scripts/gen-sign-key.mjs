// 전자서명용 Ed25519 개인키(JWK) 생성기.
// 실행:  node cloudflare/scripts/gen-sign-key.mjs
// 출력된 JSON 한 줄을 Cloudflare 시크릿으로 등록:
//   wrangler secret put SIGN_PRIVATE_KEY   (프롬프트에 붙여넣기)
const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
console.log(JSON.stringify(jwk));
