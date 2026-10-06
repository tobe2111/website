// 언론 속 우리 골목 — 포털에 올라오는 우리 동네 기사·글을 하루 한 번 모아 둔다.
//
// 왜 만들었나
//   상인회가 축제를 열면 기사가 난다. 그런데 그 기사를 아는 사람은 기사를 본 사람뿐이고,
//   정작 상인회 홈페이지에는 아무 흔적이 없다. 회장님이 매번 링크를 찾아 공지로 옮겨 적는 일은
//   두 주면 멈춘다. 그래서 찾아오는 일만 기계가 하고, **고르는 일은 사람이 한다.**
//
// 지키는 선 — 세 가지
//   ① **자동으로 홈에 올리지 않는다.** 모아 두기만 하고, 관리자가 누른 것만 홈에 나간다.
//      "방배" 만 걸려도 엉뚱한 기사가 들어오는데, 그게 상인회 이름으로 첫 화면에 뜨면
//      고치는 데 드는 신뢰가 수집으로 얻는 것보다 크다.
//   ② **전문을 퍼오지 않는다.** 홈에 내보내는 것은 제목·매체·날짜·원문 링크 넷뿐이다.
//      검색 API 가 주는 한 줄 요약(snippet)은 저장하되 **관리자 화면에만** 보여 준다 —
//      회장님이 "우리 얘긴가" 를 판단할 재료일 뿐, 손님에게 읽히는 본문이 아니다.
//   ③ **찌르는 서버는 둘로 고정.** 주소를 입력받아 가져오는 길이 없다(남의 내부망을 찌르는 사고 방지).
//
// 열쇠
//   네이버 검색 API 키(NAVER_SEARCH_ID·NAVER_SEARCH_SECRET)를 그대로 쓴다 — 지도에서 가게를
//   찾을 때 쓰던 그 키다. 새로 받을 것이 없다. 구글 뉴스는 RSS 라 열쇠가 없다.
//   키가 없으면 구글만 돌고, 둘 다 막히면 조용히 0건으로 끝난다(홈은 영향 없음).
import * as D from "./db.js";
import { kindOf } from "./kinds.js";
import { withStoredKeys } from "./keys.js";
import { orgShortName } from "./util.js";

