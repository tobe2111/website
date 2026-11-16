/**
 * 유어팀 홈페이지 상담 신청 → 구글 스프레드시트 + 이메일 알림
 *
 * 쓰는 법 (한 번만)
 *  1. 구글 드라이브에서 새 스프레드시트를 만든다 (이름 예: 유어팀 상담 신청)
 *  2. 메뉴 [확장 프로그램] → [Apps Script] 를 누르고, 이 파일 내용을 통째로 붙여 넣고 저장한다
 *  3. 아래 NOTIFY 에 알림 받을 이메일을 적는다 (여러 개면 쉼표로)
 *  4. [배포] → [새 배포] → 유형 [웹 앱] → 실행 사용자 "나", 액세스 권한 "모든 사용자" → [배포]
 *     (처음에 권한 허용 창이 뜨면 본인 계정으로 허용)
 *  5. 나오는 "웹 앱 URL"(https://script.google.com/macros/s/…/exec)을 site.json 의 form.endpoint 에 넣는다
 */
const NOTIFY = "jiwon@ur-team.com";
const SHEET_NAME = "상담 신청";
const COLS = ["접수 시각", "업체명 · 담당자", "연락처", "이메일", "월 광고 예산", "알게 된 경로", "상담 내용", "언어", "들어온 페이지", "utm_source", "utm_medium", "utm_campaign", "이전 페이지"];

function doPost(e) {
  const p = (e && e.parameter) || {};
  if (p.website) return out("ok"); // 사람 눈에 안 보이는 칸이 채워졌으면 스팸 로봇
  if (!p.name || !p.phone) return out("missing");
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    if (sh.getLastRow() === 0) { sh.appendRow(COLS); sh.setFrozenRows(1); sh.getRange(1, 1, 1, COLS.length).setFontWeight("bold"); }
    const cut = (v, n) => String(v || "").slice(0, n || 500);
    // 수식으로 읽히지 않게 맨 앞의 = + - @ 를 막는다
    const safe = (v, n) => { const s = cut(v, n); return /^[=+\-@]/.test(s) ? "'" + s : s; };
    const row = [new Date(), safe(p.name, 80), safe(p.phone, 40), safe(p.email, 120), safe(p.budget, 60), safe(p.funnel, 60), safe(p.message, 2000), safe(p.lang, 4), safe(p.page, 200), safe(p.utm_source, 100), safe(p.utm_medium, 100), safe(p.utm_campaign, 100), safe(p.referrer, 200)];
    sh.appendRow(row);
    if (NOTIFY) {
      const body = COLS.map((c, i) => c + ": " + row[i]).join("\n") + "\n\n스프레드시트: " + ss.getUrl();
      MailApp.sendEmail(NOTIFY, "[유어팀 홈페이지] 새 상담 신청 · " + cut(p.name, 40), body);
    }
  } finally { lock.releaseLock(); }
  return out("ok");
}
function out(t) { return ContentService.createTextOutput(t); }
