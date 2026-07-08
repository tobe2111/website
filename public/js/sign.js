// 전자서명 캔버스 — 마우스/터치로 서명 입력, 제출 시 PNG dataURL 을 hidden 필드에 담음
(function () {
  "use strict";
  var canvas = document.getElementById("signPad");
  var form = document.getElementById("signForm");
  var field = document.getElementById("signatureData");
  var clearBtn = document.getElementById("signClear");
  if (!canvas || !form || !field) return;

  var ctx = canvas.getContext("2d");
  var drawing = false, dirty = false, last = null;

  // 흰 배경(투명 PNG 대신 흰 배경으로 저장 → 어디서나 보이게)
  function reset() {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#16211d";
    ctx.lineWidth = 2.2;
    ctx.lineJoin = ctx.lineCap = "round";
    dirty = false;
  }
  reset();

  function pos(e) {
    var r = canvas.getBoundingClientRect();
    var t = e.touches ? e.touches[0] : e;
    return {
      x: (t.clientX - r.left) * (canvas.width / r.width),
      y: (t.clientY - r.top) * (canvas.height / r.height),
    };
  }
  function start(e) { drawing = true; last = pos(e); e.preventDefault(); }
  function move(e) {
    if (!drawing) return;
    var p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p; dirty = true;
    e.preventDefault();
  }
  function end() { drawing = false; }

  canvas.addEventListener("mousedown", start);
  canvas.addEventListener("mousemove", move);
  window.addEventListener("mouseup", end);
  canvas.addEventListener("touchstart", start, { passive: false });
  canvas.addEventListener("touchmove", move, { passive: false });
  canvas.addEventListener("touchend", end);

  if (clearBtn) clearBtn.addEventListener("click", function () { reset(); });

  form.addEventListener("submit", function (e) {
    if (!dirty) { e.preventDefault(); alert("서명란에 서명을 입력해 주세요."); return; }
    field.value = canvas.toDataURL("image/png");
  });
})();