// 찌를 수 있는 호스트 — 이 둘 말고는 없다.
export const PRESS_HOSTS = ["openapi.naver.com", "news.google.com"];

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#039": "'" };
export function decodeEntities(s) {
  return String(s || "").replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, k) => {
    if (ENT[k] !== undefined) return ENT[k];
    if (k[0] === "#") {
      const n = k[1] === "x" || k[1] === "X" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return m;
  });
}
// 검색 API 는 걸린 낱말에 <b> 를 두르고 돌려준다. 태그를 떼고 한 줄로 만든다.
//
// 강조 태그는 **공백 없이** 떼야 한다. 네이버는 문장 한가운데에서 낱말만 감싸므로
// 공백으로 바꾸면 모든 제목이 『" 방배카페골목 " 상인들이』 처럼 벌어진다 —
// 수집한 기사 제목 전부가 조금씩 틀린 글이 된다. 나머지 태그(<br> 등)는 공백으로 둔다.
const EMPH = /<\/?(b|strong|em|i)\s*>/gi;
export const stripTags = (s) =>
  decodeEntities(String(s || "").replace(EMPH, "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

// ---------- 검색어 ----------
//
// 상인회 이름 그대로 검색하면 거의 안 걸린다 — 기사는 "방배카페골목" 이라고 쓰고
// "방배카페골목상인회" 라고는 안 쓴다. 그래서 꼬리말을 떼고 골목 이름만 남긴다.
// 꼬리말을 떼는 규칙은 화면 제목('언론 속의 방배카페골목')과 **같은 것**을 쓴다.
// 두 벌로 두면 어느 날 한쪽만 고쳐져, 찾는 말과 적힌 말이 달라진다.
export const defaultTerms = orgShortName;
// 관리자가 적는 형식: 한 줄에 하나(쉼표도 됨). 앞에 '-' 를 붙이면 제외 낱말.
//   방배카페골목
//   방배 카페거리
//   -부동산
export function parseTerms(raw, assocName = "") {
  const include = [], exclude = [];
  for (const piece of String(raw || "").split(/[\n,]/)) {
    const t = piece.trim();
    if (!t) continue;
    if (t[0] === "-") { const e = t.slice(1).trim(); if (e.length >= 2) exclude.push(e); continue; }
    if (t.length >= 2 && include.length < 5) include.push(t);
  }
  if (!include.length) { const d = defaultTerms(assocName); if (d) include.push(d); }
  return { include, exclude };
}
// 띄어쓰기는 매체마다 다르다("방배 카페골목" · "방배카페골목"). 공백을 지우고 맞춘다.
const squash = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
export function matchesTerms(text, { include, exclude }) {
  const hay = squash(text);
  if (!hay) return false;
  if ((exclude || []).some((e) => hay.includes(squash(e)))) return false;
  return (include || []).some((t) => squash(t).length >= 2 && hay.includes(squash(t)));
}

// ---------- 주소 ----------
// 같은 기사가 네이버·구글 양쪽에서, 또 매체별 전재로 여러 번 들어온다. 겹침은 주소로 가른다.
const TRACK = /^(utm_|fbclid|gclid|ref|igshid|spm)/i;
export function normalizeUrl(raw) {
  const t = String(raw || "").trim();
  if (!/^https?:\/\//i.test(t)) return "";
  let u;
  try { u = new URL(t); } catch { return ""; }
  u.hash = "";
  u.protocol = "https:";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  const keep = [...u.searchParams.entries()].filter(([k]) => !TRACK.test(k));
  u.search = "";
  for (const [k, v] of keep) u.searchParams.append(k, v);
  const s = u.toString();
  return s.length > 500 ? s.slice(0, 500) : s;
}
export const httpOnly = (raw) => (/^https?:\/\//i.test(String(raw || "").trim()) ? String(raw).trim().slice(0, 500) : "");

// 매체 이름. 구글 RSS 는 매체를 알려 주지만 네이버 뉴스는 링크만 준다 —
// 아는 곳은 이름으로, 모르는 곳은 주소를 그대로 보여 준다(없는 이름을 지어내지 않는다).
const OUTLET = {
  "yna.co.kr": "연합뉴스", "newsis.com": "뉴시스", "yonhapnewstv.co.kr": "연합뉴스TV",
  "chosun.com": "조선일보", "joongang.co.kr": "중앙일보", "donga.com": "동아일보",
  "hani.co.kr": "한겨레", "khan.co.kr": "경향신문", "seoul.co.kr": "서울신문",
  "hankyung.com": "한국경제", "mk.co.kr": "매일경제", "sedaily.com": "서울경제",
  "edaily.co.kr": "이데일리", "news1.kr": "뉴스1", "nocutnews.co.kr": "노컷뉴스",
  "ohmynews.com": "오마이뉴스", "mt.co.kr": "머니투데이", "fnnews.com": "파이낸셜뉴스",
  "kbs.co.kr": "KBS", "imbc.com": "MBC", "sbs.co.kr": "SBS", "ytn.co.kr": "YTN",
  "jtbc.co.kr": "JTBC", "mbn.co.kr": "MBN", "tvchosun.com": "TV조선",
  "asiae.co.kr": "아시아경제", "newdaily.co.kr": "뉴데일리", "segye.com": "세계일보",
  "kmib.co.kr": "국민일보", "munhwa.com": "문화일보", "hankookilbo.com": "한국일보",
  "sisajournal.com": "시사저널", "weekly.chosun.com": "주간조선",
  "naver.com": "네이버", "blog.naver.com": "네이버 블로그", "tistory.com": "티스토리",
  "seocho.go.kr": "서초구청", "sisa-news.kr": "시사뉴스",
  "heraldcorp.com": "헤럴드경제", "etoday.co.kr": "이투데이", "gukjenews.com": "국제뉴스",
  "industrynews.co.kr": "인더스트리뉴스", "seoulilbo.com": "서울일보",
  // 다음·네이버 뉴스는 **매체가 아니라 가판대**다. 어느 신문 기사인지 알 수 없으므로
  // 그렇게 적는다 — 모르는 것을 아는 척하지 않는다.
  "v.daum.net": "다음뉴스", "daum.net": "다음뉴스", "n.news.naver.com": "네이버뉴스",
};
// 구글 뉴스가 매체 이름 대신 **주소를 적어 보낼 때**가 있다(go.seoul.co.kr 처럼).
// 그대로 두면 화면에 주소가 뜬다 — 아는 매체면 이름으로 바꿔 준다.
export function prettyOutlet(s) {
  const t = String(s || "").trim();
  if (!t || t.includes(" ") || !t.includes(".")) return t;   // 이미 사람 이름이면 그대로
  if (!/^[a-z0-9.-]+$/i.test(t)) return t;
  return outletOf("https://" + t);
}
export function outletOf(url) {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (OUTLET[h]) return OUTLET[h];
    const parts = h.split(".");
    for (let i = 0; i < parts.length - 1; i++) {
      const tail = parts.slice(i).join(".");
      if (OUTLET[tail]) return OUTLET[tail];
    }
    return h;
  } catch { return ""; }
}

// ---------- 날짜 ----------
// 어느 출처든 'YYYY-MM-DD'(KST)로 맞춘다. 못 읽으면 빈 칸 — 틀린 날짜보다 없는 쪽이 낫다.
export function kstDay(v) {
  const s = String(v || "").trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; // 블로그 postdate
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return "";
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// ---------- 출처별 해석 ----------
export function parseNaverNews(data) {
  const items = (data && Array.isArray(data.items) ? data.items : []).slice(0, 30);
  return items.map((it) => {
    const url = httpOnly(it.originallink) || httpOnly(it.link);
    return {
      kind: "news", title: stripTags(it.title), url,
      source: outletOf(url), date: kstDay(it.pubDate), snippet: stripTags(it.description),
    };
  }).filter((x) => x.title && x.url);
}
export function parseNaverBlog(data) {
  const items = (data && Array.isArray(data.items) ? data.items : []).slice(0, 30);
  return items.map((it) => ({
    kind: "blog", title: stripTags(it.title), url: httpOnly(it.link),
    source: stripTags(it.bloggername) || outletOf(httpOnly(it.link)),
    date: kstDay(it.postdate), snippet: stripTags(it.description),
  })).filter((x) => x.title && x.url);
}
// 구글 뉴스 RSS. 워커에 XML 파서가 없어 <item> 덩어리를 직접 가른다 —
// 쓰는 칸이 넷(title·link·pubDate·source)뿐이라 정규식으로 충분하다.
const tagOf = (block, name) => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block);
  if (!m) return "";
  return stripTags(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
};
export function parseGoogleRss(xml) {
  const out = [];
  const re = /<item\b[\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(String(xml || ""))) && out.length < 30) {
    const b = m[0];
    const source = tagOf(b, "source");
    let title = tagOf(b, "title");
    // 구글은 제목 뒤에 " - 매체명" 을 붙인다. 매체를 따로 보여 주므로 꼬리를 뗀다.
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3)).trim();
    const url = httpOnly(tagOf(b, "link"));
    if (!title || !url) continue;
    out.push({ kind: "news", title, url, source: prettyOutlet(source) || outletOf(url), date: kstDay(tagOf(b, "pubDate")), snippet: "" });
  }
  return out;
}

