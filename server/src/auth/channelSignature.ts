import { createHmac, timingSafeEqual } from "node:crypto";
import { getChannelAuthConfig } from "../env.js";

const usedNonces = new Map<string, number>();

function pruneExpiredNonces(nowMs: number): void {
  for (const [k, expireAt] of usedNonces) {
    if (expireAt <= nowMs) usedNonces.delete(k);
  }
}

function buildPayload(
  provider: "openclaw" | "doubao",
  timestamp: string,
  nonce: string,
  rawBody: string,
): string {
  return `${provider}\n${timestamp}\n${nonce}\n${rawBody}`;
}

function createExpectedSignature(
  secret: string,
  provider: "openclaw" | "doubao",
  timestamp: string,
  nonce: string,
  rawBody: string,
): string {
  const payload = buildPayload(provider, timestamp, nonce, rawBody);
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifyChannelSignature(input: {
  provider: "openclaw" | "doubao";
  timestamp: string | undefined;
  nonce: string | undefined;
  signature: string | undefined;
  rawBody: string;
  nowMs?: number;
}): { ok: true } | { ok: false; reason: string } {
  const now = input.nowMs ?? Date.now();
  pruneExpiredNonces(now);

  if (!input.timestamp || !input.nonce || !input.signature) {
    return { ok: false, reason: "missing_channel_signature_headers" };
  }

  const tsMs = Number(input.timestamp);
  if (!Number.isFinite(tsMs)) {
    return { ok: false, reason: "invalid_channel_timestamp" };
  }

  const maxSkewMs = 5 * 60 * 1000;
  if (Math.abs(now - tsMs) > maxSkewMs) {
    return { ok: false, reason: "channel_timestamp_expired" };
  }

  const nonceKey = `${input.provider}:${input.nonce}`;
  if (usedNonces.has(nonceKey)) {
    return { ok: false, reason: "channel_nonce_replayed" };
  }

  const cfg = getChannelAuthConfig();
  const secret =
    input.provider === "openclaw" ? cfg.openclawSecret : cfg.doubaoSecret;
  if (!secret) {
    return { ok: false, reason: "channel_sign_secret_not_configured" };
  }

  const expected = createExpectedSignature(
    secret,
    input.provider,
    input.timestamp,
    input.nonce,
    input.rawBody,
  );

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(input.signature);
  if (
    expectedBuf.length !== actualBuf.length ||
    !timingSafeEqual(expectedBuf, actualBuf)
  ) {
    return { ok: false, reason: "channel_signature_invalid" };
  }

  usedNonces.set(nonceKey, now + maxSkewMs);
  return { ok: true };
}

export function signChannelRequestForTest(input: {
  provider: "openclaw" | "doubao";
  timestamp: string;
  nonce: string;
  rawBody: string;
}): string {
  const cfg = getChannelAuthConfig();
  const secret =
    input.provider === "openclaw" ? cfg.openclawSecret : cfg.doubaoSecret;
  return createExpectedSignature(
    secret,
    input.provider,
    input.timestamp,
    input.nonce,
    input.rawBody,
  );
}

