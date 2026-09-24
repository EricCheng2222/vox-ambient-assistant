export function normalizePhoneNumber(value: string) {
  const normalized = value.trim().replace(/[\s()-]/g, "");
  return /^\+[1-9]\d{7,14}$/u.test(normalized) ? normalized : null;
}

export function normalizeSpokenPassphrase(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}\s]/gu, "");
}

export function isValidSpokenPassphrase(value: string) {
  const normalized = normalizeSpokenPassphrase(value);
  return normalized.length >= 12 && normalized.length <= 120;
}