// ---------- 가져오기 ----------
// 남의 서버다. 느려도 우리 크론이 같이 멈추면 안 되므로 6초에 끊는다. 실패는 빈 배열.
async function grab(url, headers) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 6000);
  try {
    const r = await fetch(url, { headers: headers || {}, signal: ac.signal });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; }
  finally { clearTimeout(timer); }
}
const asJson = (txt) => { try { return JSON.parse(txt); } catch { return null; } };

export async function collect(env, { terms, max = 24, blogs = true } = {}) {
  const t = terms && terms.include ? terms : parseTerms("", "");
  const nId = String(env.NAVER_SEARCH_ID || "").trim();
  const nSecret = String(env.NAVER_SEARCH_SECRET || "").trim();
  const nHead = { "X-Naver-Client-Id": nId, "X-Naver-Client-Secret": nSecret };
  const jobs = [];
  for (const term of t.include.slice(0, 3)) {
    const q = encodeURIComponent(term);
    jobs.push(grab(`https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`)
      .then((x) => (x ? parseGoogleRss(x) : [])));
    if (nId && nSecret) {
      jobs.push(grab(`https://openapi.naver.com/v1/search/news.json?query=${q}&display=20&sort=date`, nHead)
        .then((x) => (x ? parseNaverNews(asJson(x)) : [])));
      if (blogs) {
        jobs.push(grab(`https://openapi.naver.com/v1/search/blog.json?query=${q}&display=15&sort=date`, nHead)
          .then((x) => (x ? parseNaverBlog(asJson(x)) : [])));
      }
    }
  }
  const got = (await Promise.all(jobs.map((p) => p.catch(() => [])))).flat();
  // 겹침 제거 → 검색어와 상관없는 것 버리기 → 최신 순
  const seen = new Set(), out = [];
  for (const it of got) {
    const key = normalizeUrl(it.url);
    if (!key || seen.has(key)) continue;
    if (!matchesTerms(`${it.title} ${it.snippet}`, t)) continue;
    seen.add(key);
    out.push({ ...it, url: key, title: it.title.slice(0, 200), source: String(it.source || "").slice(0, 60), snippet: String(it.snippet || "").slice(0, 300) });
  }
  out.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return out.slice(0, max);
}

