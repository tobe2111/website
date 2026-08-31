// PDF 양식을 계약서 지면으로 — 관리자 브라우저에서 각 쪽을 그림으로 굽는다.
//
// 왜 브라우저에서 하나:
//   Workers 에는 PDF 를 그릴 방법이 없고(라이브러리도, CPU 시간도), 서버에서 굽는다면
//   그 비용을 우리가 매번 낸다. 관리자는 계약서 한 건을 만들 때 한 번만 하면 되고,
//   그 사람 컴퓨터는 이미 놀고 있다.
//
// 왜 서명하는 사람에게는 이 파일이 안 가나:
//   여기서 구운 그림을 서버에 올려 두므로, 서명 화면에는 그림만 간다.
//   휴대폰으로 계약서를 받는 상대방에게 1.7MB 짜리 PDF 해석기를 지우지 않는다.
//
// 법적 원문은 여전히 **원본 PDF** 다. 그림은 보기·배치용 지면이고, 봉인에 들어가는 해시는
// 원본 파일의 것이다. 그래서 원본도 함께 올린다.
(function () {
  "use strict";
  var root = document.getElementById("pdfForm");
  if (!root) return;

  var pick = root.querySelector("#pdfPick");
  var status = root.querySelector("#pdfStatus");
  var preview = root.querySelector("#pdfPreview");
  // 제출 단추는 #pdfForm 바깥(폼 맨 끝)에 있다 — root 안에서 찾으면 못 찾고,
  // 못 찾으면 '다 구웠는데 단추가 계속 잠겨 있는' 상태가 된다.
  var submit = document.getElementById("pdfSubmit");
  var form = root.closest("form");
  var pagesInput = root.querySelector("#pdfPages");
  var titleInput = form && form.querySelector('[name="title"]');

  // 쪽 그림의 가로 픽셀. 1240px 이면 A4 를 150dpi 로 뽑은 것과 비슷해서
  // 화면에서도 인쇄에서도 글자가 뭉개지지 않는다. 더 키우면 업로드만 무거워진다.
  var TARGET_W = 1240;
  var MAX_PAGES = 30;

  var baked = [];   // [{ blob, w, h }]
  var srcFile = null;

  function say(msg, kind) {
    status.textContent = msg;
    status.className = "pdf-status" + (kind ? " is-" + kind : "");
  }
  function lock(on) {
    if (submit) submit.disabled = on || !baked.length;
    pick.disabled = on;
  }

  pick.addEventListener("change", function () {
    var f = pick.files && pick.files[0];
    if (!f) return;
    baked = []; preview.innerHTML = ""; srcFile = f;
    if (submit) submit.disabled = true;
    bake(f).catch(function (e) {
      say("이 PDF 를 읽지 못했습니다. 암호가 걸려 있거나 손상된 파일일 수 있습니다. (" + (e && e.message ? e.message : "원인 불명") + ")", "err");
      lock(false);
    });
  });

  async function bake(file) {
    lock(true);
    say("PDF 를 여는 중…");
    var pdfjs = await import("/js/vendor/pdf.min.js");
    pdfjs.GlobalWorkerOptions.workerSrc = "/js/vendor/pdf.worker.min.js";

    var buf = await file.arrayBuffer();
    var doc = await pdfjs.getDocument({
      data: new Uint8Array(buf),
      // CSP 에 unsafe-eval 이 없다 — pdf.js 가 글꼴 처리에 쓰는 우회 경로를 꺼 둔다.
      isEvalSupported: false,
      // 한글 계약서 PDF 가 글꼴을 안고 있지 않은 경우(옛 한글 문서·관공서 서식에 흔하다)
      // 이 표들이 없으면 글자가 통째로 빈칸으로 그려진다. 그래서 함께 넣어 두었다.
      cMapUrl: "/js/vendor/cmaps/", cMapPacked: true,
      standardFontDataUrl: "/js/vendor/standard_fonts/",
    }).promise;
    var n = Math.min(doc.numPages, MAX_PAGES);
    if (doc.numPages > MAX_PAGES) say(doc.numPages + "쪽 중 앞 " + MAX_PAGES + "쪽만 씁니다.", "warn");

    for (var i = 1; i <= n; i++) {
      say(n + "쪽 중 " + i + "쪽 굽는 중…");
      var page = await doc.getPage(i);
      var base = page.getViewport({ scale: 1 });
      var vp = page.getViewport({ scale: TARGET_W / base.width });
      var canvas = document.createElement("canvas");
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      var ctx = canvas.getContext("2d", { alpha: false });
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      // JPEG 로 굽는다 — 스캔 양식은 사진에 가까워 PNG 로 두면 쪽당 1MB 를 넘긴다.
      var blob = await new Promise(function (res) { canvas.toBlob(res, "image/jpeg", 0.86); });
      if (!blob) throw new Error(i + "쪽을 그림으로 만들지 못했습니다");
      baked.push({ blob: blob, w: canvas.width, h: canvas.height });

      var thumb = document.createElement("figure");
      thumb.className = "pdf-thumb";
      var img = document.createElement("img");
      img.src = URL.createObjectURL(blob);
      img.alt = i + "쪽";
      var cap = document.createElement("figcaption");
      cap.textContent = i + " / " + n;
      thumb.appendChild(img); thumb.appendChild(cap);
      preview.appendChild(thumb);
    }
    await doc.destroy();

    var kb = baked.reduce(function (a, b) { return a + b.blob.size; }, 0) / 1024;
    say(n + "쪽을 지면으로 만들었습니다. (" + (kb > 1024 ? (kb / 1024).toFixed(1) + "MB" : Math.round(kb) + "KB") + ")", "ok");
    // 제목을 안 적었으면 파일 이름에서 가져온다 — 다시 타이핑하게 만들 이유가 없다
    if (titleInput && !titleInput.value.trim()) titleInput.value = file.name.replace(/\.pdf$/i, "").slice(0, 120);
    if (pagesInput) pagesInput.value = String(n);
    lock(false);
    if (submit) submit.disabled = false;
  }

  // 제출 — 원본 PDF + 구운 쪽 그림을 함께 보낸다.
  // 폼 기본 제출을 가로채는 이유: 그림은 화면에서 만든 것이라 <input type=file> 에 담을 수 없다.
  if (form) {
    form.addEventListener("submit", function (e) {
      if (!baked.length) return;                    // 양식 없이 만드는 경우는 그냥 보낸다
      e.preventDefault();
      var fd = new FormData(form);
      fd.set("attachment", srcFile, srcFile.name);
      baked.forEach(function (p, i) {
        fd.append("scan_" + i, p.blob, "page-" + (i + 1) + ".jpg");
        fd.append("scan_size_" + i, p.w + "x" + p.h);
      });
      lock(true);
      say("올리는 중… 쪽 수가 많으면 잠시 걸립니다.");
      fetch(form.action, { method: "POST", body: fd, credentials: "same-origin", redirect: "follow" })
        .then(function (r) { location.href = r.url || form.action; })
        .catch(function () { say("업로드에 실패했습니다. 연결을 확인하고 다시 눌러 주세요.", "err"); lock(false); });
    });
  }
})();
