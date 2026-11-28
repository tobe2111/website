// 필라멘트 길이 · 무게 계산기 (/3d-tools/filament-calculator/). 결과는 팝업으로 보여 준다.
(() => {
  const f = document.querySelector("[data-fc]"), dlg = document.querySelector("[data-result]");
  if (!f) return;
  const fmt = (n, k = 1) => n.toLocaleString("ko-KR", { maximumFractionDigits: k });
  const sync = () => {
    const m = f.mode.value;
    f.querySelectorAll("[data-f]").forEach((el) => { el.hidden = !el.dataset.f.split(" ").includes(m) && !(m === "m2g" && el.dataset.f.includes("g2m")); });
    f.querySelector("[data-f-label]").textContent = m === "m2g" ? "길이 (m)" : m === "left" ? "스풀째 잰 무게 (g)" : "무게 (g)";
  };
  f.mode.addEventListener("change", sync); sync();
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    const rho = +f.mat.value, r = +f.dia.value / 20, area = Math.PI * r * r; // cm²
    const name = f.mat.selectedOptions[0].textContent.split(" (")[0], a = Math.max(0, +f.a.value || 0), b = Math.max(0, +f.b.value || 0);
    let h, rows;
    if (f.mode.value === "m2g") { const g = a * 100 * area * rho; h = `${name} ${fmt(a, 1)} m 는 약 ${fmt(g)} g`; rows = [["길이", `${fmt(a, 1)} m`], ["무게", `${fmt(g)} g`], ["부피", `${fmt(g / rho)} cm³`]]; }
    else {
      const g = f.mode.value === "left" ? Math.max(0, a - b) : a, m = g / rho / area / 100;
      h = f.mode.value === "left" ? `남은 ${name} 약 ${fmt(g)} g · ${fmt(m)} m` : `${name} ${fmt(g)} g 는 약 ${fmt(m)} m`;
      rows = [["무게", `${fmt(g)} g`], ["길이", `${fmt(m)} m`], ["1 kg 스풀 대비", `${fmt(g / 10)} %`]];
    }
    rows.unshift(["재료 · 지름", `${name} · ${f.dia.value} mm`]);
    const dl = document.createElement("dl"); dl.className = "tl__info";
    for (const [k, v] of rows) { const d = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = k; dd.textContent = v; d.append(dt, dd); dl.appendChild(d); }
    dlg.querySelector("[data-result-h]").textContent = h;
    const body = dlg.querySelector("[data-result-body]"); body.textContent = ""; body.appendChild(dl);
    dlg.showModal();
  });
  dlg.querySelectorAll("[data-result-close]").forEach((x) => x.addEventListener("click", () => dlg.close()));
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
})();
