// 화면에 이모지를 다시 들이지 않는다.
//
// 이모지로 도배된 카드·버튼은 "AI가 만든 티" 로 곧장 읽힌다. 한 번 걷어내도
// 새 화면을 만들 때마다 하나씩 다시 붙기 때문에, 실제로 그려진 HTML 을 보고 막는다.
//
// 허용하는 것은 뜻이 있는 활자 기호뿐이다:
//   ← → ↗  길 안내(뒤로·바깥 링크)      ▲ ▼  순서 바꾸기 단추
//   ▶       심사받은 알림톡 문구 안의 글머리 — 카카오가 승인한 원문이라 한 글자도 못 바꾼다
//   ○ ●     예시 이름(○○상사)·가려진 금액
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeEnv } from "./shim.js";
import * as D from "../src/db.js";
import { hashPassword } from "../src/crypto.js";
import { contentHash } from "../src/esign.js";

const B = "http://localhost";
// 뜻을 가진 활자 기호는 이모지가 아니다 — 이것만 통과시킨다
const ALLOW = new Set(["←", "→", "↗", "↔", "▲", "▼", "▶", "○", "●", "♥", "✔", "★", "·"]);
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;

test("화면에 이모지가 없다", async () => {
  const env = makeEnv();
  const a = await D.createAssociation(env.DB, { slug: "s", name: "서초구 상인회", kind: "merchant" });
  const law = await D.createAssociation(env.DB, { slug: "law", name: "한빛법무법인", kind: "esign" });
  const pw = await hashPassword("pass1234");
  const mk = (e, r, id) => D.createUser(env.DB, { email: e, passwordHash: pw.hash, salt: pw.salt, name: "이름", role: r, associationId: id });
  await mk("sp@x.kr", "SUPERADMIN", null); await mk("ad@x.kr", "ADMIN", a.id); await mk("lw@x.kr", "ADMIN", law.id);
  const body = "제1조 계약.";
  const d = await D.createDocument(env.DB, { associationId: law.id, title: "용역 계약서", body,
    contentHash: await contentHash(body), createdBy: null, ordered: 0, dueDate: "" });
  await D.addExternalSigner(env.DB, { documentId: d.id, name: "김상대", signOrder: 1 });

  const f = (p, i = {}) => worker.fetch(new Request(B + p, { redirect: "manual", ...i }), env, { waitUntil() {}, passThroughOnException() {} });
  const login = async (email) => {
    const g = await f("/login");
    const seed = (g.headers.getSetCookie?.() || []).find((c) => c.startsWith("sc_csrf_seed="))?.split(";")[0] || "";
    const tk = (/name="_csrf" value="([^"]+)"/.exec(await g.text()) || [])[1];
    const r = await f("/login", { method: "POST", headers: { cookie: seed, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ _csrf: tk, email, password: "pass1234" }) });
    return [seed, ...(r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0])].join("; ");
  };
  const [sp, ad, lw] = [await login("sp@x.kr"), await login("ad@x.kr"), await login("lw@x.kr")];
  const PAGES = [["/", ""], ["/esign", ""], ["/homepage", ""], ["/t/s/", ""], ["/t/s/businesses", ""],
    ["/super", sp], [`/super/org/${a.id}`, sp], ["/t/s/admin", ad],
    ["/t/law/admin/documents", lw], [`/t/law/admin/documents/${d.id}`, lw],
    [`/t/law/admin/documents/${d.id}/fields`, lw]];

  const found = [];
  for (const [p, jar] of PAGES) {
    const r = await f(p, { headers: jar ? { cookie: jar } : {} });
    assert.equal(r.status, 200, `${p} 가 안 열림`);
    // <style>·<script> 안은 화면 글자가 아니므로 뺀다
    const text = (await r.text()).replace(/<(style|script)[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ");
    for (const m of text.matchAll(EMOJI)) {
      if (ALLOW.has(m[0])) continue;
      found.push(`${p} … ${text.slice(Math.max(0, m.index - 20), m.index + 20).replace(/\s+/g, " ").trim()}`);
    }
  }
  assert.deepEqual(found, [], "화면에 이모지가 남아 있습니다:\n  " + found.join("\n  "));
});

