import { ipcMain, session } from "electron";

// Which websites the user has signed in to inside the built-in browser, and
// signing out of one. Vox is told only yes or no per site; cookie values
// never leave this file. The same rules as lib/web-accounts.ts decide what
// counts as a sign-in.

const PARTITION = "persist:vox-browser";
const MAX_SERVICES = 80;

const SESSION_LIKE = /(^|[_.-])(sess(ion)?(_?id)?|sid|auth([_-]?token)?|token|login|logged[_-]?in|user[_-]?(id|session)|access[_-]?token|jwt|remember)([_.-]|$)/iu;
const VISITOR_ONLY = /csrf|xsrf|consent|locale|lang|theme|ab[_-]?test|_ga|_gid|_fbp|_gcl|visitor|device|anon|guest|tracking|cf_|__cf|optanon|cookie[_-]?(consent|banner)/iu;

export function looksSignedIn(cookieNames, known = []) {
  if (known.length) return cookieNames.some((name) => known.includes(name));
  return cookieNames.some((name) => SESSION_LIKE.test(name) && !VISITOR_ONLY.test(name));
}

/** A plain registrable-looking domain, nothing else. */
export function cleanDomain(value) {
  const domain = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9-]+(\.[a-z0-9-]+){1,4}$/u.test(domain) && domain.length <= 80 ? domain : "";
}

export function cleanChecks(value) {
  const checks = [];
  for (const item of Array.isArray(value) ? value.slice(0, MAX_SERVICES) : []) {
    const id = typeof item?.id === "string" && /^[a-z0-9-]{1,24}$/u.test(item.id) ? item.id : "";
    const domains = (Array.isArray(item?.domains) ? item.domains : []).map(cleanDomain).filter(Boolean).slice(0, 4);
    const cookies = (Array.isArray(item?.cookies) ? item.cookies : []).filter((name) => typeof name === "string" && name.length <= 80).slice(0, 8);
    if (id && domains.length) checks.push({ id, domains, cookies });
  }
  return checks;
}

export function registerWebAccounts({ requireTrustedVoxSender }) {
  const profile = () => session.fromPartition(PARTITION);

  async function liveCookieNames(domain) {
    const now = Date.now() / 1000;
    const cookies = await profile().cookies.get({ domain }).catch(() => []);
    return cookies.filter((cookie) => cookie.value && (!cookie.expirationDate || cookie.expirationDate > now)).map((cookie) => cookie.name);
  }

  ipcMain.handle("vox-accounts:status", async (event, rawChecks) => {
    requireTrustedVoxSender(event);
    const status = {};
    for (const check of cleanChecks(rawChecks)) {
      const names = (await Promise.all(check.domains.map(liveCookieNames))).flat();
      status[check.id] = looksSignedIn(names, check.cookies);
    }
    return status;
  });

  /** Signs out of one service in Vox: its cookies and stored data are removed. */
  ipcMain.handle("vox-accounts:sign-out", async (event, rawDomains) => {
    requireTrustedVoxSender(event);
    const domains = (Array.isArray(rawDomains) ? rawDomains : []).map(cleanDomain).filter(Boolean).slice(0, 4);
    for (const domain of domains) {
      for (const cookie of await profile().cookies.get({ domain }).catch(() => [])) {
        const host = (cookie.domain ?? domain).replace(/^\./u, "");
        await profile().cookies.remove(`https://${host}${cookie.path ?? "/"}`, cookie.name).catch(() => undefined);
      }
      for (const origin of [`https://${domain}`, `https://www.${domain}`]) {
        await profile().clearStorageData({ origin }).catch(() => undefined);
      }
    }
    return domains.length > 0;
  });
}
