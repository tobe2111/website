// 미디어 처리 파이프라인 (ffmpeg 자동 감지).
// ffmpeg 가 있으면 영상을 웹 표준 H.264 mp4 로 정규화하고 포스터(썸네일) 프레임을 추출합니다.
// 없으면 원본을 그대로 통과시킵니다 → 실제 서버에 ffmpeg 설치 시 코드 변경 없이 이상적으로 동작.
import { spawn, spawnSync } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";
import { extForType } from "./storage.js";

function detect(bin) {
  try { return spawnSync(bin, ["-version"], { stdio: "ignore" }).status === 0; }
  catch { return false; }
}
export const hasFfmpeg = detect("ffmpeg");

function tmp(ext) {
  return path.join(os.tmpdir(), "scm_" + crypto.randomBytes(8).toString("hex") + ext);
}
function run(bin, args) {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "ignore"] });
    p.on("error", () => resolve(1));
    p.on("close", (code) => resolve(code ?? 1));
  });
}

// 영상 처리 → { buffer, contentType, poster(Buffer|null) }
export async function processVideo(buffer, contentType) {
  if (!hasFfmpeg) return { buffer, contentType, poster: null };

  const inPath = tmp(extForType(contentType) || ".bin");
  await fsp.writeFile(inPath, buffer);
  let outBuffer = buffer, outType = contentType, poster = null;
  try {
    if (config.mediaTranscode) {
      const outPath = tmp(".mp4");
      const code = await run("ffmpeg", [
        "-i", inPath,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart", "-y", outPath,
      ]);
      if (code === 0) {
        try { outBuffer = await fsp.readFile(outPath); outType = "video/mp4"; } catch {}
      }
      await fsp.rm(outPath, { force: true }).catch(() => {});
    }
    if (config.mediaPoster) {
      const posterPath = tmp(".jpg");
      // 1초 지점 프레임 1장, 세로/가로 비율 유지하며 최대 1080px
      const code = await run("ffmpeg", [
        "-ss", "00:00:01", "-i", inPath,
        "-frames:v", "1", "-vf", "scale='min(1080,iw)':-2", "-q:v", "3", "-y", posterPath,
      ]);
      if (code === 0) {
        try { poster = await fsp.readFile(posterPath); } catch {}
      }
      await fsp.rm(posterPath, { force: true }).catch(() => {});
    }
  } finally {
    await fsp.rm(inPath, { force: true }).catch(() => {});
  }
  return { buffer: outBuffer, contentType: outType, poster };
}

// 이미지 썸네일 생성 → { thumb: Buffer|null, thumbType }
// ffmpeg 로 긴 변을 최대 600px 로 축소. 없으면 null(원본 사용). 애니메이션 GIF 는 원본 유지.
export async function processImage(buffer, contentType) {
  if (!hasFfmpeg || contentType === "image/gif") return { thumb: null, thumbType: "" };
  const isPng = contentType === "image/png"; // 투명도 보존 위해 PNG 는 PNG 로 출력
  const inPath = tmp(extForType(contentType) || ".img");
  const outPath = tmp(isPng ? ".png" : ".jpg");
  await fsp.writeFile(inPath, buffer);
  let thumb = null, thumbType = "";
  try {
    const scale = "scale='min(600,iw)':-2";
    const args = isPng
      ? ["-i", inPath, "-vf", scale, "-y", outPath]
      : ["-i", inPath, "-vf", scale, "-q:v", "4", "-y", outPath];
    const code = await run("ffmpeg", args);
    if (code === 0) {
      try {
        const out = await fsp.readFile(outPath);
        // 축소본이 원본보다 실제로 작을 때만 채택(작은 이미지는 원본 사용)
        if (out.length > 0 && out.length < buffer.length) {
          thumb = out; thumbType = isPng ? "image/png" : "image/jpeg";
        }
      } catch {}
    }
  } finally {
    await fsp.rm(inPath, { force: true }).catch(() => {});
    await fsp.rm(outPath, { force: true }).catch(() => {});
  }
  return { thumb, thumbType };
}

export function info() {
  if (!hasFfmpeg) return "ffmpeg 없음(원본 통과, 썸네일 미생성)";
  return `ffmpeg 있음(transcode=${config.mediaTranscode}, poster=${config.mediaPoster}, 이미지 썸네일 자동)`;
}