// 알림톡 문구는 카카오가 심사한 원문이다. 여기 있는 ▶ 는 장식이 아니라 승인된 글자라
// 한 글자만 바꿔도 그 종류가 통째로 반려된다 — 이모지 청소가 여기까지 오면 안 된다.
test("심사받은 알림톡 문구는 건드리지 않는다", async () => {
  const { TEMPLATES } = await import("../src/notify.js");
  for (const kind of ["sign_request", "sign_remind", "sign_done", "lead_new", "notice"])
    assert.match(TEMPLATES[kind].body, /▶ /, `${kind} 문구의 글머리가 사라졌다 — 카카오 승인이 무효가 된다`);
});

// 한글 제목 위에 얹힌 영문 대문자 라벨(SECURITY · HOW IT WORKS · FEATURES …)은
// 템플릿에서 찍어냈다는 인상을 가장 크게 낸다. 눈썹은 '어느 화면인지'를 말할 때만 쓴다.
test("영문 대문자 눈썹 라벨이 없다", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/pages.js", import.meta.url), "utf8");
  const bad = [...src.matchAll(/section-eyebrow">([^<$]*)</g)]
    .map((m) => m[1].trim())
    .filter((t) => t && /^[A-Z][A-Z0-9 ·&-]*$/.test(t));
  assert.deepEqual(bad, [], "영문 대문자 눈썹이 남아 있습니다: " + bad.join(", "));
});

// 마우스를 올리면 카드가 떠오르는 연출은 흔한 템플릿 문법이다.
// 반응은 남기되(테두리·그림자) 들어올리지는 않는다.
test("카드가 마우스에 떠오르지 않는다", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
  const lift = [...css.matchAll(/([.\w-]+):hover\{[^}]*transform:translateY\([^}]*\}/g)].map((m) => m[1]);
  assert.deepEqual(lift, [], "떠오르는 카드가 남아 있습니다: " + lift.join(", "));
});

// 히어로 뒤에서 떠다니던 흐린 그라데이션 원 — AI 랜딩페이지의 대표적 인상.
test("히어로에 떠다니는 광원이 없다", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
  const home = readFileSync(new URL("../src/homeLayout.js", import.meta.url), "utf8");
  assert.ok(!/hp-glow/.test(css) && !/hp-glow/.test(home), "떠다니는 광원이 남아 있습니다");
  assert.ok(!/@keyframes hpFloat/.test(css), "광원을 움직이던 애니메이션이 남아 있습니다");
  assert.ok(!/\.biz-hero::before\{[^}]*blur\(/.test(css), "점포 화면 히어로에도 같은 광원이 있었습니다");
});

// 브랜드색에 다른 색을 섞은 사선 그라데이션, 글자에 씌운 그라데이션, 카드 위 빛무리 —
// 셋 다 "예쁘게 만들어 주세요" 에 기계가 내놓는 기본값이다. 남겨 둘 그라데이션은
// 사진 위 베일(글자가 읽혀야 한다)과 남의 브랜드색(유튜브·인스타)뿐이다.
test("장식용 그라데이션이 없다", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
  const src = readFileSync(new URL("../src/pages.js", import.meta.url), "utf8");
  assert.ok(!/background-clip:text/.test(css), "글자에 씌운 그라데이션이 남아 있습니다");
  assert.ok(!/\.tc-glow/.test(css + src), "카드 위 빛무리가 남아 있습니다");
  const grads = [...css.matchAll(/linear-gradient\(([^)]*)\)/g)].map((m) => m[1]);
  const decorative = grads.filter((g) => /var\(--brand|var\(--green/.test(g));
  assert.deepEqual(decorative, [], "브랜드색 그라데이션이 남아 있습니다: " + decorative.join(" | "));
});

// 알약 모양 배지가 화면마다 열 개씩 떠 있으면 '무엇이 중요한지' 가 아니라 장식으로 읽힌다.
// 정말 둥글어야 하는 것(토글 손잡이·진행 막대·번호 원·원형 버튼)만 남긴다.
test("배지·태그가 알약 모양이 아니다", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
  // 디자인 시스템 v3(앱 컨셉 · 레퍼런스 코레일톡)에서 알약이 **의도된** 자리 둘:
  //   .doc-chip — 계약 목록의 필터 칩('전체 1' · '승차권 1' 처럼 레퍼런스 자체가 알약이다)
  //   .done-next .btn-outline — 완료 화면의 다음 행동 단추('오는 열차 찾아보기')
  // 그 밖의 배지·태그는 여전히 알약이 아니어야 한다.
  const pillOk = /^(\.progress|\.req-order|\.switch|\.ob-check|\.share-toast|\.sns-btn|\.gallery-item|\.market-open|\.doc-chip|\.done-next)/;
  const pills = [...css.matchAll(/(^|\n)([.\w][^{\n]*)\{[^}]*border-radius:999px/g)]
    .map((m) => m[2].trim()).filter((sel) => !pillOk.test(sel));
  assert.deepEqual(pills, [], "알약 모양이 남아 있습니다: " + pills.join(", "));
});

