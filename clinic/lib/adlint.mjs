// 의료광고 표현 점검 — 의료법 제56조가 막는 표현이 원고에 섞이면 빌드를 멈춘다.
//
// 병원 홈페이지는 의료광고다. "최고·유일·완치" 같은 말, 환자 후기, 치료 전후 비교는
// 심의에서 걸리고 민원이 들어오면 병원이 행정처분을 받는다. 원고를 쓰는 사람이 매번
// 기억할 수는 없으니, 빌드가 대신 기억한다. 걸린 문장은 어느 파일 어느 칸인지까지 알려준다.
//
// 이 목록은 "확실히 걸리는 말"만 담는다. 걸리지 않았다고 심의를 통과한다는 뜻은 아니다.

export const BANNED = [
  [/최고|최상|최첨단|최초|유일|독보적|넘버\s*원|No\.?\s*1|1위/i, "비교·최상급 표현 (다른 병원보다 낫다는 인상)"],
  [/완치|완벽|100\s*%|확실히\s*(낫|좋아)|반드시\s*(낫|좋아)|효과\s*보장|보장합니다/, "치료 효과를 장담하는 표현"],
  [/부작용\s*(이|이\s*전혀)?\s*없|무통|통증\s*(이\s*)?(전혀\s*)?없는\s*(시술|치료)|안전한\s*시술/, "부작용·통증이 없다고 단정하는 표현"],
  [/(치료|시술|수술)\s*(전\s*후|전후)|비포\s*(&|앤드)?\s*애프터|before\s*(&|and)?\s*after/i, "치료 전후 비교"],
  [/후기|체험담|치료\s*사례|생생한\s*경험/, "환자 후기·체험담"],
  [/특가|할인|이벤트\s*가|무료\s*(시술|치료|검사)|선착순|파격/, "가격 할인·무료로 환자를 끄는 표현"],
  // 영어 페이지(해외 환자용)도 같은 의료광고다
  [/\b(best|number one|no\.?\s?1|top-rated|leading|world-class)\b/i, "superlatives or comparisons (English)"],
  [/\b(cures?|cured|guaranteed?|100\s?%|permanent(ly)? (fix|relief))\b/i, "promising results (English)"],
  [/\b(painless|pain-free (treatment|procedure)|no side effects|risk-free)\b/i, "claiming no pain or side effects (English)"],
  [/before[\s-]*(&|and)[\s-]*after/i, "before/after comparison (English)"],
  [/\b(testimonials?|patient reviews?)\b/i, "patient testimonials (English)"],
  [/\b(discount|free (consultation|treatment|surgery)|promotion)\b/i, "discounts or free treatment (English)"],
  // 중국어 페이지(번체·간체) — '第一'만 막으면 '第一步(첫걸음)'까지 걸리므로 순위 표현으로만 막는다
  [/最好|最佳|第一名|排名第一|首選|首选|唯一|頂尖|顶尖|權威|权威/, "最高級・比較表現（中文）"],
  [/根治|治癒|治愈|痊癒|痊愈|保證|保证|永久(改善|治好)/, "保證療效（中文）"],
  [/無痛|无痛|無副作用|无副作用|零風險|零风险|絕對安全|绝对安全/, "宣稱無痛・無副作用（中文）"],
  [/(治療|治疗|手術|手术)前後|前後對比|前后对比/, "治療前後對比（中文）"],
  [/患者評價|患者评价|真實案例|真实案例|好評|好评|見證|见证/, "患者評價・見證（中文）"],
  [/優惠|优惠|折扣|特價|特价|免費(治療|檢查)|免费(治疗|检查)/, "折扣・免費療程（中文）"],
];

// 값 하나(문자열)를 검사해 걸린 항목을 돌려준다
export function lintText(text) {
  const out = [];
  for (const [re, why] of BANNED) {
    const m = String(text || "").match(re);
    if (m) out.push({ word: m[0], why });
  }
  return out;
}

// JSON 덩어리 전체를 훑는다. where 는 "treatments.json › herniated-disc › faq[1]" 처럼 위치를 알려준다.
// _note 처럼 밑줄로 시작하는 칸은 내부 메모라 화면에 나가지 않으므로 검사하지 않는다.
export function lintTree(node, where = "") {
  const found = [];
  const walk = (v, path) => {
    if (typeof v === "string") {
      for (const hit of lintText(v)) found.push({ where: path, ...hit, text: v.length > 60 ? v.slice(0, 60) + "…" : v });
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (k.startsWith("_")) continue;
        walk(x, path ? `${path} › ${v.slug && k !== "slug" ? `${v.slug}.${k}` : k}` : k);
      }
    }
  };
  walk(node, where);
  return found;
}
