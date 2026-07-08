// 대시보드: 파일 선택/드래그앤드롭 미리보기 + 업로드 상태
(function () {
  "use strict";
  var drop = document.getElementById("fileDrop");
  var input = document.getElementById("fileInput");
  var list = document.getElementById("fileList");
  var form = document.getElementById("uploadForm");
  var btn = document.getElementById("uploadBtn");
  if (!drop || !input) return;

  function fmt(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  }

  function render() {
    list.innerHTML = "";
    var files = input.files;
    if (!files || !files.length) return;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var row = document.createElement("div");
      row.className = "file-row";
      var kind = f.type.indexOf("video") === 0 ? "🎬" : "🖼";
      row.innerHTML = "<span>" + kind + " " + escapeHtml(f.name) + "</span><span>" + fmt(f.size) + "</span>";
      list.appendChild(row);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  input.addEventListener("change", render);

  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) {
      e.preventDefault();
      drop.classList.add("drag");
    });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) {
      e.preventDefault();
      drop.classList.remove("drag");
    });
  });
  drop.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files.length) {
      input.files = e.dataTransfer.files;
      render();
    }
  });

  if (form && btn) {
    form.addEventListener("submit", function () {
      if (input.files && input.files.length) {
        btn.disabled = true;
        btn.textContent = "업로드 중...";
      }
    });
  }
})();
