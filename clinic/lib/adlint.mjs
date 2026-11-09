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