// 0 30px 70px 짜리 그림자는 카드가 화면 위에 '뜬' 것처럼 보이게 한다.
// 서류를 다루는 서비스에서는 실선 한 줄이 더 정직하다.
test("카드가 화면 위에 뜨지 않는다", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
  const blurs = [...css.matchAll(/--sh-\d:0 \d+px (\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(blurs.length >= 3, "그림자 토큰을 못 찾음");
  assert.ok(Math.max(...blurs) <= 20, `그림자가 너무 큽니다(최대 ${Math.max(...blurs)}px)`);
});

// 브랜드색 후광은 사선(linear)뿐 아니라 방사형(radial)으로도 여섯 군데 더 있었다 —
// 제목 뒤, 로그인 화면 뒤, 404 뒤, 초대 상자 뒤. 같은 장치이므로 같이 막는다.
test("브랜드색 후광이 없다", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
  const halos = [...css.matchAll(/radial-gradient\(([^)]*)\)/g)].map((m) => m[1])
    .filter((g) => /var\(--brand|var\(--green/.test(g));
  assert.deepEqual(halos, [], "브랜드색 방사형 후광이 남아 있습니다: " + halos.join(" | "));
});

// 한 페이지 안에서 글이 시작하는 세로선은 하나여야 한다.
// 제목은 왼쪽 · 단계는 가운데 · 마무리는 가운데면, 읽는 눈이 절마다 자리를 다시 찾는다.
test("제품 소개 화면의 정렬 축이 하나다", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/pages.js", import.meta.url), "utf8");
  const from = src.indexOf("export async function esignLanding");
  const to = src.indexOf("export async function", src.indexOf("export async function homepageLanding") + 10);
  const seg = src.slice(from, to);
  assert.ok(!/container narrow/.test(seg), "좁은 칸과 넓은 칸이 섞이면 왼쪽 끝이 두 개가 됩니다");
  assert.ok(!/text-align:center/.test(seg), "가운데 정렬이 남아 있습니다");
  assert.ok(!/justify-content:center/.test(seg), "가운데로 몬 단추 줄이 남아 있습니다");

  const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
  assert.match(css, /\.landing-hero\{[^}]*text-align:left/, "제품 소개 첫 화면도 같은 축이어야");
  assert.match(css, /\.es-steps\{[^}]*margin:0\}/, "단계 목록이 가운데로 밀리면 안 됩니다");
});

// 열두 칸을 카드로 흩으면 '위에서 아래로' 라는 순서가 사라진다 —
// 정작 손님이 알고 싶은 "내 페이지가 어떻게 생겼나" 를 말해 주지 못한다.
test("모집 랜딩 소개는 카드 벽이 아니라 차례로 보여 준다", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/pages.js", import.meta.url), "utf8");
  // '한 장에 들어가는 것' 절만 잘라 본다 — 함수 경계로 자르면 옆 화면의 격자까지 걸린다
  const from = src.indexOf("한 장에 들어가는 것");
  assert.ok(from > 0, "그 절을 못 찾음");
  const seg = src.slice(from, src.indexOf("</section>", from));
  assert.match(seg, /<ol class="page-outline">/, "완성된 페이지의 순서를 보여 줘야");
  assert.ok(!/feature-grid/.test(seg), "카드 격자가 남아 있습니다");
  // 열두 줄이 다 있어야 한다 — 짧아 보이려고 내용을 지운 게 아니다
  assert.equal((seg.match(/\["[^"]+", "/g) || []).length, 12, "열두 줄이 그대로 있어야");
});

