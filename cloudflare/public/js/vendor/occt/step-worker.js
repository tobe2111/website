// STEP 파일을 별도 작업자(Web Worker)에서 읽어 부피(cm³)와 크기(mm)만 돌려준다.
// 왜 작업자인가: occt-import-js 는 안에서 문자열 코드를 실행(new Function)하는데, 견적 화면의 보안 정책은
// 그걸 막는다(막는 게 맞다). 작업자는 화면과 따로 돌아 화면의 보안 정책을 느슨하게 하지 않아도 되고,
// 큰 파일을 읽는 동안 화면이 멈추지도 않는다.
importScripts("occt-import-js.js");
var ready = null;
function measure(pos, idx, acc) {
  var i, k;
  for (i = 0; i < pos.length; i += 3) for (k = 0; k < 3; k++) {
    if (pos[i + k] < acc.mn[k]) acc.mn[k] = pos[i + k];
    if (pos[i + k] > acc.mx[k]) acc.mx[k] = pos[i + k];
  }
  var n = idx ? idx.length : pos.length / 3;
  for (i = 0; i < n; i += 3) {
    var a = (idx ? idx[i] : i) * 3, b = (idx ? idx[i + 1] : i + 1) * 3, c = (idx ? idx[i + 2] : i + 2) * 3;
    acc.v += (pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
      - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
      + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c])) / 6;
  }
}
onmessage = function (ev) {
  ready = ready || occtimportjs({ locateFile: function (p) { return p; } });
  ready.then(function (o) {
    var r = o.ReadStepFile(new Uint8Array(ev.data.buffer), null);
    if (!r || !r.success || !r.meshes.length) return postMessage({ id: ev.data.id, geo: null });
    var acc = { v: 0, mn: [Infinity, Infinity, Infinity], mx: [-Infinity, -Infinity, -Infinity] };
    // 몸체마다 부호가 다를 수 있어(면 방향) 몸체별로 절댓값을 더한다
    r.meshes.forEach(function (m) {
      var one = { v: 0, mn: acc.mn, mx: acc.mx };
      measure(m.attributes.position.array, m.index && m.index.array, one);
      acc.v += Math.abs(one.v);
    });
    postMessage({ id: ev.data.id, geo: acc.v > 0 ? {
      volume: Math.round(acc.v / 10) / 100,
      size: acc.mx.map(function (x, k) { return Math.round((x - acc.mn[k]) * 10) / 10; }),
    } : null });
  }).catch(function (e) { postMessage({ id: ev.data.id, geo: null, error: String(e && e.message || e) }); });
};
