type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export function hitRateLimit(
  key: string,
  options: { max: number; windowMs: number },
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || now >= current.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  current.count += 1;
  buckets.set(key, current);
  if (current.count > options.max) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((current.resetAt - now) / 1000),
    };
  }
  return { allowed: true, retryAfterSec: 0 };
}