// 절마다 0.8초씩 떠오르는 스크롤 리빌은 '기계가 만든 랜딩페이지' 의 표시이자,
// 손님이 보려는 것을 0.8초씩 늦추는 방해물이다. 가게를 찾으러 온 사람에게는 특히.
test("스크롤 리빌이 없다", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
  const js = readFileSync(new URL("../public/js/app.js", import.meta.url), "utf8");
  assert.ok(!/reveal-on/.test(css + js), "스크롤 리빌이 남아 있습니다");
});

// 한글 화면에 영문 대문자 라벨을 얹으면 정보는 0인데 템플릿 인상만 커진다.
// 게다가 우리말에 letter-spacing 을 크게 주면 '가 맹 점  모 집' 처럼 흩어진다.
test("영문 대문자 라벨과 넓은 자간이 없다", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
  assert.ok(!/text-transform:uppercase/.test(css), "대문자 변환 규칙이 남아 있습니다");
  const home = readFileSync(new URL("../src/homeLayout.js", import.meta.url), "utf8");
  assert.ok(!/"Find member stores"|"Store map"|"News & notices"/.test(home),
    "바로가기 카드의 영문 부제가 남아 있습니다");
});

// 같은 숫자가 한 화면에 두 번 나오면, 두 번째는 정보가 아니라 장식이다.
// 첫 화면 정보 패널이 이미 가입 점포·공지·행사를 보여 준다.
test("상인회 홈에 같은 숫자를 두 번 쓰지 않는다", async () => {
  const home = (await import("node:fs")).readFileSync(new URL("../src/homeLayout.js", import.meta.url), "utf8");
  const from = home.indexOf('case "showcase"');
  const seg = home.slice(from, home.indexOf('case "steps"', from));
  assert.ok(!/sc-stats/.test(seg), "통계 밴드가 남아 있습니다 — 첫 화면 패널과 같은 숫자입니다");
});

// 브라우저 기본 파일 단추는 'Choose File' 이라는 영어 글자가 박혀 있고 CSS 로 못 바꾼다.
// 한국 사장님이 쓰는 화면에 영어 단추가 남으면 그 자리에서 멈칫한다.
test("파일 고르기 단추가 우리말이다", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/pages.js", import.meta.url), "utf8");
  const bare = [...src.matchAll(/<label class="file-inline">[\s\S]{0,300}?<\/label>/g)]
    .map((m) => m[0]).filter((h) => !/class="fi-btn"/.test(h));
  assert.deepEqual(bare, [], "우리말 단추를 안 씌운 파일 칸이 남아 있습니다");
  const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
  assert.match(css, /\.file-inline input\{position:absolute/, "기본 단추를 감춰야 우리말이 보인다");
});

// 사장님이 가장 많이 쓰는 화면인데 4,648px 한 장이었다 — 관리 화면은 탭으로 고쳤으면서.
test("점주 대시보드가 하는 일별 탭으로 나뉜다", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/pages.js", import.meta.url), "utf8");
  const from = src.indexOf("export async function dashboard(ctx)");
  const seg = src.slice(from, src.indexOf("export async function", from + 10));
  for (const t of ["s-shop", "s-photo", "s-sell", "s-tell"])
    assert.match(seg, new RegExp(`id="${t}"`), `${t} 묶음이 있어야`);
  assert.match(seg, /id="consoleNav"/, "탭이 붙을 자리가 있어야");
  assert.match(seg, /super-tabs\.js/, "탭 장치를 실어야");
});

// 중괄호 균형 검사는 test/csshealth.test.js 로 옮겼습니다.
// 두 세션이 같은 사고(합치다가 닫는 괄호가 사라짐)를 각각 겪고 같은 검사를 따로 만들었는데,
// 한쪽에는 "몇 번째 줄에서 시작한 블록이 안 닫혔는지"가 있고 다른 쪽에는 없었습니다.
// 고칠 때 필요한 건 그 줄 번호라, 그쪽 한 벌만 남깁니다.
// 관리 콘솔의 카드는 사방 20px 여백으로 섭니다. 그런데 예전(괘선) 디자인에서 쓰던
// "묶음의 첫 칸만 위 여백을 뺀다" 는 예외가 남아, 각 탭의 **첫 카드**에서만 제목이
// 카드 천장에 붙어 있었습니다(실측 0~3px). 그 예외는 카드 규칙보다 선택자가 한 단
// 구체적이라, 뒤에 온 카드 규칙을 이기고도 아무 표시를 내지 않습니다 — 브라우저는
// 이런 걸 오류로 알리지 않고, 코드에는 '카드는 20px' 이라고 적혀 있어 아무도 의심하지 않습니다.
//
// 죽은 @media 검사기(scripts/css-dead-media.mjs)는 좁은 화면 규칙이 죽는 경우만 보므로
// 이건 못 잡습니다. 그래서 여기서 따로 지킵니다.
test("콘솔 카드의 위 여백을 :first-child 예외가 지우지 않는다", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const bad = [];
  // `... .panel:first-child { ... padding-top:0 ... }` 꼴을 모두 잡는다
  for (const m of bare.matchAll(/([^{}]*\.panel[^{}]*:first-child[^{}]*)\{([^{}]*)\}/g)) {
    if (/padding(-top)?\s*:\s*0/.test(m[2])) bad.push(m[1].trim().replace(/\s+/g, " "));
  }
  assert.deepEqual(bad, [], `첫 카드의 위 여백을 지우는 규칙이 있습니다:\n  ${bad.join("\n  ")}`);
});

