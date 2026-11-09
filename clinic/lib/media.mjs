// 사진 자동 압축 — 병원이 보낸 원본(JPG·PNG)을 휴대폰·태블릿·PC 크기의 WebP 로 줄인다.
//
// 휴대폰으로 들어온 사람이 2560px 원본을 받으면 첫 화면이 몇 초씩 비어 있다. 같은 사진을
// 여러 폭으로 만들어 두면 브라우저가 화면에 맞는 것 하나만 받는다.
//
// 변환은 ffmpeg 로 한다. npm 패키지를 하나도 들이지 않으려는 것이다(저장소 원칙: 외부 의존성 0).
// ffmpeg 가 없는 컴퓨터에서는 원본을 그대로 쓰고 경고만 남긴다 — 빌드는 멈추지 않는다.
// 이미 만든 파일은 원본보다 새것이면 다시 만들지 않는다(사진이 많아도 두 번째 빌드부터 빠르다).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from "node:fs";
import path from "node:path";

export const WIDTHS = [640, 1280, 1920, 2560];
const RASTER = /\.(jpe?g|png)$/i;

let _ff = null;
export function hasFfmpeg() {
  if (_ff === null) {
    try { execFileSync("ffmpeg", ["-hide_banner", "-version"], { stdio: "ignore" }); execFileSync("ffprobe", ["-version"], { stdio: "ignore" }); _ff = true; }
    catch { _ff = false; }
  }
  return _ff;
}

function dims(file) {
  const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file], { encoding: "utf8" });
  const [w, h] = out.trim().split("x").map(Number);
  return { w, h };
}

const fresh = (out, src) => existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs;

// srcDir 의 사진을 outDir 로 옮기며 변환한다. 돌려주는 값: "/media/a.jpg" → { w, h, webp: [[640, "/media/a-640.webp"], …] }
export function optimizeMedia(srcDir, outDir, { cacheDir, log = () => {} } = {}) {
  const map = new Map();
  if (!existsSync(srcDir)) return map;
  mkdirSync(outDir, { recursive: true });
  // 빌드 결과 폴더는 매번 지우고 새로 만든다. 변환본은 따로 두어야 두 번째 빌드부터 다시 만들지 않는다.
  const cache = cacheDir || outDir;
  mkdirSync(cache, { recursive: true });
  const ff = hasFfmpeg();
  if (!ff && readdirSync(srcDir).some((f) => RASTER.test(f))) log("! ffmpeg 가 없어 사진을 압축하지 않고 원본을 씁니다.");
  for (const f of readdirSync(srcDir)) {
    const src = path.join(srcDir, f);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, path.join(outDir, f));
    if (!ff || !RASTER.test(f)) continue;
    const { w, h } = dims(src);
    const base = f.replace(RASTER, "");
    const webp = [];
    // 원본보다 큰 폭은 만들지 않는다. 원본이 가장 작은 폭보다 작으면 원본 폭 하나만 만든다.
    const widths = WIDTHS.filter((x) => x <= w);
    if (!widths.length) widths.push(w);
    for (const W of widths) {
      const name = `${base}-${W}.webp`;
      const cached = path.join(cache, name);
      if (!fresh(cached, src)) execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-vf", `scale=${W}:-2:flags=lanczos`, "-c:v", "libwebp", "-quality", "78", "-compression_level", "6", cached]);
      if (cached !== path.join(outDir, name)) copyFileSync(cached, path.join(outDir, name));
      webp.push([W, `/media/${name}`]);
    }
    map.set(`/media/${f}`, { w, h, webp });
  }
  return map;
}
