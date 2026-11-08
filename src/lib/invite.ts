import { createHash, timingSafeEqual } from "node:crypto";

/**
 * 邀请码闸门（只在服务端使用，绝不能从客户端组件 import）。
 *
 * 设计取舍：
 * - **失败即关闭**（fail-closed）。没有配置 INVITE_CODE 时注册一律被拒绝，
 *   而不是「没配置就等于不用校验」——后者会让一次部署疏忽直接变成公开注册。
 * - 比较用 sha256 摘要 + timingSafeEqual，避免通过响应时间猜测邀请码长度。
 * - 只做 trim（容忍复制粘贴带空格），区分大小写。
 */

const MAX_CODE_LENGTH = 128;

// 邀请码通常是朋友在手机上敲的：iOS 键盘默认首字母大写，输入法还可能顺手纠错
// （abcd01 → Abcd01），所以两端都按小写比较。熵上的损失可以忽略——它本身是个
// 共享口令，真正的防线是接口限流 + 不公开传播。
function normalize(value: string) {
  return value.trim().toLowerCase().slice(0, MAX_CODE_LENGTH);
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

/** 读取服务端配置的邀请码；未配置或只填了空白时返回 null */
export function getInviteCode(): string | null {
  const raw = process.env.INVITE_CODE;
  if (typeof raw !== "string") return null;
  const normalized = normalize(raw);
  if (!normalized) return null;
  return normalized;
}

/** 注册是否开放（= 服务端是否配置了邀请码） */
export function isSignupOpen(): boolean {
  return getInviteCode() !== null;
}

export type InviteCheck =
  | { ok: true }
  | { ok: false; status: 403 | 503; code: string; message: string };

/** 校验用户提交的邀请码，返回可直接映射成 HTTP 状态的判定结果 */
export function verifyInviteCode(input: unknown): InviteCheck {
  const expected = getInviteCode();

  if (!expected) {
    return {
      ok: false,
      status: 503,
      code: "invite_not_configured",
      message: "服务端还没配置 INVITE_CODE，注册通道已关闭。请联系管理员。",
    };
  }

  const provided = typeof input === "string" ? normalize(input) : "";

  if (!provided) {
    return { ok: false, status: 403, code: "invite_required", message: "注册需要邀请码，请先向管理员索取。" };
  }

  // 长度不同时也要走完一次比较，避免提前返回泄露长度信息
  const expectedDigest = digest(expected);
  const providedDigest = digest(provided);
  const matched = timingSafeEqual(expectedDigest, providedDigest) && provided.length === expected.length;

  if (!matched) {
    return { ok: false, status: 403, code: "invalid_invite_code", message: "邀请码不正确，注册没通过。" };
  }

  return { ok: true };
}