// 카드끼리는 흰 상자와 사이 여백으로 이미 갈립니다. 거기에 가로줄까지 그으면
// 카드 위에 선이 얹혀 '카드가 아닌 것' 처럼 보입니다 — 좁은 화면에서만 그랬습니다.
test("콘솔 카드 위에 가로줄을 얹지 않는다", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const bad = [];
  for (const m of bare.matchAll(/([^{}]*\.(?:dash-col|sgroup)[^{}]*\.panel[^{}]*)\{([^{}]*)\}/g)) {
    if (/border-top\s*:\s*[^;]*\d/.test(m[2])) bad.push(m[1].trim().replace(/\s+/g, " "));
  }
  assert.deepEqual(bad, [], `카드 위에 선을 긋는 규칙이 있습니다:\n  ${bad.join("\n  ")}`);
});

// 고정 하단 바가 페이지 끝을 가리지 않는가.
//
// 예전에는 CSS `body:has(.fr-sticky)` 로 "바가 있으면 아래 여백을 준다" 를 판정했습니다.
// 그런데 `:has()` 는 파이어폭스 ESR 에서 안 돕니다 — 관공서·학교 PC 에 그게 남아 있습니다.
// 거기서는 여백이 안 붙어 **바가 푸터를 덮었습니다.**
//
// 서버는 자기가 바를 그렸는지 이미 알고 있으므로, 클래스로 말하게 했습니다.
// 둘이 어긋나면(바는 있는데 클래스가 없거나, 반대거나) 같은 사고가 다시 납니다.
test("고정 하단 바를 그리면 body 에 has-sticky 가 함께 붙는다", async () => {
  const { layout } = await import("../src/render.js");
  const mk = (assoc, body) => layout({ title: "t", assoc, base: "/t/x", body });
  const franchise = { id: 1, name: "다뽕고", kind: "franchise", phone: "1600-0000", brand_color: "#e8b400" };
  const merchant = { id: 2, name: "방배카페골목 상인회", kind: "merchant", brand_color: "#1B6B45" };

  const landing = mk(franchise, `<section class="section"><p>랜딩</p></section>`);
  assert.match(landing, /class="[^"]*has-sticky/, "바를 그렸으면 클래스도 붙어야 한다");
  assert.match(landing, /fr-sticky/, "바가 실제로 있어야 한다");

  const shop = mk(merchant, `<section class="section"><p>상인회 홈</p></section>`);
  assert.ok(!/has-sticky/.test(shop), "바가 없으면 클래스도 없어야 한다 — 헛여백이 남는다");
  assert.ok(!/fr-sticky/.test(shop));

  // 업무 콘솔에는 바를 안 그린다 — 클래스도 안 붙어야 한다
  const console_ = mk(franchise, `<section class="dash"><p>콘솔</p></section>`);
  assert.equal(/fr-sticky/.test(console_), /has-sticky/.test(console_),
    "바와 클래스는 언제나 같이 있거나 같이 없어야 한다");
});

// 고정 바 여백을 :has() 로 되돌리면 파이어폭스 ESR 에서 다시 가려집니다.
test("고정 바 여백을 :has() 로 판정하지 않는다", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
  assert.ok(!/:has\s*\(\s*\.fr-sticky/.test(css),
    "body:has(.fr-sticky) 가 돌아왔습니다 — 서버가 붙이는 .has-sticky 를 쓰세요");
});
