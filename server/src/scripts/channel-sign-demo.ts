import { createHmac, randomUUID } from "node:crypto";

type Provider = "openclaw" | "doubao";
type Action = "link" | "login";

function getArg(name: string, fallback = ""): string {
  const prefix = `--${name}=`;
  const raw = process.argv.find((v) => v.startsWith(prefix));
  if (!raw) return fallback;
  return raw.slice(prefix.length);
}

function getRequiredArg(name: string): string {
  const value = getArg(name);
  if (!value) {
    throw new Error(`missing_required_arg:${name}`);
  }
  return value;
}

function isProvider(v: string): v is Provider {
  return v === "openclaw" || v === "doubao";
}

function isAction(v: string): v is Action {
  return v === "link" || v === "login";
}

function sign(secret: string, provider: Provider, ts: string, nonce: string, rawBody: string): string {
  const payload = `${provider}\n${ts}\n${nonce}\n${rawBody}`;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

async function main(): Promise<void> {
  const baseUrl = getArg("baseUrl", "http://127.0.0.1:3000");
  const providerRaw = getRequiredArg("provider");
  const actionRaw = getRequiredArg("action");
  const externalUserId = getRequiredArg("externalUserId");
  const bearerToken = getArg("bearerToken");
  const nonce = getArg("nonce", randomUUID());
  const timestamp = getArg("timestamp", String(Date.now()));

  if (!isProvider(providerRaw)) throw new Error("invalid_provider");
  if (!isAction(actionRaw)) throw new Error("invalid_action");

  const provider = providerRaw;
  const action = actionRaw;
  const secret =
    getArg("secret") ||
    (provider === "openclaw"
      ? process.env.CHANNEL_SIGN_SECRET_OPENCLAW ?? ""
      : process.env.CHANNEL_SIGN_SECRET_DOUBAO ?? "");
  if (!secret) throw new Error("missing_sign_secret");

  const body = JSON.stringify({ provider, externalUserId });
  const signature = sign(secret, provider, timestamp, nonce, body);
  const path = action === "link" ? "/auth/channel/link" : "/auth/channel/login";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-channel-timestamp": timestamp,
    "x-channel-nonce": nonce,
    "x-channel-signature": signature,
  };
  if (action === "link") {
    if (!bearerToken) throw new Error("link_requires_bearerToken");
    headers.authorization = `Bearer ${bearerToken}`;
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body,
  });
  const text = await res.text();

  console.log(
    JSON.stringify(
      {
        request: {
          url: `${baseUrl}${path}`,
          provider,
          action,
          externalUserId,
          headers: {
            "x-channel-timestamp": timestamp,
            "x-channel-nonce": nonce,
            "x-channel-signature": signature,
            authorization: headers.authorization ? "Bearer ***" : undefined,
          },
          body: JSON.parse(body),
        },
        response: {
          status: res.status,
          body: safeJson(text),
        },
      },
      null,
      2,
    ),
  );
}

function safeJson(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

main().catch((err) => {
  console.error(`[channel-sign-demo] ${String(err)}`);
  console.error(
    "usage: pnpm --filter @smartpet-duel/server channel:demo --action=login --provider=doubao --externalUserId=ext_001 [--secret=...] [--baseUrl=...]",
  );
  process.exit(1);
});

