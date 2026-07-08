// 네이버 지도 — 점포 마커 표시 + (대시보드) 좌표 피커
// 네이버 지도 API가 로드된 경우에만 동작(미로드 시 목록 폴백 유지).
(function () {
  "use strict";
  if (!window.naver || !naver.maps) return;

  // ----- 점포 지도 (마커 전체 표시) -----
  var mapEl = document.getElementById("storeMap");
  if (mapEl) {
    var base = mapEl.getAttribute("data-base") || "";
    var center = new naver.maps.LatLng(
      parseFloat(mapEl.getAttribute("data-center-lat")) || 37.4837,
      parseFloat(mapEl.getAttribute("data-center-lng")) || 127.0324
    );
    var zoom = parseInt(mapEl.getAttribute("data-zoom"), 10) || 14;
    var map = new naver.maps.Map(mapEl, { center: center, zoom: zoom });

    var data = [];
    try { data = JSON.parse(document.getElementById("mapData").textContent); } catch (e) {}

    var bounds = null;
    var info = new naver.maps.InfoWindow({ anchorSkew: true, borderWidth: 0 });

    data.forEach(function (s) {
      if (typeof s.lat !== "number" || typeof s.lng !== "number") return;
      var pos = new naver.maps.LatLng(s.lat, s.lng);
      var marker = new naver.maps.Marker({ position: pos, map: map, title: s.name });
      naver.maps.Event.addListener(marker, "click", function () {
        var html =
          '<div style="padding:12px 14px;min-width:180px;max-width:240px;font-family:inherit">' +
          '<div style="font-weight:700;font-size:15px;margin-bottom:4px">' + esc(s.name) + "</div>" +
          '<div style="font-size:12px;color:#0b6e4f;margin-bottom:6px">' + esc(s.category) + "</div>" +
          (s.address ? '<div style="font-size:12px;color:#555;margin-bottom:8px">📍 ' + esc(s.address) + "</div>" : "") +
          '<a href="' + base + "/business/" + encodeURIComponent(s.slug) +
          '" style="font-size:13px;font-weight:700;color:#0b6e4f;text-decoration:none">상세 보기 →</a></div>';
        info.setContent(html);
        info.open(map, marker);
      });
      if (!bounds) bounds = new naver.maps.LatLngBounds(pos, pos);
      else bounds.extend(pos);
    });
    // 마커가 여러 개면 전체가 보이도록 맞춤
    if (bounds && data.length > 1) map.fitBounds(bounds);
  }

  // ----- 좌표 피커 (대시보드) -----
  var pickEl = document.getElementById("pickMap");
  var latInput = document.getElementById("latInput");
  var lngInput = document.getElementById("lngInput");
  if (pickEl && latInput && lngInput) {
    var pc = new naver.maps.LatLng(
      parseFloat(pickEl.getAttribute("data-center-lat")) || 37.4837,
      parseFloat(pickEl.getAttribute("data-center-lng")) || 127.0324
    );
    var pmap = new naver.maps.Map(pickEl, { center: pc, zoom: parseInt(pickEl.getAttribute("data-zoom"), 10) || 16 });
    var hasInitial = latInput.value && lngInput.value;
    var pmarker = new naver.maps.Marker({ position: pc, map: pmap });
    if (!hasInitial) pmarker.setVisible(false);
    naver.maps.Event.addListener(pmap, "click", function (e) {
      pmarker.setPosition(e.coord);
      pmarker.setVisible(true);
      latInput.value = e.coord.lat().toFixed(6);
      lngInput.value = e.coord.lng().toFixed(6);
    });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
})();
