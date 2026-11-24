-- 결제대행사(토스페이먼츠) 심사용 샘플 조직 · 계정 · 결제 안내.
--
-- 심사하는 사람이 로그인해서 결제창(관리 화면 → 이용료 결제)을 확인할 수 있게 한다.
-- 실제 고객이 아니라 빈 조직이다. 심사가 끝나면 운영사 콘솔에서 비활성화하거나 지운다.
-- 비밀번호는 여기 없다(복원할 수 없는 값만 있다) — 운영사가 따로 가지고 있다.
--
-- 안전장치: 셋 다 '없을 때만' 넣는다. 두 번 돌려도 같고, 화면에서 고친 값(비밀번호 · 금액)을 덮어쓰지 않는다.
INSERT INTO associations (slug, name, brand_color, tagline, kind, preset)
SELECT 'review-sample', '심사용 샘플', '#1F6CFF', '결제 심사용 샘플 조직입니다', 'franchise', 'franchise'
WHERE NOT EXISTS (SELECT 1 FROM associations WHERE slug = 'review-sample');

INSERT INTO users (association_id, email, password_hash, salt, name, role)
SELECT a.id, 'review@ur-team.com', 'u7HjtR18doHIbw7sWJjLmi-i-o0Uvsxiy_3fnsRem3c', 'E81bTAMP-aQPuWRyq_mV2Q', '심사 담당자', 'ADMIN'
FROM associations a
WHERE a.slug = 'review-sample'
  AND NOT EXISTS (SELECT 1 FROM users WHERE email = 'review@ur-team.com');

-- 요금표와 같은 금액: 초기 제작비 990,000원 · 월 이용료 15,000원
INSERT INTO subscriptions (association_id, plan, monthly_amount, setup_amount, status, customer_key)
SELECT a.id, 'basic', 15000, 990000, 'offered', 'c_9de1a80ee188dcfaf8e7d2ce20e4534a'
FROM associations a
WHERE a.slug = 'review-sample'
  AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.association_id = a.id);
