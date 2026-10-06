-- 방배카페골목상인회에 '언론 속 우리 골목' 수집을 켭니다.
--
-- 기본은 꺼짐입니다(켜기 전에는 남의 서버를 한 번도 찌르지 않습니다). 이 상인회는
-- 축제를 세 개 열고 있어 기사가 날 시기라, 켜 두면 다음 아침부터 모입니다.
-- 모이기만 하고 홈에는 아무것도 안 뜹니다 — 관리 화면에서 고른 것만 올라갑니다.
--
-- 안전장치: 둘 다 '없을 때만' 넣습니다(settings 의 key 가 기본키).
--   ① 두 번 돌려도 같습니다.
--   ② 회장님이 화면에서 끄거나 낱말을 고치셨다면 그 값을 덮어쓰지 않습니다.
INSERT INTO settings (key, value)
SELECT 'press_on:' || a.id, '1'
FROM associations a
WHERE a.name LIKE '%방배카페골목%' AND a.kind = 'merchant'
ON CONFLICT(key) DO NOTHING;

-- 찾을 낱말. 기사는 "방배카페골목상인회" 라고 쓰지 않고 골목 이름만 씁니다.
-- '방배 카페골목' 처럼 띄어 쓴 제목도 같은 낱말로 걸립니다(공백은 무시합니다).
-- 뒤 두 줄은 버리는 낱말입니다 — 이 동네 기사에 가장 많이 섞여 드는 것이 분양·시세 광고입니다.
INSERT INTO settings (key, value)
SELECT 'press_terms:' || a.id, '방배카페골목
방배 카페거리
-분양
-시세'
FROM associations a
WHERE a.name LIKE '%방배카페골목%' AND a.kind = 'merchant'
ON CONFLICT(key) DO NOTHING;
