/**
 * UI 截图工具（CDP，无头 Edge）
 *
 * 用法：
 *   node scripts/ui-shot.mjs login
 *   node scripts/ui-shot.mjs app <email> <password>
 *   node scripts/ui-shot.mjs login --port=9444
 *
 * 前置：先起一个开了调试端口的无头 Edge，并等 7 秒：
 *   "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
 *     --headless=new --disable-gpu --hide-scrollbars \
 *     --remote-debugging-port=9333 \
 *     --user-data-dir="C:/Users/<你>/AppData/Local/Temp/mikucdp" \
 *     --window-size=1440,1000 about:blank &
 *
 * 为什么不用 --headless 的 --screenshot：
 *   --window-size=390,844 在 headless 下实际视口是 504px，移动端截图会误判溢出。
 *   必须走 Emulation.setDeviceMetricsOverride 才能拿到真实视口。
 *
 * 为什么必须等水合：
 *   dev 模式下 headless Edge 里 React 完全不水合（HMR WebSocket 握手失败），
 *   所以要点按钮 / 切 tab / 看登录态的截图，必须对着 next build + next start 的
 *   生产服务，或者直接打你自己的部署地址。
 */
import WebSocket from "ws";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const flags = Object.fromEntries(
  argv.filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);

const MODE = positional[0] ?? "login";
const EMAIL = positional[1];
const PASS = positional[2];

const PORT = Number(flags.port ?? 9333);
const BASE = flags.base ?? process.env.SITE_URL ?? "http://localhost:3000";
const OUT = flags.out ?? path.join(os.tmpdir(), "mikushot", "ui");

fs.mkdirSync(OUT, { recursive: true });

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("没有可用的 page target，Edge 起来了吗？");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();

  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  });
  await new Promise((r) => ws.on("open", r));

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  // ⚠ Runtime.evaluate 的 result 必须用 returnByValue，且表达式里要 return 一个
  //   JSON.stringify 过的字符串 —— 直接返回对象会拿到 undefined。
  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", {
      expression: `(function(){ ${expr} })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  const shot = async (name) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    const file = path.join(OUT, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    console.log("  ✓", file);
  };

  return { ws, send, evalJs, shot };
}

/** 页面里量一遍所有初音图的几何，用来判断「大小 / 位置 / 留白」是否合理 */
const PROBE_MIKU = `
  const out = [];
  for (const scene of document.querySelectorAll(".miku-scene")) {
    const r = scene.getBoundingClientRect();
    const img = scene.querySelector("img");
    const ir = img.getBoundingClientRect();
    const cs = getComputedStyle(img);
    out.push({
      kind: "art",
      cls: scene.className,
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      img: { w: Math.round(ir.width), h: Math.round(ir.height) },
      objectFit: cs.objectFit,
      objectPosition: cs.objectPosition,
      mask: cs.maskImage !== "none" || cs.webkitMaskImage !== "none",
      natural: img.naturalWidth + "x" + img.naturalHeight,
      src: img.currentSrc.split("?")[0],
    });
  }
  for (const img of document.querySelectorAll('img[alt="管家"]')) {
    const r = img.getBoundingClientRect();
    const cs = getComputedStyle(img);
    out.push({
      kind: "avatar",
      cls: img.className,
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      objectFit: cs.objectFit,
      objectPosition: cs.objectPosition,
      natural: img.naturalWidth + "x" + img.naturalHeight,
      src: img.currentSrc.split("?")[0],
    });
  }
  return JSON.stringify({ vw: innerWidth, vh: innerHeight, scrollW: document.documentElement.scrollWidth, nodes: out }, null, 1);
`;

/** 页面里所有输入框的字号 —— 移动端必须 ≥16px，否则 iOS 聚焦会缩放整页 */
const PROBE_INPUTS = `
  const list = [...document.querySelectorAll("input, textarea, select")].map((el) => {
    const cs = getComputedStyle(el);
    return {
      type: el.type || el.tagName.toLowerCase(),
      placeholder: el.placeholder || null,
      fontSize: cs.fontSize,
      keepFont: el.hasAttribute("data-keep-font"),
    };
  });
  return JSON.stringify({ vw: innerWidth, list }, null, 1);
`;

async function main() {
  const { ws, send, evalJs, shot } = await connect();
  await send("Page.enable");
  await send("Runtime.enable");

  if (MODE === "login") {
    for (const [w, h, dpr, tag, mobile] of [
      [1440, 1000, 2, "login-desktop-1440", false],
      [390, 844, 3, "login-mobile-390", true],
    ]) {
      await send("Emulation.setDeviceMetricsOverride", {
        width: w, height: h, deviceScaleFactor: dpr, mobile,
      });
      await send("Page.navigate", { url: `${BASE}/login` });
      await sleep(6000);
      console.log(`\n[${tag}]`, await evalJs("return location.href;"));
      await shot(tag);
      console.log("初音几何:", await evalJs(PROBE_MIKU));
      console.log("输入框字号:", await evalJs(PROBE_INPUTS));
    }
    ws.close();
    console.log("\n完成:", OUT);
    return;
  }

  if (MODE === "app") {
    if (!EMAIL || !PASS) throw new Error("用法: node scripts/ui-shot.mjs app <email> <password>");

    // 登录一次，让 cookie 落在浏览器里，后续每个页面都带上
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false });
    await send("Page.navigate", { url: `${BASE}/login` });
    await sleep(6000);

    const loginResult = await evalJs(`
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const [emailEl, passEl] = document.querySelectorAll("form input");
      if (!emailEl || !passEl) return "no-form";
      setter.call(emailEl, ${JSON.stringify(EMAIL)});
      emailEl.dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(passEl, ${JSON.stringify(PASS)});
      passEl.dispatchEvent(new Event("input", { bubbles: true }));
      const btn = [...document.querySelectorAll("form button")].find((b) => b.type === "submit");
      if (!btn) return "no-button";
      btn.click();
      return "clicked:" + btn.textContent.trim();
    `);
    console.log("登录:", loginResult);
    await sleep(7000);
    console.log("落地:", await evalJs("return location.href;"));

    const PAGES = [
      ["/", "01-inbox"],
      ["/tasks", "02-tasks"],
      ["/chat", "03-chat"],
      ["/insights", "04-insights"],
      ["/settings", "05-settings"],
    ];

    for (const [route, tag] of PAGES) {
      for (const [w, h, dpr, suffix, mobile] of [
        [1440, 1000, 2, "desktop", false],
        [390, 844, 3, "mobile", true],
      ]) {
        await send("Emulation.setDeviceMetricsOverride", {
          width: w, height: h, deviceScaleFactor: dpr, mobile,
        });
        await send("Page.navigate", { url: `${BASE}${route}` });
        await sleep(5000);
        await shot(`${tag}-${suffix}`);
        const miku = await evalJs(PROBE_MIKU);
        const parsed = JSON.parse(miku);
        if (parsed.nodes.length) console.log(`  ${tag}-${suffix} 初音节点:`, miku);
      }
    }

    ws.close();
    console.log("\n完成:", OUT);
    return;
  }

  throw new Error(`未知模式 ${MODE}，可用: login | app`);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
