// 네이버 지도 — 점포 마커 표시 + (대시보드) 좌표 피커
// 네이버 지도 API가 로드된 경우에만 동작(미로드 시 목록 폴백 유지).
(function () {
  "use strict";
  if (!window.naver || !naver.maps) return;

  // 브랜드색 핀 (스토어프론트 글리프) — var(--brand) 로 테넌트 대표색 자동 적용
  var PIN_SVG = '<svg viewBox="0 0 36 46" width="34" height="43" aria-hidden="true">' +
    '<path d="M18 1.5C9.4 1.5 2.5 8.4 2.5 17c0 10.6 12.2 23.1 14.4 25.3a1.55 1.55 0 0 0 2.2 0C21.3 40.1 33.5 27.6 33.5 17 33.5 8.4 26.6 1.5 18 1.5z" fill="var(--brand,#0b6e4f)" stroke="#fff" stroke-width="2"/><circle cx="18" cy="16.5" r="10" fill="#fff"/>' +
    '<svg x="11" y="9.5" width="14" height="14" viewBox="0 0 24 24"><g fill="var(--brand,#0b6e4f)"><path d="M2.5 9.5 5.2 3h13.6l2.7 6.5z"/><path d="M4.5 11.5h15V20h-15z"/></g><path d="M10.3 14.5h3.4V20h-3.4z" fill="#fff"/></svg></svg>';
  function pinIcon(active) {
    // anchor: 핀 꼬리 끝(가로 중앙·세로 맨 아래)이 좌표에 정확히 닿도록
    return { content: '<div class="map-pin' + (active ? " is-active" : "") + '">' + PIN_SVG + "</div>", anchor: new naver.maps.Point(17, 43) };
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

    // 팝업: 배경을 투명하게 두고 .map-iw 가 둥근 흰 카드를 그린다 (모서리 각짐 방지)
    var info = new naver.maps.InfoWindow({ anchorSkew: true, borderWidth: 0, backgroundColor: "transparent", disableAnchor: false, pixelOffset: new naver.maps.Point(0, -4) });
    var activeMarker = null;
    function deactivate() {
      if (activeMarker) { try { activeMarker.setIcon(pinIcon(false)); } catch (e) {} activeMarker = null; }
      info.close();
    }
    function makeMarker(s) {
      var marker = new naver.maps.Marker({ position: new naver.maps.LatLng(s.lat, s.lng), map: map, title: s.name, icon: pinIcon(false) });
      naver.maps.Event.addListener(marker, "click", function () {
        if (activeMarker === marker) { deactivate(); return; } // 같은 핀 다시 누르면 닫기
        deactivate();
        marker.setIcon(pinIcon(true));
        marker.setZIndex(1000); // 선택 핀을 항상 맨 위로
        activeMarker = marker;
        info.setContent(
          '<div class="map-iw">' +
          '<div class="map-iw-name">' + esc(s.name) + "</div>" +
          '<div class="map-iw-cat">' + esc(s.category) + "</div>" +
          (s.address ? '<div class="map-iw-addr">' + esc(s.address) + "</div>" : "") +
          (s.phone ? '<a class="map-iw-tel" href="tel:' + esc(s.phone) + '">📞 ' + esc(s.phone) + "</a>" : "") +
          '<a class="map-iw-link" href="' + base + "/business/" + encodeURIComponent(s.slug) + '">상세 보기 →</a></div>');
        info.open(map, marker);
      });
      return marker;
    }
    // 빈 지도 클릭 → 팝업 닫기 + 선택 해제
    naver.maps.Event.addListener(map, "click", deactivate);
    // 전체가 보이도록 맞춤
    if (pts.length > 1) {
      var b = new naver.maps.LatLngBounds(new naver.maps.LatLng(pts[0].lat, pts[0].lng), new naver.maps.LatLng(pts[0].lat, pts[0].lng));
      pts.forEach(function (s) { b.extend(new naver.maps.LatLng(s.lat, s.lng)); });
      map.fitBounds(b);
    }

    // 점포가 많으면(>12) 그리드 클러스터링, 아니면 개별 마커. 오류 시 개별 마커로 폴백.
    var CLUSTER = pts.length > 12, cur = [];
    function clearAll() { deactivate(); cur.forEach(function (m) { m.setMap(null); }); cur = []; }
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

    // 아래 점포 목록 클릭 → 해당 핀으로 부드럽게 이동
    document.querySelectorAll(".map-store[data-lat]").forEach(function (li) {
      li.addEventListener("click", function (ev) {
        if (ev.target.closest("a")) return; // 링크는 원래 동작 유지
        var lat = parseFloat(li.getAttribute("data-lat")), lng = parseFloat(li.getAttribute("data-lng"));
        if (isNaN(lat) || isNaN(lng)) return;
        map.morph(new naver.maps.LatLng(lat, lng), Math.max(map.getZoom() || 14, 16));
        mapEl.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  }

  // ----- 가게 상세: 오시는 길 미니 지도 -----
  var bizEl = document.getElementById("bizMap");
  if (bizEl) {
    var blat = parseFloat(bizEl.getAttribute("data-lat")), blng = parseFloat(bizEl.getAttribute("data-lng"));
    if (!isNaN(blat) && !isNaN(blng)) {
      var bpos = new naver.maps.LatLng(blat, blng);
      var bmap = new naver.maps.Map(bizEl, { center: bpos, zoom: 16, scrollWheel: false }); // 스크롤 하이재킹 방지
      new naver.maps.Marker({ position: bpos, map: bmap, title: bizEl.getAttribute("data-name") || "", icon: pinIcon(false) });
    }
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

    // 주소 → 좌표 (geocoder 서브모듈 — 콘솔에서 Geocoding 서비스 활성화 필요)
    var geoBtn = document.getElementById("geoBtn"), geoQ = document.getElementById("geoQuery"), geoMsg = document.getElementById("geoMsg");
    function geoSay(m) { if (geoMsg) { geoMsg.textContent = m; geoMsg.hidden = !m; } }
    function setPicked(lat, lng) {
      var pos = new naver.maps.LatLng(lat, lng);
      pmap.morph(pos, Math.max(pmap.getZoom() || 16, 16));
      pmarker.setPosition(pos);
      pmarker.setVisible(true);
      latInput.value = lat.toFixed(6);
      lngInput.value = lng.toFixed(6);
    }
    function geocode() {
      var q = (geoQ.value || "").trim();
      if (!q) { geoSay("주소를 입력해 주세요."); geoQ.focus(); return; }
      if (!(naver.maps.Service && naver.maps.Service.geocode)) {
        geoSay("주소 검색을 켜려면 네이버 클라우드 콘솔의 Maps 앱에서 Geocoding 을 활성화해 주세요. 지금은 지도를 직접 클릭해 위치를 지정할 수 있습니다.");
        return;
      }
      geoSay("주소를 찾는 중…");
      naver.maps.Service.geocode({ query: q }, function (status, res) {
        var item = status === naver.maps.Service.Status.OK && res && res.v2 && res.v2.addresses && res.v2.addresses[0];
        if (!item) { geoSay("주소를 찾지 못했어요. 도로명 주소로 다시 입력하거나 지도를 직접 클릭해 주세요."); return; }
        setPicked(parseFloat(item.y), parseFloat(item.x));
        geoSay("");
      });
    }
    if (geoBtn && geoQ) {
      geoBtn.addEventListener("click", geocode);
      // Enter 로 검색해도 업체 정보 폼이 통째로 제출되지 않게
      geoQ.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); geocode(); } });
    }
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
})();
