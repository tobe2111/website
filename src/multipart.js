// 최소 multipart/form-data 파서 (파일 업로드용, 외부 의존성 없음)
// 반환: { fields: {name: value}, files: [{ field, filename, contentType, data(Buffer) }] }

export function parseMultipart(buffer, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!m) throw new Error("multipart boundary 없음");
  const boundary = "--" + (m[1] || m[2]).trim();

  const fields = {};
  const files = [];

  const boundaryBuf = Buffer.from(boundary);
  const parts = splitBuffer(buffer, boundaryBuf);

  for (const part of parts) {
    // 빈 파트 또는 종료 마커(--) 무시
    if (part.length === 0) continue;
    // 각 파트는 CRLF 로 시작하고 헤더\r\n\r\n 본문 구조
    let body = part;
    // 선행 CRLF 제거
    if (body[0] === 0x0d && body[1] === 0x0a) body = body.subarray(2);
    // 종료 경계 "--\r\n"
    if (body.length >= 2 && body[0] === 0x2d && body[1] === 0x2d) continue;

    const headerEnd = indexOf(body, Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) continue;

    const headerText = body.subarray(0, headerEnd).toString("utf8");
    let content = body.subarray(headerEnd + 4);
    // 본문 뒤 트레일링 CRLF 제거
    if (content.length >= 2 && content[content.length - 2] === 0x0d && content[content.length - 1] === 0x0a) {
      content = content.subarray(0, content.length - 2);
    }

    const disp = /content-disposition:[^\n]*/i.exec(headerText);
    if (!disp) continue;
    const nameMatch = /name="([^"]*)"/i.exec(disp[0]);
    const fileMatch = /filename="([^"]*)"/i.exec(disp[0]);
    const ctMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
    const field = nameMatch ? nameMatch[1] : "";

    if (fileMatch && fileMatch[1] !== "") {
      files.push({
        field,
        filename: fileMatch[1],
        contentType: ctMatch ? ctMatch[1].trim() : "application/octet-stream",
        data: content,
      });
    } else if (fileMatch && fileMatch[1] === "") {
      // 파일 미선택 — 무시
      continue;
    } else {
      fields[field] = content.toString("utf8");
    }
  }

  return { fields, files };
}

function splitBuffer(buf, sep) {
  const out = [];
  let start = 0;
  let idx;
  while ((idx = indexOf(buf, sep, start)) !== -1) {
    out.push(buf.subarray(start, idx));
    start = idx + sep.length;
  }
  out.push(buf.subarray(start));
  return out;
}

function indexOf(buf, sep, from = 0) {
  return buf.indexOf(sep, from);
}
