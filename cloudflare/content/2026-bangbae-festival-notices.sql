-- 축제 공지 두 건. 행사 카드만으로는 "언제 뭐가 있나" 가 공지 목록·검색에 안 걸린다.
-- 포스터에 적힌 것만 옮겼다 — 상인회가 정하지 않은 약속(접수·부스 신청 같은)은 쓰지 않는다.
--
-- 두 번 돌려도 줄이 늘지 않고, 이미 들어간 줄을 고치지도 않는다(관리자가 화면에서 고쳤을 수 있다).

INSERT INTO notices (association_id, title, body, tag, pinned, image)
SELECT a.id,
  '제5회 방배페스티벌 — 10월 17일(토)',
  '방배카페골목 일대에서 제5회 방배페스티벌이 열립니다.

언제 — 2026년 10월 17일(토) 오후 3시 ~ 저녁 8시 (개회식 저녁 6시)
어디서 — 방배카페골목 일대

[프로그램]
· 어린이 마실콘서트
· 방배카페골목 미식로드 — 대표 맛집 22곳이 참여하는 음식문화축제
· 방배카페골목 주민 노래자랑 — 예선을 거친 주민들의 본선 무대 (오후 4시 30분 ~ 5시 40분)
· 레트로 감성체험부스

[축하 무대]
송가인 · 김다나 · 이현승 · 조영구

주최 방배본·1·2·3·4동 주민자치위원회
주관 방배본동 주민자치위원회, 방배카페골목 상가번영회, 서초구
후원 서초새마을금고

홈페이지 [행사] 에서 날짜를 휴대폰 달력에 바로 넣으실 수 있습니다.',
  '행사', 1, '/img/festival/bangbae-festival-2026.webp'
FROM associations a
WHERE a.name LIKE '%방배카페골목%'
  AND NOT EXISTS (SELECT 1 FROM notices n WHERE n.association_id = a.id AND n.title = '제5회 방배페스티벌 — 10월 17일(토)');

INSERT INTO notices (association_id, title, body, tag, pinned, image)
SELECT a.id,
  '미식로드 — 골목 맛집 22곳',
  '축제 당일 골목 전체에서 미식로드가 함께 열립니다.
방배카페골목 대표 맛집 22선과 함께하는 음식문화축제입니다.

언제 — 2026년 10월 17일(토), 방배페스티벌 행사 시간 중
어디서 — 방배카페골목 일대

[참여 가게 22곳]
달빛한스푼 · 수다 · 감순네 야구찜 · 쏘이313 · 피아체
할아버지 간장게장 야구찜 · 루이즈덱케이크 · 나라김밥 · 마리연구소
윌리제이 · 바다가득한집 · 차돌라 샌드위치 · 장인감자탕
그린앤피니 · 너나들이 · 찹쌀순대 만드는집 · 스마일 포차 · 강촌닭갈비
김가네 · 압구정 샌드위치 · 서호김밥 · 트로피티아일랜드

가게 위치는 홈페이지 [점포 지도] 에서 찾아보실 수 있습니다.',
  '행사', 0, '/img/festival/misik-road-2026.webp'
FROM associations a
WHERE a.name LIKE '%방배카페골목%'
  AND NOT EXISTS (SELECT 1 FROM notices n WHERE n.association_id = a.id AND n.title = '미식로드 — 골목 맛집 22곳');

-- ③ 주민 노래자랑. 포스터에는 "9월 23일까지 접수해주세요" 가 크게 적혀 있지만 그 날짜는
--    이미 지났다. 포스터를 글자 그대로 옮기면 공지가 거짓말이 된다 — 끝난 것은 끝났다고
--    적고, 아직 남은 본선을 앞세운다.
INSERT INTO notices (association_id, title, body, tag, pinned, image)
SELECT a.id,
  '주민 노래자랑 본선 — 10월 17일',
  '방배카페골목 주민과 상인들이 함께 즐기는 주민 노래자랑입니다.

본선 — 2026년 10월 17일(토) 오후 4시 30분 ~ 5시 40분
어디서 — 방배카페골목(방배중앙로) 일대, 제5회 방배페스티벌 무대

예선은 10월 3일(토) 라이브카페 CNN 에서 마쳤습니다.
참가 접수는 9월 23일(수)로 끝나, 지금은 새로 신청하실 수 없습니다.
예선을 거친 분들이 축제 무대에 오릅니다 — 축제장에서 함께 응원해 주세요.

주최·주관 방배카페골목 상인회
문의 010-6619-1553',
  '행사', 0, '/img/festival/norae-jarang-2026.webp'
FROM associations a
WHERE a.name LIKE '%방배카페골목%'
  AND NOT EXISTS (SELECT 1 FROM notices n WHERE n.association_id = a.id AND n.title = '주민 노래자랑 본선 — 10월 17일');
