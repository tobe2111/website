// 3D프린팅 견적 화면 — 올린 파일의 부피 · 크기를 브라우저에서 재고 예상 금액을 보여준다.
// STL 은 직접 읽고, STEP 은 occt-import-js(WebAssembly, 7MB)를 별도 작업자에서 STEP 을 골랐을 때만 불러 읽는다.
// 계산값은 숨은 칸(geo_i)으로 함께 보내지만 서버는 참고로만 쓴다(STL 은 서버가 다시 잰다).
(function () {
  "use strict";
  var form = document.querySelector("[data-print-form]");
  if (!form) return;
  var P = JSON.parse(form.getAttribute("data-pricing") || "{}");
  var input = form.querySelector("[data-print-files]");
  var list = form.querySelector("[data-print-list]");
  var matSel = form.querySelector("[data-print-material]");
  var mNote = form.querySelector("[data-print-mnote]");
  var out = {
    total: document.querySelector("[data-print-total]"),
    sub: document.querySelector("[data-print-sub]"),
    lines: document.querySelector("[data-print-lines]"),
    warn: document.querySelector("[data-print-warn]"),
  };
  var NOTES = {};
  [].forEach.call(document.querySelectorAll(".pr-mat"), function (el) {
    NOTES[el.querySelector("b").textContent] = el.querySelector("p").textContent;
  });
  var parts = []; // { name, qty, volume, size, state }

  function won(n) { return Math.round(n).toLocaleString("ko-KR") + "원"; }
  function roundUp(n, s) { return Math.ceil(n / s) * s; }
  function tier(q) { var f = 1; (P.tiers || []).forEach(function (t) { if (q >= t[0]) f = t[1]; }); return f; }

  // 닫힌 표면: 삼각형마다 원점과 이루는 사면체의 부호 있는 부피를 더한다.
  function measure(pos, idx) {
    var v = 0, mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], i, k;
    for (i = 0; i < pos.length; i += 3) for (k = 0; k < 3; k++) {
      if (pos[i + k] < mn[k]) mn[k] = pos[i + k];
      if (pos[i + k] > mx[k]) mx[k] = pos[i + k];
    }
    var n = idx ? idx.length : pos.length / 3;
    for (i = 0; i < n; i += 3) {
      var a = (idx ? idx[i] : i) * 3, b = (idx ? idx[i + 1] : i + 1) * 3, c = (idx ? idx[i + 2] : i + 2) * 3;
      v += (pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
        - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
        + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c])) / 6;
    }
    return { v: Math.abs(v), mn: mn, mx: mx };
  }
  function finish(acc) {
    if (!(acc.v > 0)) return null;
    return { volume: Math.round(acc.v / 10) / 100, size: acc.mx.map(function (x, k) { return Math.round((x - acc.mn[k]) * 10) / 10; }) };
  }


  function readStl(buf) {
    var dv = new DataView(buf), pos;
    if (buf.byteLength >= 84 && 84 + dv.getUint32(80, true) * 50 === buf.byteLength) {
      var n = dv.getUint32(80, true);
      pos = new Float32Array(n * 9);
      for (var i = 0; i < n; i++) for (var j = 0; j < 9; j++) pos[i * 9 + j] = dv.getFloat32(84 + i * 50 + 12 + j * 4, true);
    } else {
      var txt = new TextDecoder().decode(buf), re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g, m, arr = [];
      while ((m = re.exec(txt))) arr.push(+m[1], +m[2], +m[3]);
      pos = new Float32Array(arr);
    }
    return finish(measure(pos, null));
  }

  // STEP 은 별도 작업자에서 읽는다(vendor/occt/step-worker.js). 7MB 짜리 부품이라 STEP 을 골랐을 때만 띄운다.
  var worker = null, seq = 0, waiting = {};
  function readStep(buf) {
    if (!window.Worker) return Promise.resolve(null);
    if (!worker) {
      worker = new Worker("/js/vendor/occt/step-worker.js");
      worker.onmessage = function (ev) {
        var w = waiting[ev.data.id];
        if (!w) return;
        delete waiting[ev.data.id];
        if (ev.data.error && window.console) console.warn("STEP 파일을 읽지 못했습니다:", ev.data.error);
        w(ev.data.geo);
      };
    }
    var id = ++seq;
    return new Promise(function (res) { waiting[id] = res; worker.postMessage({ id: id, buffer: buf }, [buf]); });
  }

  function render() {
    var mat = matSel.value, rate = (P.rates || {})[mat] || { rate: 0, min: 0 }, info = (P.materials || {})[mat] || {};
    var sum = 0, unknown = 0, busy = 0, big = [];
    out.lines.innerHTML = "";
    parts.forEach(function (p) {
      var li = document.createElement("li");
      if (p.state === "busy") { busy++; li.textContent = p.name + " · 계산 중…"; }
      else if (!p.geo) { unknown++; li.textContent = p.name + " × " + p.qty + " · 담당자 확인"; }
      else {
        var unit = Math.max(rate.min, p.geo.volume * rate.rate) * tier(p.qty);
        sum += unit * p.qty;
        var g = Math.round(p.geo.volume * (info.density || 1.2));
        li.textContent = p.name + " × " + p.qty + " · 약 " + g.toLocaleString("ko-KR") + "g";
        if (info.maxMm && p.geo.size.some(function (x) { return x > info.maxMm; })) big.push(p.name);
      }
      out.lines.appendChild(li);
    });
    if (!parts.length) { out.total.textContent = "파일을 올리면 계산됩니다"; }
    else if (busy) { out.total.textContent = "계산 중…"; }
    else if (sum > 0) {
      var base = sum + (P.shipping || 0);
      out.total.textContent = won(roundUp(base * 0.85, 1000)) + " ~ " + won(roundUp(base * 1.2, 1000));
    } else { out.total.textContent = "담당자가 확인 후 알려드립니다"; }
    out.sub.textContent = unknown && sum > 0 ? "부가세 별도 · 일부 파일은 금액에서 빠져 있습니다" : "부가세 별도 · 배송비 포함";
    var w = [];
    if (big.length) w.push(big.join(", ") + ": 이 재질로 한 번에 뽑기에는 커서 나눠서 만들어야 할 수 있습니다.");
    if (unknown) w.push("3MF · OBJ 파일이나 읽지 못한 파일은 담당자가 직접 확인합니다.");
    out.warn.hidden = !w.length;
    out.warn.textContent = w.join(" ");
  }

  function rowsHtml() {
    list.innerHTML = "";
    list.hidden = !parts.length;
    parts.forEach(function (p, i) {
      var row = document.createElement("div");
      row.className = "pr-file";
      var name = document.createElement("span");
      name.className = "pr-file__n";
      name.textContent = p.name;
      var dim = document.createElement("small");
      dim.className = "pr-file__d";
      dim.textContent = p.geo ? p.geo.size.join(" × ") + " mm · " + p.geo.volume.toLocaleString("ko-KR") + " cm³" : (p.state === "busy" ? "계산 중…" : "크기 확인 필요");
      name.appendChild(dim);
      var q = document.createElement("label");
      q.className = "pr-file__q";
      q.innerHTML = '<span>수량</span><input type="number" min="1" max="100000" inputmode="numeric">';
      var qi = q.querySelector("input");
      qi.name = "qty_" + i; qi.value = p.qty;
      qi.addEventListener("input", function () { p.qty = Math.max(1, parseInt(qi.value, 10) || 1); render(); });
      var h = document.createElement("input");
      h.type = "hidden"; h.name = "geo_" + i; h.value = p.geo ? JSON.stringify(p.geo) : "";
      row.appendChild(name); row.appendChild(q); row.appendChild(h);
      list.appendChild(row);
    });
  }

  input.addEventListener("change", function () {
    var files = [].slice.call(input.files || [], 0, 10);
    parts = files.map(function (f) { return { name: f.name, qty: 1, geo: null, state: "busy" }; });
    rowsHtml(); render();
    files.forEach(function (f, i) {
      var ext = (f.name.split(".").pop() || "").toLowerCase();
      var job = f.arrayBuffer().then(function (buf) {
        if (ext === "stl") return readStl(buf);
        if (ext === "step" || ext === "stp") return readStep(buf);
        return null;
      });
      job.then(function (g) { parts[i].geo = g; }, function (e) { parts[i].geo = null; if (window.console) console.warn("파일을 읽지 못했습니다:", f.name, e); })
        .then(function () {
          parts[i].state = "done";
          // 수량 칸에 입력 중인 값은 지키면서 크기 표시만 다시 그린다
          rowsHtml(); render();
        });
    });
  });
  matSel.addEventListener("change", function () {
    var label = matSel.options[matSel.selectedIndex].text;
    if (NOTES[label]) mNote.textContent = NOTES[label];
    render();
  });
  // 두 번 눌러 같은 파일이 두 번 올라가지 않게
  form.addEventListener("submit", function () {
    var b = form.querySelector("button[type=submit]");
    setTimeout(function () { b.disabled = true; b.textContent = "보내는 중…"; }, 0);
  });
})();
