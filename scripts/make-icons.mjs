import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public", "icons");
const APP = path.join(ROOT, "src", "app");

/**
 * 主屏图标源图：用户 2026-11-08 指定用这张初音头像（就是应用内头像用的同一张）。
 * 选的是「满版」方案 —— 照片铺满整个方形，圆角交给系统去裁（iOS/Android 都会自己裁）。
 * 不预先抠圆角：iOS 会再裁一次，预裁过会出现双重圆角。
 */
const PHOTO = path.join(ROOT, "public", "miku", "miku-avatar.jpg");

const NIGHT = "#1e1e2e";
const MIKU = "#39c5bb";
const BLUE = "#60a5fa";

/**
 * 矢量标记：只用来生成 favicon（浏览器标签页 16px）和 icons/mark.svg。
 * 16px 下照片会糊成一团灰，剪影反而认得出来，所以 favicon 保留矢量。
 */
function mark({ scale = 1 } = {}) {
  return `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${MIKU}"/>
      <stop offset="1" stop-color="${BLUE}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="${NIGHT}"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <circle cx="256" cy="256" r="150" fill="url(#g)"/>
    <g transform="translate(256 256) scale(11.4) translate(-12 -12)" fill="#ffffff">
      <circle cx="12" cy="8.4" r="4.3"/>
      <path d="M8.3 7.6c-2.7.8-4.5 3-5 6-.4 2.5.1 4.8 1.1 6.8.3.6 1.1.5 1.3-.1.7-2.4 2-4.2 3.7-5.4l1.5-1-1.3-2.2c-.5-.9-1.1-1.6-1.8-1.9z"/>
      <path d="M15.7 7.6c2.7.8 4.5 3 5 6 .4 2.5-.1 4.8-1.1 6.8-.3.6-1.1.5-1.3-.1-.7-2.4-2-4.2-3.7-5.4l-1.5-1 1.3-2.2c.5-.9 1.1-1.6 1.8-1.9z"/>
      <circle cx="7.6" cy="9.9" r="1.3"/>
      <circle cx="16.4" cy="9.9" r="1.3"/>
    </g>
  </g>
</svg>`;
}

async function renderSvg(svg, size, file) {
  await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(file);
  console.log(`  ✓ ${path.relative(ROOT, file)}  ${size}×${size}（矢量）`);
}

/**
 * 照片图标：默认 cover + center。
 * 源图 1438×1422 接近正方形，居中裁只会切掉上下各 8px，人脸和比心手势都在安全区。
 */
async function renderPhoto(size, file) {
  await sharp(PHOTO)
    .resize(size, size, { fit: "cover", position: "centre" })
    .flatten({ background: NIGHT }) // 去掉可能的 alpha，苹果不接受透明底
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(file);
  console.log(`  ✓ ${path.relative(ROOT, file)}  ${size}×${size}（照片）`);
}

/**
 * maskable 专用：Android 会把图标裁成圆形/水滴形，安全区只有中间直径约 80% 的圆。
 * 满版原图直接当 maskable 会被裁掉两侧手臂，所以缩到 80% 再垫一层深空底。
 */
async function renderMaskable(size, file) {
  const inner = Math.round(size * 0.8);
  const photo = await sharp(PHOTO)
    .resize(inner, inner, { fit: "cover", position: "centre" })
    .flatten({ background: NIGHT })
    .png()
    .toBuffer();

  await sharp({ create: { width: size, height: size, channels: 3, background: NIGHT } })
    .composite([{ input: photo, gravity: "center" }])
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(file);
  console.log(`  ✓ ${path.relative(ROOT, file)}  ${size}×${size}（照片，缩到 80% 安全区）`);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  console.log("生成 PWA / 主屏图标（初音头像，满版）…");
  await renderPhoto(192, path.join(OUT, "icon-192.png"));
  await renderPhoto(512, path.join(OUT, "icon-512.png"));
  // maskable：Android 会裁成圆形，内容安全区是中间直径 80% 的圆。
  await renderMaskable(512, path.join(OUT, "maskable-512.png"));
  // iOS 加到主屏时就是抓这个文件，然后自己裁圆角
  await renderPhoto(180, path.join(OUT, "apple-touch-icon.png"));

  console.log("生成 favicon（矢量剪影，16px 下才认得出来）…");
  // App Router 会自动把 app/icon.png 当作 favicon
  await renderSvg(mark(), 64, path.join(APP, "icon.png"));

  await writeFile(path.join(OUT, "mark.svg"), mark(), "utf8");
  console.log("  ✓ public/icons/mark.svg（矢量原件，备用）");
  console.log("完成。");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
