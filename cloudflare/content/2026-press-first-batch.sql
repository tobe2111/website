-- 처음 모아 온 기사 20건 중, 홈에 올릴 것을 고릅니다.
--
-- 왜 전부 올리지 않나.
-- 2018년 기사 세 건이 "화려함은 사라지고", "이름 뿐인 방배카페골목", "카페 대신 맛집만"
-- 입니다. 8년 전 골목이 쇠락했다는 진단이고, 사실이었을 수 있지만 **지금 상인회가
-- 자기 첫 화면에 걸 글은 아닙니다.** 손님이 그걸 읽고 발길을 돌리면 그 손해는 가게 몫입니다.
-- 같은 2018년의 '한마음 축제' 기사도 8년 지난 행사라 안내가 못 됩니다.
-- 시몬스 쇼룸 기사는 '방배 카페거리 옆' 브랜드 홍보라 골목 얘기가 아닙니다.
--
-- 내려 둔 것은 지우지 않습니다. 관리 화면 › 언론 보도 › '치운 기사' 에 그대로 있고,
-- 회장님이 생각이 다르시면 거기서 [홈에 올리기] 한 번이면 올라갑니다.
--
-- 안전장치: status='new'(아직 회장님이 손대지 않은 줄)만 고칩니다.
--   ① 두 번 돌려도 같습니다. ② 회장님이 내리거나 올린 기사는 덮어쓰지 않습니다.

-- ① 매체 이름이 주소로 들어간 줄을 사람이 읽는 이름으로 (구글이 가끔 주소를 보냅니다)
UPDATE press SET source = '서울신문'  WHERE source = 'go.seoul.co.kr';
UPDATE press SET source = '국제뉴스'  WHERE source = 'gukjenews.com';
UPDATE press SET source = '다음뉴스'  WHERE source = 'v.daum.net';

-- ② 홈에 안 올릴 것 — 치움(지우지 않고 남겨 둡니다)
UPDATE press SET status = 'hidden'
WHERE status = 'new'
  AND (published_at < '2020-01-01' OR title LIKE '%시몬스%');

-- ③ 나머지는 홈에 올립니다 (홈에는 최신 6건이 보이고, 나머지는 쌓입니다)
UPDATE press SET status = 'live'
WHERE status = 'new';
