import { createDecipheriv } from "node:crypto";
import { openLocalMqttSession } from "./local-mqtt-session.mjs";
import { runDysonCommand } from "./dyson-local.mjs";
import { SmartHomeConnectionError } from "./smart-home-errors.mjs";

const servers = { global: "https://appapi.cp.dyson.com", china: "https://appapi.cp.dyson.cn" };
function cloudError(message, kind = "connection") {
  return new SmartHomeConnectionError(message, { kind, retryable: false });
}
export function createDysonCloudClient({ fetch: request = globalThis.fetch } = {}) {
  async function call(path, { region = "global", token, body } = {}) {
    if (!Object.hasOwn(servers, region)) throw cloudError("Choose a supported Dyson account region.", "credential");
    let response;
    try {
      response = await request(`${servers[region]}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "User-Agent": "android client", Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error", signal: AbortSignal.timeout(15_000),
      });
    } catch { throw cloudError("Dyson's cloud service could not be reached."); }
    if (!response.ok) throw cloudError(
      [401, 403].includes(response.status) ? "Sign in to Dyson again in Home devices to restore cloud control."
        : `Dyson's cloud service returned HTTP ${response.status}.`,
      [401, 403].includes(response.status) ? "credential" : "connection",
    );
    try { return await response.json(); }
    catch { throw cloudError("Dyson's cloud service returned an unreadable response."); }
  }
  return {
    async beginLogin({ email, country = "TW", region = "global" }) {
      if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw cloudError("Enter your Dyson account email.", "credential");
      if (!/^[A-Z]{2}$/u.test(country)) throw cloudError("Enter a two-letter account country.", "credential");
      const query = `?country=${country}`;
      const status = await call(`/v3/userregistration/email/userstatus${query}`, { region, body: { email } });
      if (status.accountStatus !== "ACTIVE") throw cloudError("Dyson did not report an active account for that email.", "credential");
      const challenge = await call(`/v3/userregistration/email/auth${query}`, { region, body: { email } });
      if (typeof challenge.challengeId !== "string" || !/^[a-f0-9-]{36}$/iu.test(challenge.challengeId)) throw cloudError("Dyson did not return a sign-in challenge.");
      return { email, country, region, challengeId: challenge.challengeId };
    },
    async completeLogin(challenge, { code, password }) {
      if (typeof code !== "string" || !code.trim() || code.length > 40 || typeof password !== "string" || !password || password.length > 500) throw cloudError("Enter the email code and your Dyson password.", "credential");
      const result = await call(`/v3/userregistration/email/verify?country=${challenge.country}`, { region: challenge.region, body: { email: challenge.email, challengeId: challenge.challengeId, otpCode: code.trim(), password } });
      if (typeof result.token !== "string" || !result.token || result.token.length > 16_000) throw cloudError("Dyson did not return an account session.", "credential");
      return { token: result.token, region: challenge.region };
    },
    async deviceConfiguration(account, serial) {
      const manifest = await call("/v3/manifest", account);
      if (!Array.isArray(manifest)) throw cloudError("Dyson did not return a device list.");
      const device = manifest.find(entry => entry.serialNumber === serial);
      if (!device?.connectedConfiguration?.mqtt) throw cloudError("This Dyson account does not list that connected purifier.", "credential");
      try {
        const { localBrokerCredentials, mqttRootTopicLevel } = device.connectedConfiguration.mqtt;
        const decipher = createDecipheriv("aes-256-cbc", Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)), Buffer.alloc(16));
        const decoded = JSON.parse(Buffer.concat([decipher.update(Buffer.from(localBrokerCredentials, "base64")), decipher.final()]).toString("utf8"));
        if (decoded.serial && decoded.serial !== serial) throw new Error("identity");
        if (typeof decoded.apPasswordHash !== "string" || decoded.apPasswordHash.length < 16 || typeof mqttRootTopicLevel !== "string") throw new Error("shape");
        return { credential: decoded.apPasswordHash, productType: mqttRootTopicLevel };
      } catch { throw cloudError("Dyson's local device credential could not be decoded."); }
    },
    iotCredentials: (account, serial) => call("/v2/authorize/iot-credentials", { ...account, body: { Serial: serial } }),
  };
}

const cloud = createDysonCloudClient();
export function dysonCloudMqttConfiguration(result) {
  const endpoint = result?.Endpoint;
  const credentials = result?.IoTCredentials;
  // The cloud API must never direct authenticated sockets to an arbitrary host.
  if (typeof endpoint !== "string" || !/^[a-z0-9-]+(?:\.iot(?:-[a-z]+)?\.[a-z0-9-]+)\.amazonaws\.com(?:\.cn)?$/iu.test(endpoint)) throw cloudError("Dyson returned an unsupported cloud broker.");
  if (!credentials || !["ClientId", "CustomAuthorizerName", "TokenKey", "TokenSignature", "TokenValue"].every(key => typeof credentials[key] === "string" && credentials[key].length > 0 && credentials[key].length <= 4096 && !/[\r\n]/u.test(credentials[key]))) throw cloudError("Dyson did not return valid cloud broker credentials.");
  if (!/^[a-z0-9-]+$/iu.test(credentials.TokenKey)) throw cloudError("Dyson returned an unsupported cloud token header.");
  return {
    url: `wss://${endpoint}/mqtt`,
    options: {
      // AWS WebSockets use the standard 'mqtt' subprotocol, not mqttv3.1.
      protocolVersion: 4, protocolId: "MQTT", clientId: credentials.ClientId,
      clean: true, reconnectPeriod: 0, connectTimeout: 10_000,
      wsOptions: { headers: { [credentials.TokenKey]: credentials.TokenValue, "X-Amz-CustomAuthorizer-Name": credentials.CustomAuthorizerName, "X-Amz-CustomAuthorizer-Signature": credentials.TokenSignature } },
    },
  };
}
export async function runDysonCloudCommand(config, prompt, deps = {}) {
  if (!config.cloudToken) throw cloudError("Connect your Dyson account in Home devices to enable cloud control.", "credential");
  const account = { token: config.cloudToken, region: config.cloudRegion ?? "global" };
  const credentials = await (deps.cloud ?? cloud).iotCredentials(account, config.serial);
  const mqtt = dysonCloudMqttConfiguration(credentials);
  const result = await runDysonCommand(config, prompt, {
    ...deps,
    openSession: () => openLocalMqttSession({ ...mqtt, label: `${config.name} through Dyson cloud`, connect: deps.connect, timeoutMs: deps.timeoutMs ?? 10_000 }),
  });
  return { ...result, transport: "cloud" };
}
