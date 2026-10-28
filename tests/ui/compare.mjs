// 화면 자동 점검(CR-019) · 스크린샷 비교 (--compare <예전 결과 폴더>).
// 같은 이름의 사진을 화소로 비교해 "바뀐 사진 목록 + 바뀐 화소 비율"을 낸다. 통과 기준 숫자는 정하지 않는다 (사람이 본다).
// 시계처럼 매번 바뀌는 칸은 찍을 때 shots.json에 적어 둔 상자(mask)를 빼고 비교한다.
// PNG 읽기는 Node 기본 zlib만 쓴다 (디자인실 icons/lib/png.mjs와 같은 방식, npm 패키지 없음).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function pngSize(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('PNG 파일이 아님');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** PNG(8비트, 겹침 없음, 색 형식 2·6) → { width, height, data: RGBA } */
export function decodePng(buf) {
  const { width, height } = pngSize(buf);
  const bitDepth = buf[24], colorType = buf[25], interlace = buf[28];
  if (bitDepth !== 8 || interlace || ![2, 6].includes(colorType)) throw new Error(`읽을 수 없는 PNG 형식 (비트 ${bitDepth}, 색 ${colorType}, 겹침 ${interlace})`);
  const idat = [];
  for (let pos = 8; pos < buf.length;) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8);
    if (type === 'IDAT') idat.push(buf.subarray(pos + 8, pos + 8 + len));
    if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), ch = colorType === 6 ? 4 : 3, stride = width * ch;
  const px = new Uint8Array(height * stride);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), out = px.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[x] = v & 0xff;
    }
    prev = out;
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = px[i * ch]; data[i * 4 + 1] = px[i * ch + 1]; data[i * 4 + 2] = px[i * ch + 2]; data[i * 4 + 3] = ch === 4 ? px[i * ch + 3] : 255;
  }
  return { width, height, data };
}

/** 두 사진 비교: 바뀐 화소 수(색 차이 합 > 24), 바뀐 곳 상자. masks = [[x,y,w,h], …] (CSS 픽셀 × 배율) */
export function diffImages(a, b, masks = []) {
  if (a.width !== b.width || a.height !== b.height) return { sizeChanged: true, ratio: 1 };
  const W = a.width, H = a.height, skip = new Uint8Array(W * H);
  for (const [mx, my, mw, mh] of masks) for (let y = Math.max(0, my | 0); y < Math.min(H, (my + mh) | 0); y++) skip.fill(1, y * W + Math.max(0, mx | 0), y * W + Math.min(W, (mx + mw) | 0));
  let n = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let i = 0; i < W * H; i++) {
    if (skip[i]) continue;
    const o = i * 4, d = Math.abs(a.data[o] - b.data[o]) + Math.abs(a.data[o + 1] - b.data[o + 1]) + Math.abs(a.data[o + 2] - b.data[o + 2]);
    if (d > 24) { n++; const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return { changed: n, ratio: n / (W * H), bbox: n ? [x0, y0, x1, y1] : null };
}

/** 예전 결과 폴더(prevOut 또는 그 안의 shots/)와 지금 shots 폴더 비교 */
export function compareShots(prevOut, curShots) {
  const prevShots = fs.existsSync(path.join(prevOut, 'shots')) ? path.join(prevOut, 'shots') : prevOut;
  const masksOf = dir => { try { return Object.fromEntries(JSON.parse(fs.readFileSync(path.join(dir, 'shots.json'), 'utf8')).map(s => [s.file, s.masks || []])); } catch { return {}; } };
  const pm = masksOf(prevShots), cm = masksOf(curShots);
  const list = dir => fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.endsWith('.png')).sort() : [];
  const prev = new Set(list(prevShots)), cur = list(curShots);
  const out = { prev: prevShots, changed: [], same: 0, added: [], removed: [...prev].filter(n => !cur.includes(n)) };
  for (const n of cur) {
    if (!prev.has(n)) { out.added.push(n); continue; }
    try {
      const a = decodePng(fs.readFileSync(path.join(prevShots, n))), b = decodePng(fs.readFileSync(path.join(curShots, n)));
      const d = diffImages(a, b, [...(pm[n] || []), ...(cm[n] || [])]);
      if (d.sizeChanged) out.changed.push({ file: n, ratio: '크기 다름', note: `${a.width}×${a.height} → ${b.width}×${b.height}` });
      else if (d.changed) out.changed.push({ file: n, ratio: (d.ratio * 100).toFixed(2) + '%', bbox: d.bbox.join(',') });
      else out.same++;
    } catch (e) { out.changed.push({ file: n, ratio: '비교 못 함', note: e.message }); }
  }
  fs.writeFileSync(path.join(path.dirname(curShots), 'compare.json'), JSON.stringify(out, null, 1));
  return out;
}
