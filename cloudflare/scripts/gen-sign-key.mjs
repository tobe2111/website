// 전자서명용 Ed25519 개인키(JWK) 생성기.
// 실행:  node cloudflare/scripts/gen-sign-key.mjs
// 출력된 JSON 한 줄을 Cloudflare 시크릿으로 등록:
//   wrangler secret put SIGN_PRIVATE_KEY   (프롬프트에 붙여넣기)
//
// ⚠️ 이미 돌고 있는 서비스에는 쓰지 마세요.
//    키를 새로 만들면 **그 전에 받은 서명이 전부 검증에 실패합니다** — 되돌릴 수 없습니다.
//    이미 키가 D1 에 들어 있는 서비스라면, 새로 만들지 말고 현행 값을 그대로 옮기세요:
//    /super → 설정·보안 → '시크릿 옮기기' 의 복사 버튼이 그 절차를 안내합니다.
//    이 스크립트는 **처음 여는 서비스**(받아 둔 서명이 0건)에서만 쓰는 것입니다.
const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
console.log(JSON.stringify(jwk));
