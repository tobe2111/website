-- 2026 가을 방배카페골목 축제 세 건 + 상인회 인스타그램 주소.
--
-- 이 파일은 코드가 아니라 **내용**입니다. 홈페이지에 뜰 글이 그대로 들어 있습니다.
-- 평소에는 관리자 화면에서 직접 등록하지만, 포스터 세 장을 옮겨 적는 일이라
-- 한 번에 넣고 손으로 고치는 편이 빨라 여기에 두었습니다.
--
-- 돌리는 법 — 깃허브 Actions 탭 → "축제 내용 반영" → Run workflow.
--   (.github/workflows/content-apply.yml · 손으로 눌러야만 돕니다)
--
-- 두 번 돌려도 줄이 늘지 않습니다. 행사명이 같은 줄이 이미 있으면 건너뜁니다.
-- 반대로 **이미 들어간 줄을 고치지도 않습니다** — 관리자 화면에서 고친 내용을
-- 이 파일이 되돌려 버리면, 고친 사람은 자기가 뭘 잘못했는지 알 수 없습니다.
-- 내용을 바꿔야 하면 관리자 화면에서 고치세요.

-- ① 제5회 2026 방배페스티벌 (10/17 · 축제 본체)
INSERT INTO events (association_id, title, event_date, time_text, place, description, signup, host, contact, image, rsvp)
SELECT a.id,
  '제5회 2026 방배페스티벌 — 골목이 카페다',
  '2026-10-17',
  '15:00 ~ 20:00 (개회식 18:00)',
  '방배카페골목 일대',
  '다시, 그때 그 감성 — 골목이 카페다.

방배카페골목 일대에서 하루 종일 열리는 동네 축제입니다. 오후 3시에 시작해 저녁 8시에 끝나고, 개회식은 저녁 6시입니다.

[프로그램]
· 어린이 마실콘서트
· 방배카페골목 미식로드 — 대표 맛집 22곳이 참여하는 음식문화축제
· 방배카페골목 주민 노래자랑 — 예선을 거친 주민들의 본선 무대
· 레트로 감성체험부스

[축하 무대]
송가인 · 김다나 · 이현승 · 조영구',
  '',
  '주최 방배본·1·2·3·4동 주민자치위원회 · 주관 방배본동 주민자치위원회, 방배카페골목 상가번영회, 서초구 · 후원 서초새마을금고',
  '',
  '/img/festival/bangbae-festival-2026.webp', 0
FROM associations a
WHERE a.name LIKE '%방배카페골목%'
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.association_id = a.id AND e.title = '제5회 2026 방배페스티벌 — 골목이 카페다');

-- ② 방배카페 골목페스타 미식로드 (10/17 · 축제 프로그램)
INSERT INTO events (association_id, title, event_date, time_text, place, description, signup, host, contact, image, rsvp)
SELECT a.id,
  '2026 방배카페 골목페스타 — 미식로드',
  '2026-10-17',
  '15:00 ~ 20:00 (방배페스티벌 행사 시간)',
  '방배카페골목 일대',
  '방배카페골목 대표 맛집 22선과 함께하는 음식문화축제입니다.
제5회 방배페스티벌의 프로그램 가운데 하나로, 축제 당일 골목 전체에서 함께 열립니다.

[참여 가게 22곳]
달빛한스푼 · 수다 · 감순네 야구찜 · 쏘이313 · 피아체
할아버지 간장게장 야구찜 · 루이즈덱케이크 · 나라김밥 · 마리연구소
윌리제이 · 바다가득한집 · 차돌라 샌드위치 · 장인감자탕
그린앤피니 · 너나들이 · 찹쌀순대 만드는집 · 스마일 포차 · 강촌닭갈비
김가네 · 압구정 샌드위치 · 서호김밥 · 트로피티아일랜드',
  '',
  '',
  '',
  '/img/festival/misik-road-2026.webp', 0
FROM associations a
WHERE a.name LIKE '%방배카페골목%'
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.association_id = a.id AND e.title = '2026 방배카페 골목페스타 — 미식로드');

-- ③ 제4회 주민 노래자랑 (10/3 예선 · 10/17 본선)
--    날짜는 **예선**으로 넣습니다. 먼저 오는 날이라 '다가오는 행사' 에 바로 뜨고,
--    본선은 ① 방배페스티벌 프로그램으로도 한 번 더 적혀 있습니다.
INSERT INTO events (association_id, title, event_date, time_text, place, description, signup, host, contact, image, rsvp)
SELECT a.id,
  '2026년 제4회 방배카페골목 주민 노래자랑',
  '2026-10-03',
  '예선 오후 3시 · 본선 10월 17일(토) 오후 4시 30분 ~ 5시 40분',
  '라이브카페 CNN',
  '방배카페골목 주민과 상인들이 함께 즐기는 노래자랑입니다.
노래를 사랑하는 주민이라면 누구나 함께할 수 있습니다.

예선 — 2026년 10월 3일(토) 오후 3시 · 라이브카페 CNN
본선 — 2026년 10월 17일(토) 오후 4시 30분 ~ 5시 40분 · 방배카페골목(방배중앙로) 일대

본선은 제5회 방배페스티벌 무대에서 열립니다.',
  '접수 마감 2026년 9월 23일(수) — 접수가 끝났습니다 · 접수처 방배본동 주민센터 1층',
  '주최·주관 방배카페골목 상인회',
  '010-6619-1553',
  '/img/festival/norae-jarang-2026.webp', 0
FROM associations a
WHERE a.name LIKE '%방배카페골목%'
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.association_id = a.id AND e.title = '2026년 제4회 방배카페골목 주민 노래자랑');

-- ④ 상인회 인스타그램 — 아직 아무것도 안 적혀 있을 때만 넣습니다.
--    (관리자 화면에서 다른 주소로 바꿔 두었다면 그 값을 지키기 위해서입니다.)
UPDATE associations
   SET sns_instagram = 'https://www.instagram.com/bangbae_cafe_street/'
 WHERE name LIKE '%방배카페골목%' AND sns_instagram = '';
