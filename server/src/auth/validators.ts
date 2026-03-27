const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;

export type RegisterIdentity =
  | { registerType: "email"; email: string; phone: null }
  | { registerType: "phone"; email: null; phone: string };

export function parseRegisterIdentity(raw: string): RegisterIdentity | null {
  const value = raw.trim();
  if (EMAIL_REGEX.test(value)) {
    return { registerType: "email", email: value.toLowerCase(), phone: null };
  }
  if (PHONE_REGEX.test(value)) {
    return { registerType: "phone", email: null, phone: value };
  }
  return null;
}
