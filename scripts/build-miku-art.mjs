/**
 * 黑底素材 → 带 alpha 的 WebP
 *
 * 四张素材都是「纯黑背景、无 alpha」的画。直接 mix-blend-mode:screen 在扁平
 * 深色底上能用，但一旦放进玻璃卡片（背景更亮、还有 backdrop blur）就会露出
 * 黑色矩形。所以改成**离线抠图**：从画布四边做 flood fill，把「连通到边缘的
 * 黑色」判为背景并置为透明；角色身上的黑格纹被亮色包围，不会被误删。
 * 出来的 PNG/WebP 自带 alpha，放在任何背景上都干净，不再需要混合模式。
 *
 * 用法（在 info-keeper 目录下，依赖 devDependencies 里的 sharp）：
 *   node scripts/build-miku-art.mjs
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SRC = "public/miku";
const OUT = "public/miku/art";

/** 输出宽度按实际显示尺寸的 ~3 倍留余量 */
const JOBS = [
  { from: "miku-login.png", to: "miku-login.webp", width: 768 },
  { from: "miku-empty.png", to: "miku-empty.webp", width: 640 },
  { from: "miku-corner.png", to: "miku-corner.webp", width: 384 },
];

/**
 * 判定为「背景黑」的亮度阈值（0-255）。
 * 实测：背景是纯黑（多数像素 0~2，最坏 5），而角色身上最深的黑 ——
 * 比如她右侧发饰的羽毛（30~36）、裙子的黑格纹（0~3，但被亮色包围）——
 * 明显更亮或不通向边缘。阈值必须取在两者之间且贴近背景：
 * 取 34 会把羽毛一起判成背景并顺着边缘连通把整个发饰挖掉，取 14 才安全。
 */
const BLACK = 14;
/** 被角色围住的纯黑空腔：更严格的判定，避免误伤深色羽毛 */
const HOLE_MEAN = 8;
const HOLE_PURE = 0.75;

await mkdir(OUT, { recursive: true });

for (const job of JOBS) {
  const input = path.join(SRC, job.from);
  const meta = await sharp(input).metadata();
  const width = Math.min(job.width, meta.width ?? job.width);
  const height = Math.round((width * (meta.height ?? width)) / (meta.width ?? width));

  const { data, info } = await sharp(input)
    .resize(width, height, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const px = w * h;

  // 1) 亮度表 + 「像是背景黑」的种子
  const lum = new Uint8Array(px);
  for (let i = 0; i < px; i += 1) {
    const s = i * 3;
    const r = data[s];
    const g = data[s + 1];
    const b = data[s + 2];
    lum[i] = Math.max(r, g, b);
  }

  // 2) 全图按「黑」做连通域标记（8 邻域）
  const label = new Int32Array(px).fill(-1);
  const stack = new Int32Array(px);
  const comps = [];

  for (let i = 0; i < px; i += 1) {
    if (label[i] !== -1 || lum[i] > BLACK) continue;
    const id = comps.length;
    let size = 0;
    let sumLum = 0;
    let pure = 0;
    let touchesEdge = false;
    let sp = 0;
    label[i] = id;
    stack[sp++] = i;

    while (sp > 0) {
      const j = stack[--sp];
      const x = j % w;
      const y = (j - x) / w;
      size += 1;
      sumLum += lum[j];
      if (lum[j] <= 6) pure += 1;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true;

      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const k = yy * w + xx;
          if (label[k] === -1 && lum[k] <= BLACK) {
            label[k] = id;
            stack[sp++] = k;
          }
        }
      }
    }

    comps.push({ id, size, sumLum, pure, touchesEdge });
  }

  // 3) 判定背景：
  //    a) 连通到画布边缘的黑 —— 一定是背景；
  //    b) 被角色围住的「纯黑空腔」—— 比如她右侧双马尾与脸之间那块，
  //       因为闭合而不与边缘连通，但同样是背景。用「平均亮度极低 +
  //       几乎全是纯黑 + 有一定面积」识别，角色的黑格纹/黑褶皱平均
  //       亮度在 20 左右，不会误判。
  const minHole = Math.max(64, Math.round(px * 0.0008));
  const bgById = new Uint8Array(comps.length);
  for (const c of comps) {
    const mean = c.sumLum / c.size;
    const pureRatio = c.pure / c.size;
    const isHole = c.size >= minHole && mean < HOLE_MEAN && pureRatio > HOLE_PURE;
    if (c.touchesEdge || isHole) bgById[c.id] = 1;
  }

  const bg = new Uint8Array(px);
  for (let i = 0; i < px; i += 1) {
    const id = label[i];
    if (id !== -1 && bgById[id]) bg[i] = 1;
  }

  // 4) alpha：背景 0，其余 255；再对 alpha 做一次 3x3 均值平滑，抗锯齿
  const alpha = new Uint8Array(px);
  for (let i = 0; i < px; i += 1) alpha[i] = bg[i] ? 0 : 255;

  const smooth = new Uint8Array(px);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += alpha[yy * w + xx];
          n += 1;
        }
      }
      smooth[y * w + x] = Math.round(sum / n);
    }
  }

  // 5) 边缘像素解预乘：半透明像素的 RGB 原本是「角色色 × alpha」混着黑底
  //    算出来的（因为原图背景是纯黑），直接输出会在亮底上留一圈灰黑描边。
  //    按 C = F·(a/255) 反推 F = C·255/a，把颜色还原回去。
  const rgba = Buffer.alloc(px * 4);
  for (let i = 0; i < px; i += 1) {
    const s = i * 3;
    const a = smooth[i];
    const k = a === 0 ? 0 : 255 / a;
    rgba[i * 4] = Math.min(255, Math.round(data[s] * k));
    rgba[i * 4 + 1] = Math.min(255, Math.round(data[s + 1] * k));
    rgba[i * 4 + 2] = Math.min(255, Math.round(data[s + 2] * k));
    rgba[i * 4 + 3] = a;
  }

  const out = path.join(OUT, job.to);
  const result = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .webp({ quality: 88, alphaQuality: 95, effort: 5 })
    .toFile(out);

  console.log(
    `${job.to}  ${result.width}x${result.height}  ${(result.size / 1024).toFixed(0)} KB`,
  );
}
