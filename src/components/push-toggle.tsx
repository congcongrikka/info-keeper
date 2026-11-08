"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, LoaderCircle, Send, ShieldAlert } from "lucide-react";
import { useToast } from "@/components/ui/toast";

type PushState =
  | "checking" // 还在探测环境
  | "unsupported" // 浏览器不支持 Web Push
  | "insecure" // 不是 https / localhost，浏览器直接不给推送
  | "needs-install" // iOS 上还没添加到主屏幕
  | "denied" // 用户之前拒绝过通知权限
  | "subscribed" // 已开启
  | "unsubscribed" // 支持，但没开
  | "working"; // 正在开关

interface PushToggleProps {
  /** 服务端是否配好了 VAPID 密钥；没配就别让用户白点 */
  pushConfigured: boolean;
  /** VAPID 公钥（服务端从环境变量读出来传进来，避免前端硬编码） */
  vapidPublicKey: string;
}

/** base64url → Uint8Array。applicationServerKey 只认二进制，不认 base64 字符串。 */
function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  // 注意：显式声明成 Uint8Array<ArrayBuffer>（而不是默认的 ArrayBufferLike），
  // 否则 TS 认为底层可能是 SharedArrayBuffer，不满足 applicationServerKey 的 BufferSource
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

/** ArrayBuffer → base64url（订阅里的 p256dh / auth 都是这个编码） */
function toBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  let binary = "";
  for (const byte of new Uint8Array(buffer)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isIOS(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ 的 UA 伪装成 macOS，只能靠触摸点数区分
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

/**
 * 国产手机浏览器 / App 内置浏览器的 UA 特征。
 * 它们基本都是厂商自研的「网页控件」（WebView 壳），Push API 一律不可用 ——
 * 不是我们不支持，是这套内核根本没把 serviceWorker.pushManager 暴露出来
 * （MDN 兼容表里 webview_android 明确是 false）。
 */
const VENDOR_UA_TOKENS = [
  "MiuiBrowser", // 小米浏览器
  "HuaweiBrowser", // 华为浏览器
  "HeyTapBrowser", // OPPO / 一加
  "VivoBrowser", // vivo
  "Quark", // 夸克
  "UCBrowser", // UC
  "MQQBrowser", // QQ 浏览器
  "QQBrowser",
  "baidubrowser", // 百度
  "BIDUBrowser",
  "MicroMessenger", // 微信内置
  "WeChat",
  "; wv)", // Android WebView 的标准标志位
];

function isVendorShell(): boolean {
  const ua = navigator.userAgent;
  return VENDOR_UA_TOKENS.some((token) => ua.includes(token));
}

/**
 * 是不是以「已安装的 App」形态在跑。
 * iOS 上这是能否用 Web Push 的硬门槛：Safari 标签页里支持度为零，
 * 必须「添加到主屏幕」后从主屏图标打开，pushManager 才存在。
 */
function isStandalone(): boolean {
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  if (window.matchMedia("(display-mode: minimal-ui)").matches) return true;
  if (window.matchMedia("(display-mode: window-controls-overlay)").matches) return true;
  // 非标准，但 iOS 上唯一可靠
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function supportsPush(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** 把浏览器订阅对象转成后端要的形状 */
function serializeSubscription(subscription: PushSubscription) {
  // Firefox 在推送服务不可达时会把 subscribe() resolve 成 null（Gecko 的已知行为，
  // 不抛错、也不 reject），一路传到这里就炸成
  // "can't access property \"toJSON\", e is null"。这里显式拦一道，给出能看懂的原因。
  if (!subscription) {
    throw new Error("subscribe-null");
  }
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: json.keys?.p256dh ?? toBase64Url(subscription.getKey("p256dh")),
      auth: json.keys?.auth ?? toBase64Url(subscription.getKey("auth")),
    },
  };
}

/**
 * 给可能永远不 resolve 的浏览器 API 套超时。
 * pushManager.subscribe() 在「浏览器连不上推送服务」时不会立刻报错，
 * 而是干等十几秒甚至更久 —— 用户看到的就是「一直转圈、永远不成功」。
 */
function withTimeout<T>(promise: Promise<T>, ms: number, hint: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(hint)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * 把浏览器抛出的英文/空白错误翻译成人能看懂的一句话。
 * 这些错误名在各家浏览器里稳定，message 却常常是空的或只有 "Registration failed"。
 */
function explainPushError(error: unknown, browser: string): string {
  const name = error instanceof Error ? error.name : "";
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const text = `${name} ${raw}`.toLowerCase();

  if (text.includes("timeout") || text.includes("超时")) {
    return "浏览器一直没能连上推送服务，等了大半分钟也没结果。多半是网络到推送服务器不通（见下方说明）。";
  }
  if (raw.includes("push service error") || raw.includes("networkerror") || name === "AbortError") {
    return "浏览器连不上系统推送服务。";
  }
  if (name === "NotAllowedError" || text.includes("permission")) {
    return "通知权限被拒绝了。点地址栏左侧的图标 → 把「通知」改成允许，再回来点一次。";
  }
  if (name === "InvalidStateError") {
    return "这个站点已经有另一套推送订阅了。先在设置里关掉提醒，刷新页面后再重新开启。";
  }
  if (name === "SecurityError" || text.includes("insecure")) {
    return "当前页面不是 https（也不是 localhost），浏览器不允许注册推送。";
  }
  if (name === "NotSupportedError") {
    return "当前浏览器内核不支持网页推送，换 Chrome / Edge / Safari 16.4+ 试试。";
  }  if (text.includes("registration failed")) {
    return "注册推送订阅失败，浏览器没能拿到推送地址。";
  }
  if (text.includes("subscribe-null")) {
    return "浏览器没能拿到推送地址（提交订阅的请求返回了空结果）。通常是连不上它背后的推送服务器。";
  }
  return raw
    ? `开启失败：${raw}`
    : `开启失败（${browser} 没有给出具体原因，可以在开发者工具的 Console 里看详细报错）。`;
}

/** 粗略识别内核，用来给对症的建议 */
function browserName(): string {
  const ua = navigator.userAgent;
  if (/MiuiBrowser\//.test(ua)) return "小米浏览器";
  if (/HuaweiBrowser\//.test(ua)) return "华为浏览器";
  if (/HeyTapBrowser\//.test(ua)) return "OPPO 浏览器";
  if (/VivoBrowser\//.test(ua)) return "vivo 浏览器";
  if (/Quark\//.test(ua)) return "夸克浏览器";
  if (/UCBrowser\//.test(ua)) return "UC 浏览器";
  if (/(MQQBrowser|QQBrowser)\//.test(ua)) return "QQ 浏览器";
  if (/(baidubrowser|BIDUBrowser)\//i.test(ua)) return "百度浏览器";
  if (/MicroMessenger\//.test(ua)) return "微信内置浏览器";
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "当前浏览器";
}

async function postSubscription(payload: ReturnType<typeof serializeSubscription>) {
  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `保存订阅失败（HTTP ${response.status}）`);
  }
}

export function PushToggle({ pushConfigured, vapidPublicKey }: PushToggleProps) {
  const { toast } = useToast();
  const [state, setState] = useState<PushState>("checking");
  const [message, setMessage] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [browser, setBrowser] = useState("");

  // 首次挂载：探测环境 + 读当前浏览器是否已有订阅
  useEffect(() => {
    let cancelled = false;
    setBrowser(browserName());

    const detect = async () => {
      // 非安全上下文：localhost 之外的 http 页面，浏览器根本不给 Service Worker
      if (!window.isSecureContext) {
        if (!cancelled) setState("insecure");
        return;
      }

      // iOS 非独立窗口：连问都不用问，直接告诉用户先装到主屏幕。
      // 必须排在 supportsPush() 之前 —— iOS 的 Safari 标签页里 PushManager
      // 压根不存在（苹果只对已添加到主屏的 PWA 暴露它），先判 supportsPush()
      // 会把 iOS 用户错判成「这个浏览器不支持」，给出没法执行的建议。
      if (isIOS() && !isStandalone()) {
        if (!cancelled) setState("needs-install");
        return;
      }

      if (!supportsPush()) {
        if (!cancelled) setState("unsupported");
        return;
      }

      if (Notification.permission === "denied") {
        if (!cancelled) setState("denied");
        return;
      }

      const registration = await navigator.serviceWorker.getRegistration("/").catch(() => undefined);
      const subscription = await registration?.pushManager.getSubscription().catch(() => null);

      if (cancelled) return;

      if (subscription && Notification.permission === "granted") {
        setState("subscribed");
        // 静默补一次：浏览器里还留着订阅、但服务端库里被清掉（比如换了项目 / 被 410 清过）时能自愈
        void postSubscription(serializeSubscription(subscription)).catch(() => {
          /* 后台补写失败不打扰用户，下次点按钮还会再写一次 */
        });
        return;
      }

      setState("unsubscribed");
    };

    void detect();

    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    if (!pushConfigured || !vapidPublicKey) {
      setMessage("服务端还没配好 VAPID 密钥，暂时开不了。");
      toast("服务端还没配好推送密钥", "error");
      return;
    }

    setState("working");
    setMessage(null);
    setHint(null);

    try {
      // 1) 要权限（必须在用户手势里调，异步链太长会被浏览器拒绝）
      const permission = await withTimeout(
        Notification.requestPermission(),
        60_000,
        "等待授权超时：浏览器没弹出授权框，可能是被之前的选择记住了。",
      );
      if (permission === "denied") {
        setState("denied");
        return;
      }
      if (permission !== "granted") {
        setState("unsubscribed");
        setMessage("没有授权通知权限，无法接收提醒。");
        return;
      }

      // 2) 拿到 Service Worker。没有就用同一个 sw.js 注册一份（dev 下 service-worker.tsx 不注册）
      const registration =
        (await navigator.serviceWorker.getRegistration("/").catch(() => undefined)) ??
        (await withTimeout(
          navigator.serviceWorker.register("/sw.js", { scope: "/" }),
          20_000,
          "注册 Service Worker 超时。",
        ));
      await withTimeout(
        navigator.serviceWorker.ready,
        20_000,
        "Service Worker 一直没激活成功（页面可能被缓存卡住了，刷新一下再试）。",
      );

      // 3) 向推送服务申请订阅。这一步是唯一需要出网的，也是最容易「卡住」的地方
      const existing = await registration.pushManager.getSubscription().catch(() => null);
      const subscription =
        existing ??
        (await withTimeout(
          registration.pushManager.subscribe({
            // 必须为 true：浏览器要求每条推送都能显示可见通知
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
          }),
          // 正常浏览器 1~5 秒就能拿到推送地址（Edge 实测 4 秒）。
          // 超过 20 秒基本可以断定是连不上推送服务，不再让用户对着转圈等下去。
          20_000,
          "subscribe-timeout",
        ));

      // Firefox 连不上推送服务时不会 reject，而是 resolve(null)——必须自己判空，
      // 否则下一步取 toJSON 会崩成 "can't access property \"toJSON\", e is null"。
      if (!subscription) {
        throw new Error("subscribe-null");
      }

      // 4) 存到自己的数据库
      await withTimeout(
        postSubscription(serializeSubscription(subscription)),
        20_000,
        "保存订阅超时：服务器没有响应。",
      );

      setState("subscribed");
      toast("已开启，每天早上 8:00 提醒你", "success");
    } catch (error) {
      setState("unsubscribed");
      const reason = explainPushError(error, browserName());
      setMessage(reason);

      // 专门给「连不上推送服务」补一条能落地的建议：
      // 桌面 Chrome 走 Google 的 FCM，国内网络下经常整个超时；Edge 走 Windows 的 WNS，同一台机器就能成。
      // 安卓不一样：那边所有浏览器的投递最后都要过 FCM（见 Mozilla 源码文档里的
      // Firebase Cloud Messaging → AbstractFirebasePushService），换浏览器绕不过去。
      const services = (error instanceof Error ? error.message : "").toLowerCase();
      if (
        services.includes("subscribe-timeout") ||
        services.includes("timeout") ||
        services.includes("push service")
      ) {
        if (isAndroid()) {
          setHint(
            "安卓上所有主流浏览器（Chrome、Firefox、Edge、三星、UC…）的网页推送最后都要经过 Google 的 FCM 通道。手机没有 Google 服务（国行安卓基本都没有）就拿不到推送地址，换浏览器也绕不过去。",
          );
        } else if (isIOS()) {
          setHint("可以稍后重试；如果一直不行，把这个网页从主屏删掉重新「添加到主屏幕」一次。");
        } else if (browserName() === "Edge") {
          setHint("可以稍后重试，或检查系统代理 / 防火墙是否拦住了浏览器出网。");
        } else {
          setHint(
            "Chrome、Opera 用的是 Google 的 FCM 推送服务，国内网络常常整个连不通。这台电脑上请改用 Microsoft Edge 打开本页再开启 —— Edge 走的是 Windows 自带的推送通道。",
          );
        }
      }

      toast(reason, "error");
    }
  }, [pushConfigured, vapidPublicKey, toast]);

  const disable = useCallback(async () => {
    setState("working");
    setMessage(null);
    setHint(null);

    try {
      const registration = await navigator.serviceWorker.getRegistration("/").catch(() => undefined);
      const subscription = await registration?.pushManager.getSubscription().catch(() => null);

      if (subscription) {
        // 先删服务端：失败也继续在本地退订，推送服务下次会返回 410，定时任务会自己收拾干净
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => null);

        await subscription.unsubscribe();
      }

      setState("unsubscribed");
      toast("已关闭每日早报", "info");
    } catch (error) {
      setState("subscribed");
      const reason = error instanceof Error ? error.message : "关闭失败";
      setMessage(reason);
      toast(reason, "error");
    }
  }, [toast]);

  /** 发一条测试通知：验证「订阅真的能收到」，不用等到第二天早上 */
  const sendTest = useCallback(async () => {
    setTesting(true);
    setMessage(null);
    setHint(null);

    try {
      const response = await fetch("/api/push/test", {
        method: "POST",
        credentials: "same-origin",
      });
      const data = (await response.json().catch(() => null)) as {
        sent?: number;
        failed?: number;
        error?: string;
        detail?: string;
      } | null;

      if (!response.ok) {
        throw new Error(data?.error ?? `发送失败（HTTP ${response.status}）`);
      }

      if ((data?.sent ?? 0) > 0) {
        toast("已发送，通知应该马上弹出来", "success");
        setHint("没看到通知？检查系统「通知」设置里是否允许了浏览器。");
      } else {
        setMessage(data?.detail ?? "没有可用的订阅，先关闭再重新开启提醒试试。");
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "发送失败";
      setMessage(reason);
      toast(reason, "error");
    } finally {
      setTesting(false);
    }
  }, [toast]);

  const busy = state === "working" || state === "checking";

  return (
    <div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-faint">
        每天早上 8:00（北京时间）推送一条：今天有几件待办。
        有待办才会发，没有就安静一整天。
      </p>

      {state === "insecure" && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-sakura/10 p-3">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-sakura" />
          <p className="text-[11.5px] leading-relaxed text-muted">
            当前页面不是安全来源，浏览器不允许推送。
            <br />
            <span className="text-faint">
              网页推送只在 https 或 localhost 下可用。用局域网 IP（如 192.168.x.x）
              直接打开的页面开不了，请用部署好的 https 域名。
            </span>
          </p>
        </div>
      )}

      {state === "needs-install" && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-sakura/10 p-3">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-sakura" />
          <div className="text-[11.5px] leading-relaxed text-muted">
            <p>请先添加到主屏幕。</p>
            <p className="mt-1.5 text-faint">
              iPhone / iPad 上，苹果只对「已装到主屏」的网页开放推送，Safari 标签页里没有这个能力。
            </p>
            <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-faint">
              <li>用 <span className="text-miku">Safari</span> 打开本站（别的浏览器不行）</li>
              <li>点底部分享按钮 <span className="text-miku">↑</span> → 选「添加到主屏幕」→ 添加</li>
              <li>关掉 Safari，从<span className="text-miku">主屏幕图标</span>重新打开</li>
              <li>重新登录一次（主屏版和 Safari 的登录态是分开的），再回来开启</li>
            </ol>
            <p className="mt-1.5 text-faint">
              需要 iOS 16.4 或更高版本。装好后如果还是开不了，用「邮件早报」更稳。
            </p>
          </div>
        </div>
      )}

      {state === "unsupported" && (
        <div className="mt-3 rounded-2xl bg-white/5 p-3">
          <p className="text-[11.5px] leading-relaxed text-muted">
            {browser}不支持网页推送。
          </p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">
            {isAndroid() || isVendorShell() ? (
              <>
                安卓上的国产浏览器（小米 / 华为 / OPPO / vivo / UC / QQ / 夸克）和
                微信、QQ 的内置浏览器，用的都是被裁剪过的网页控件，系统根本没有开放推送接口
                —— 换任何设置都没用，只能换浏览器。
                <br />
                换 <span className="text-miku">Chrome 或 Edge 安卓版</span>可以拿到推送权限，
                但这两家和小米自带浏览器一样，最后都要经过 Google 的 FCM 通道投递。
                如果这台手机没装 Google 服务，推送仍然到不了。
                <br />
                想稳定收到，建议把电脑上的 Edge 开起来收（已验证可用）。
              </>
            ) : isIOS() ? (
              <>
                这台设备已经装到主屏了，但系统还没开放网页推送 ——
                iOS 需要 <span className="text-miku">16.4 或更高版本</span>。
                <br />
                升级系统后再回来开；不想升级的话，用下面的「邮件早报」一样能收到。
              </>
            ) : (
              <>
                这个浏览器没有开放推送接口。桌面端用 Chrome / Edge 可以；
                手机上可以换 Chrome / Edge 安卓版。
              </>
            )}
          </p>
        </div>
      )}

      {state === "denied" && (
        <div className="mt-3 rounded-2xl bg-sakura/10 p-3">
          <p className="text-[11.5px] leading-relaxed text-muted">
            通知权限被拒绝过，浏览器不会再弹窗询问。
            需要去地址栏左侧的站点设置里把「通知」改回允许，再回来开启。
          </p>
          {isVendorShell() && (
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">
              {browser}的内核通常不把推送权限交给网页，改了也可能还是开不了。
              安卓上换 Chrome / Edge 能拿到权限，但推送投递仍要过 Google 的 FCM 通道。
            </p>
          )}
        </div>
      )}

      {state !== "needs-install" &&
        state !== "unsupported" &&
        state !== "denied" &&
        state !== "insecure" && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={state === "subscribed" ? disable : enable}
              disabled={busy || (state === "unsubscribed" && !pushConfigured)}
              className={
                state === "subscribed"
                  ? "glass inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] text-muted transition hover:border-sakura/50 hover:text-sakura disabled:opacity-60"
                  : "neon-soft inline-flex items-center gap-1.5 rounded-full bg-miku px-4 py-2 text-[12.5px] font-medium text-night transition hover:neon disabled:opacity-60"
              }
            >
              {busy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <BellRing className="size-4" />
              )}
              {state === "checking"
                ? "检查中…"
                : state === "working"
                  ? "处理中…"
                  : state === "subscribed"
                    ? "关闭每日早报"
                    : "开启每日早报提醒"}
            </button>

            {state === "subscribed" && (
              <button
                type="button"
                onClick={sendTest}
                disabled={testing}
                className="glass inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] text-muted transition hover:border-miku/50 hover:text-miku disabled:opacity-60"
              >
                {testing ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                发一条测试通知
              </button>
            )}
          </div>
        )}

      {/* 服务端没配密钥时把原因说清楚，别让按钮看起来「点了没反应」 */}
      {!pushConfigured && state !== "subscribed" && (
        <p className="mt-2 rounded-2xl bg-sakura/10 p-3 text-[11.5px] leading-relaxed text-muted">
          服务器还没有配置 VAPID 密钥，所以按钮被禁用了。
          在环境变量里补上 <code className="text-miku">NEXT_PUBLIC_VAPID_PUBLIC_KEY</code> 和{" "}
          <code className="text-miku">VAPID_PRIVATE_KEY</code> 之后重新部署即可。
        </p>
      )}

      {message && <p className="mt-2 text-[11.5px] leading-relaxed text-sakura">{message}</p>}

      {hint && <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">{hint}</p>}

      {state === "subscribed" && (
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          这台设备已登记。换设备需要在新设备上再开一次；关掉提醒随时可以点上面的按钮。
        </p>
      )}
    </div>
  );
}
