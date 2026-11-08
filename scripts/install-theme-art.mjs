#!/usr/bin/env node
/**
 * 可选主题素材安装器
 *
 * 把「你自己已合法取得使用权」的插画复制到 public/miku/ 下。
 * 本脚本不联网、不内置任何素材地址，也不附带任何第三方素材。
 * 版权与授权说明见 public/miku/README.md 与根目录 NOTICE。
 *
 * 用法：
 *   node scripts/install-theme-art.mjs --source /path/to/your/art
 *   node scripts/install-theme-art.mjs --check
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEST = path.join(ROOT, "public", "miku");
const ALLOWED = new Set([".webp", ".png", ".jpg", ".jpeg"]);

const TARGETS = [
  { rel: path.join("art", "miku-login.webp"), nested: true, optional: false },
  { rel: path.join("art", "miku-empty.webp"), nested: true, optional: false },
  { rel: path.join("art", "miku-corner.webp"), nested: true, optional: false },
  { rel: "miku-avatar.jpg", nested: false, optional: false },
  { rel: path.join("art", "miku-avatar.webp"), nested: true, optional: true },
];

const argv = process.argv.slice(2);
const checkOnly = argv.includes("--check");
const sourceIndex = argv.indexOf("--source");
const source =
  sourceIndex >= 0 && argv[sourceIndex + 1] && !argv[sourceIndex + 1].startsWith("--")
    ? argv[sourceIndex + 1]
    : null;

function resolveSource(name, nested) {
  if (!source) return null;
  const candidates = nested
    ? [path.join(source, "art", name), path.join(source, name)]
    : [path.join(source, name), path.join(source, "art", name)];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function missing() {
  return TARGETS.filter((t) => !fs.existsSync(path.join(DEST, t.rel)));
}

if (checkOnly) {
  const rest = missing();
  if (rest.length === 0) {
    console.log("主题素材齐全：public/miku/ 下所有必需文件都已就位。");
  } else {
    console.log("当前缺少以下主题素材（应用会显示中性占位，功能不受影响）：");
    for (const t of rest) {
      console.log(`  ${t.optional ? "[可选] " : "[必需] "}public/miku/${t.rel.split(path.sep).join("/")}`);
    }
  }
  process.exit(0);
}

if (!source) {
  console.error("请先用 --source 指定你自己准备的素材目录。");
  console.error("例：npm run theme-art -- --source /path/to/your/art");
  console.error("本仓库不提供任何素材下载地址；版权说明见 public/miku/README.md。");
  process.exit(1);
}
if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
  console.error(`源目录不存在或不是目录：${source}`);
  process.exit(1);
}

let copied = 0;
for (const target of TARGETS) {
  const name = path.basename(target.rel);
  const from = resolveSource(name, target.nested);
  if (!from) {
    if (!target.optional) console.log(`跳过（源目录里没有）：${name}`);
    continue;
  }
  if (!ALLOWED.has(path.extname(name).toLowerCase())) {
    console.log(`跳过（扩展名不受支持）：${name}`);
    continue;
  }
  const to = path.join(DEST, target.rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`已安装：public/miku/${target.rel.split(path.sep).join("/")}`);
  copied += 1;
}

console.log("");
console.log(`完成，共安装 ${copied} 个文件。`);
console.log("提醒：请自行确认你对这些素材拥有符合其授权条款（含非商业限制）的使用权。");
console.log("这些文件已被 .gitignore 忽略，不会进入版本库。");

const rest = missing();
if (rest.some((t) => !t.optional)) {
  console.log("仍有必需素材缺失，界面会显示中性占位，不影响任何功能。");
  process.exit(0);
}
