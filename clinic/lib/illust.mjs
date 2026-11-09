// 진료 과목 그림 — 척추·어깨·무릎·발·비수술 치료를 가는 선으로 그린 도해.
//
// 사진이 오기 전에도 화면에 '이 병원이 무엇을 보는 곳인지'가 그림으로 보이게 하고, 사진이 온 뒤에도
// 진료 과목 표시로 계속 쓴다. 흔한 아이콘 묶음(둥근 네모 안의 픽토그램)을 쓰면 그게 곧 템플릿 티라서
// 해부 도해처럼 선만으로 직접 그렸다. 색은 병원 강조색을 따른다(currentColor · .acc 는 강조선).
//
// 모든 선에 pathLength="1" 을 붙여, CSS 가 길이를 몰라도 '선이 그어지는' 움직임을 줄 수 있게 한다.
const L = (s) => s.replace(/<(path|rect|circle|ellipse|line)\b/g, '<$1 pathLength="1"');

const ART = {
  // 옆에서 본 척추 — S자로 휜 척추뼈와 사이사이 디스크(강조선)
  spine: `<rect x="41.7" y="9.5" width="28" height="9" rx="3" transform="rotate(5.3 55.7 14.0)"/><path d="M69.7 14.0 l9 2.0"/><rect x="47.9" y="22.1" width="28" height="9" rx="3" transform="rotate(5.9 61.9 26.6)"/><path d="M75.9 26.6 l9 2.3"/><rect x="53.2" y="34.7" width="28" height="9" rx="3" transform="rotate(3.6 67.2 39.2)"/><path d="M81.2 39.2 l9 2.6"/><rect x="55.0" y="47.3" width="28" height="9" rx="3" transform="rotate(-0.5 69.0 51.8)"/><path d="M83.0 51.8 l9 2.9"/><rect x="52.3" y="59.9" width="28" height="9" rx="3" transform="rotate(-4.3 66.3 64.4)"/><path d="M80.3 64.4 l9 3.2"/><rect x="46.5" y="72.5" width="28" height="9" rx="3" transform="rotate(-6.0 60.5 77.0)"/><path d="M74.5 77.0 l9 3.5"/><rect x="40.4" y="85.1" width="28" height="9" rx="3" transform="rotate(-4.7 54.4 89.6)"/><path d="M68.4 89.6 l9 3.8"/><rect x="37.2" y="97.7" width="28" height="9" rx="3" transform="rotate(-1.1 51.2 102.2)"/><path d="M65.2 102.2 l9 4.1"/><path class="acc" d="M49.8 20.3 h18"/><path class="acc" d="M55.6 32.9 h18"/><path class="acc" d="M59.1 45.5 h18"/><path class="acc" d="M58.6 58.1 h18"/><path class="acc" d="M54.4 70.7 h18"/><path class="acc" d="M48.4 83.3 h18"/><path class="acc" d="M43.8 95.9 h18"/>`,
  // 앞에서 본 어깨 — 쇄골, 어깨뼈 끝(견봉), 위팔뼈 머리와 관절면, 회전근개 힘줄(강조선)
  shoulder: `<path d="M14 34 Q46 22 84 30"/><path d="M84 30 Q98 34 100 46"/><path d="M78 36 Q86 48 80 62"/>
    <circle cx="66" cy="50" r="15"/><path d="M56 62 L50 112"/><path d="M76 62 L70 112"/>
    <path class="acc" d="M52 40 Q62 30 78 34"/><path class="acc" d="M54 46 Q64 38 80 42"/>`,
  // 앞에서 본 무릎 — 넙다리뼈·정강뼈·종아리뼈, 무릎뼈, 연골(강조선)
  knee: `<path d="M48 8 L46 48"/><path d="M74 8 L76 48"/>
    <path d="M42 50 Q42 62 54 62 Q60 58 66 62 Q80 62 80 50 Q78 46 76 48 M42 50 Q44 46 46 48"/>
    <circle cx="61" cy="46" r="8"/>
    <path class="acc" d="M44 67 Q61 63 78 67"/>
    <path d="M44 72 L78 72"/><path d="M48 72 L52 114"/><path d="M72 72 L68 114"/><path d="M82 76 L78 112"/>`,
  // 옆에서 본 발 — 발 윤곽, 발바닥 근막(강조선), 복사뼈
  "hand-foot": `<path d="M40 14 L40 56 Q38 72 26 82 Q16 92 24 100 Q30 106 44 104 L98 104 Q110 104 108 96 Q106 88 94 86 L72 80 Q62 74 58 58 L56 14"/>
    <circle cx="48" cy="66" r="4"/>
    <path class="acc" d="M30 99 Q60 93 96 99"/>`,
  // 비수술 치료 — 주사기와 체외충격파(퍼지는 물결, 강조선)
  nonsurgical: `<rect x="20" y="52" width="48" height="16" rx="2"/><path d="M68 60 L92 60"/><path d="M20 60 L8 60 M8 52 L8 68"/>
    <path d="M32 52 L32 46 M44 52 L44 46 M56 52 L56 46"/>
    <path class="acc" d="M98 44 Q106 60 98 76"/><path class="acc" d="M106 36 Q118 60 106 84"/>`,
};

export const hasIllust = (id) => Object.prototype.hasOwnProperty.call(ART, id);

// 그림 하나. 화면 읽기 프로그램에는 읽히지 않는다(옆의 글자가 같은 내용을 말한다).
export function illust(id, className = "") {
  if (!hasIllust(id)) return "";
  return `<svg class="ill ${className}" viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${L(ART[id])}</svg>`;
}
