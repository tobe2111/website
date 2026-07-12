// 네이버 지도 — 점포 마커 표시 + (대시보드) 좌표 피커
// 네이버 지도 API가 로드된 경우에만 동작(미로드 시 목록 폴백 유지).
(function () {
  "use strict";
  if (!window.naver || !naver.maps) return;

  // 브랜드색 핀 (스토어프론트 글리프) — var(--brand) 로 테넌트 대표색 자동 적용
  var PIN_SVG = '<svg viewBox="0 0 36 46" width="34" height="43" aria-hidden="true">' +
    '<path d="M18 1.5C9.4 1.5 2.5 8.4 2.5 17c0 10.6 12.2 23.1 14.4 25.3a1.55 1.55 0 0 0 2.2 0C21.3 40.1 33.5 27.6 33.5 17 33.5 8.4 26.6 1.5 18 1.5z" fill="var(--brand,#0b6e4f)" stroke="#fff" stroke-width="2"/><circle cx="18" cy="16.5" r="10" fill="#fff"/>' +
    '<svg x="11" y="9.5" width="14" height="14" viewBox="0 0 24 24"><g fill="var(--brand,#0b6e4f)"><path d="M2.5 9.5 5.2 3h13.6l2.7 6.5z"/><path d="M4.5 11.5h15V20h-15z"/></g><path d="M10.3 14.5h3.4V20h-3.4z" fill="#fff"/></svg></svg>';
  function pinIcon() {
    // anchor: 핀 꼬리 끝(가로 중앙·세로 맨 아래)이 좌표에 정확히 닿도록
    return { content: '<div class="map-pin">' + PIN_SVG + "</div>", anchor: new naver.maps.Point(17, 43) };
  }

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
    var pts = data.filter(function (s) { return typeof s.lat === "number" && typeof s.lng === "number"; });

    var info = new naver.maps.InfoWindow({ anchorSkew: true, borderWidth: 0 });
    function makeMarker(s) {
      var marker = new naver.maps.Marker({ position: new naver.maps.LatLng(s.lat, s.lng), map: map, title: s.name, icon: pinIcon() });
      naver.maps.Event.addListener(marker, "click", function () {
        info.setContent(
          '<div class="map-iw">' +
          '<div class="map-iw-name">' + esc(s.name) + "</div>" +
          '<div class="map-iw-cat">' + esc(s.category) + "</div>" +
          (s.address ? '<div class="map-iw-addr">' + esc(s.address) + "</div>" : "") +
          '<a class="map-iw-link" href="' + base + "/business/" + encodeURIComponent(s.slug) + '">상세 보기 →</a></div>');
        info.open(map, marker);
      });
      return marker;
    }
    // 전체가 보이도록 맞춤
    if (pts.length > 1) {
      var b = new naver.maps.LatLngBounds(new naver.maps.LatLng(pts[0].lat, pts[0].lng), new naver.maps.LatLng(pts[0].lat, pts[0].lng));
      pts.forEach(function (s) { b.extend(new naver.maps.LatLng(s.lat, s.lng)); });
      map.fitBounds(b);
    }

    // 점포가 많으면(>12) 그리드 클러스터링, 아니면 개별 마커. 오류 시 개별 마커로 폴백.
    var CLUSTER = pts.length > 12, cur = [];
    function clearAll() { cur.forEach(function (m) { m.setMap(null); }); cur = []; }
    function plain() { clearAll(); pts.forEach(function (s) { cur.push(makeMarker(s)); }); }
    function clustered() {
      clearAll();
      var proj = map.getProjection(), GRID = 64, cells = {};
      pts.forEach(function (s) {
        var off = proj.fromCoordToOffset(new naver.maps.LatLng(s.lat, s.lng));
        var key = Math.floor(off.x / GRID) + ":" + Math.floor(off.y / GRID);
        (cells[key] = cells[key] || []).push(s);
      });
      Object.keys(cells).forEach(function (k) {
        var g = cells[k];
        if (g.length === 1) { cur.push(makeMarker(g[0])); return; }
        var la = 0, ln = 0; g.forEach(function (s) { la += s.lat; ln += s.lng; });
        var pos = new naver.maps.LatLng(la / g.length, ln / g.length);
        var cm = new naver.maps.Marker({ position: pos, map: map, icon: { content: '<div class="map-cluster">' + g.length + "</div>", anchor: new naver.maps.Point(22, 22) } });
        naver.maps.Event.addListener(cm, "click", function () { map.morph(pos, Math.min((map.getZoom() || 14) + 2, 19)); });
        cur.push(cm);
      });
    }
    function render() { try { if (CLUSTER) clustered(); else plain(); } catch (e) { try { plain(); } catch (_) {} } }
    render();
    if (CLUSTER) naver.maps.Event.addListener(map, "idle", render);
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
    var pmarker = new naver.maps.Marker({ position: pc, map: pmap, icon: pinIcon() });
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
