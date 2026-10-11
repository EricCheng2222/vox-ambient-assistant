/**
 * How the built-in browser names itself to websites: as the Chrome it is
 * built on, in the short form Chrome itself sends. Left as "Electron" with a
 * full build number, shops and sign-in pages turn it away as a script
 * (PChome answers "429 Too Many Requests" on the first visit).
 */
export function browserUserAgent(defaultUserAgent) {
  return String(defaultUserAgent ?? "")
    .replace(/(\(KHTML, like Gecko\)) .*?(Chrome\/)/u, "$1 $2")
    .replace(/ Electron\/[\d.]+/u, "")
    .replace(/Chrome\/(\d+)\.[\d.]+/u, "Chrome/$1.0.0.0");
}

/** The languages pages are asked for: the Mac's own, most preferred first. */
export function browserLanguages(preferred) {
  const out = [];
  for (const tag of Array.isArray(preferred) ? preferred : []) {
    if (typeof tag !== "string" || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/u.test(tag)) continue;
    // "zh-Hant-TW" is sent as "zh-TW", as browsers do.
    const parts = tag.split("-");
    const region = parts.find((part, index) => index > 0 && /^[A-Za-z]{2}$|^\d{3}$/u.test(part));
    for (const item of [region ? `${parts[0]}-${region.toUpperCase()}` : parts[0], parts[0]]) {
      if (!out.includes(item)) out.push(item);
    }
  }
  if (!out.includes("en")) out.push("en");
  return out.slice(0, 6).join(",");
}