// 한 상인회 몫. 대기 줄이 길면 더 모으지 않는다 — 쌓인 걸 아무도 안 보면 수집은 소음이다.
export const PENDING_CAP = 60;
export async function collectForAssoc(env, db, assoc) {
  const raw = await D.getPressTerms(db, assoc.id);
  const terms = parseTerms(raw, assoc.name);
  const pending = await D.countPressPending(db, assoc.id);
  if (pending >= PENDING_CAP) return { skipped: "대기 과다", pending, added: 0 };
  const items = await collect(env, { terms, max: Math.min(24, PENDING_CAP - pending) });
  let added = 0;
  for (const it of items) {
    const row = await D.addPressItem(db, {
      associationId: assoc.id, title: it.title, url: it.url, source: it.source,
      publishedAt: it.date, snippet: it.snippet, kind: it.kind, term: terms.include[0] || "",
    });
    if (row) added++;
  }
  if (added) {
    await D.setSetting(db, `press_found:${assoc.id}`, new Date().toISOString()).catch(() => {});
  }
  return { added, scanned: items.length, pending: pending + added };
}

// 크론 한 번. 켜 둔 상인회(merchant)만 돈다 — 기본은 꺼짐이라, 켜기 전까지 한 번도 안 찌른다.
export async function runPressCollect(rawEnv) {
  const db = rawEnv.DB;
  // 크론 경로는 저장된 열쇠를 끼워 주지 않는다(scheduled() 는 withStoredKeys 를 안 지난다).
  // 여기서 한 번 끼운다 — 안 하면 네이버가 조용히 빠지고 구글만 돈다.
  const env = await withStoredKeys(rawEnv, db, rawEnv.DB_RAW || db).catch(() => rawEnv);
  const assocs = await D.listAllAssociations(db);
  const out = { ran: 0, added: 0 };
  for (const a of assocs) {
    if (kindOf(a).id !== "merchant") continue;
    if (!(await D.pressEnabled(db, a.id))) continue;
    out.ran++;
    const r = await collectForAssoc(env, db, a).catch((e) => ({ added: 0, error: String((e && e.message) || e).slice(0, 120) }));
    out.added += r.added || 0;
    if (r.error) out[`err:${a.slug || a.id}`] = r.error;
  }
  await D.setSetting(db, "press_run", JSON.stringify({ at: new Date().toISOString(), ...out })).catch(() => {});
  return out;
}
