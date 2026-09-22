import { createHash, randomUUID } from "node:crypto";
import mqtt from "mqtt";
import { Bonjour } from "bonjour-service";

const linkProductTypes = new Set(["455", "469", "475"]);
const supportedProductTypes = new Set([
  "358", "358E", "358K", "438", "438E", "438K", "438M",
  "455", "469", "475", "520", "527", "527E", "527K", "527M", "664",
]);

function clean(value, maximum = 200) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function productType(value) {
  const normalized = clean(value, 8).toUpperCase() === "455A"
    ? "455"
    : clean(value, 8).toUpperCase();
  if (!supportedProductTypes.has(normalized)) {
    throw new Error("That Dyson purifier product type is not supported yet.");
  }
  return normalized;
}

function serialNumber(value) {
  const normalized = clean(value, 40).toUpperCase();
  if (!/^[0-9A-Z]{3}-[A-Z]{2}-[0-9A-Z]{8,}$/u.test(normalized)) {
    throw new Error("Enter the purifier serial number in its full XXX-XX-XXXXXXXX format.");
  }
  return normalized;
}

function localHost(value) {
  const normalized = clean(value, 253).toLowerCase().replace(/\.$/u, "");
  if (
    !normalized ||
    normalized.includes(":") ||
    normalized.includes("/") ||
    !/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\d{1,3}(?:\.\d{1,3}){3})$/u.test(normalized)
  ) {
    throw new Error("Enter the purifier's local IP address or hostname without a port.");
  }
  return normalized;
}

function deviceCredential(value) {
  const normalized = clean(value, 512);
  if (normalized.length < 16 || /\s/u.test(normalized)) {
    throw new Error("Enter a valid local Dyson device credential.");
  }
  return normalized;
}

function deviceName(value) {
  return clean(value, 80) || "Dyson purifier";
}

export function deriveDysonStickerConfiguration(raw) {
  const ssid = clean(raw?.wifiSsid, 100).toUpperCase();
  const password = clean(raw?.wifiPassword, 100);
  const match = ssid.match(
    /^DYSON-([0-9A-Z]{3}-[A-Z]{2}-[0-9A-Z]{8,})-([0-9]{3}[A-Z]?)$/u,
  );
  if (!match || !password) {
    throw new Error("Enter the DYSON-… sticker network name and its Wi-Fi code.");
  }
  return {
    name: deviceName(raw?.name),
    host: localHost(raw?.host),
    serial: serialNumber(match[1]),
    productType: productType(match[2]),
    credential: createHash("sha512").update(password, "utf8").digest("base64"),
  };
}

export function normalizeDysonManualConfiguration(raw) {
  return {
    name: deviceName(raw?.name),
    host: localHost(raw?.host),
    serial: serialNumber(raw?.serial),
    productType: productType(raw?.productType),
    credential: deviceCredential(raw?.credential),
  };
}

export function configureDysonDevice(raw) {
  return raw?.method === "sticker"
    ? deriveDysonStickerConfiguration(raw)
    : normalizeDysonManualConfiguration(raw);
}

export function parseDysonServiceName(name) {
  const first = clean(name, 160).split(".")[0];
  const separator = first.indexOf("_");
  if (separator < 0) return {};
  try {
    return {
      productType: productType(first.slice(0, separator)),
      serial: serialNumber(first.slice(separator + 1)),
    };
  } catch {
    return {};
  }
}

export async function discoverDysonPurifiers(timeoutMs = 8_000) {
  const bonjour = new Bonjour();
  const devices = new Map();
  const browser = bonjour.find({ type: "dyson_mqtt", protocol: "tcp" });
  browser.on("up", (service) => {
    const { serial, productType: discoveredProductType } = parseDysonServiceName(service.name);
    const address = Array.isArray(service.addresses)
      ? service.addresses.find((candidate) => /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(candidate))
      : undefined;
    if (!address) return;
    devices.set(serial || address, {
      name: serial ? `Dyson ${serial}` : clean(service.name, 100) || "Dyson purifier",
      host: address,
      serial: serial || undefined,
      productType: discoveredProductType || undefined,
    });
  });
  await new Promise((resolve) => setTimeout(resolve, Math.max(500, Math.min(timeoutMs, 8_000))));
  browser.stop();
  bonjour.destroy();
  return [...devices.values()];
}

function taiwanMandarin(text) {
  return /[\u3400-\u9fff]/u.test(text);
}

export function parseDysonCommand(text) {
  const value = clean(text, 4_000);
  if (!value) throw new Error("Say what you want the Dyson purifier to do.");
  const lower = value.toLocaleLowerCase();

  if (/(?:auto(?:matic)? mode|自動模式|自动模式)/iu.test(value)) {
    return {
      kind: "auto",
      enabled: !/(?:turn|switch|set|關|关|取消|停).{0,12}(?:off|auto|自動|自动)|(?:auto|自動|自动).{0,12}(?:off|關|关|取消|停)/iu.test(value),
    };
  }
  if (/(?:night mode|sleep mode|夜間模式|夜间模式|睡眠模式)/iu.test(value)) {
    return {
      kind: "night",
      enabled: !/(?:turn|switch|set|關|关|取消|停).{0,12}(?:off|night|sleep|夜間|夜间|睡眠)|(?:night|sleep|夜間|夜间|睡眠).{0,12}(?:off|關|关|取消|停)/iu.test(value),
    };
  }
  if (/(?:oscillat|swing|擺動|摆动|搖頭|摇头)/iu.test(value)) {
    return {
      kind: "oscillation",
      enabled: !/(?:turn|switch|set|關|关|取消|停).{0,12}(?:off|oscillat|swing|擺動|摆动|搖頭|摇头)|(?:oscillat|swing|擺動|摆动|搖頭|摇头).{0,12}(?:off|關|关|取消|停)/iu.test(value),
    };
  }
  const speed = lower.match(/(?:fan\s*)?(?:speed|level)|風速|风速|檔位|档位|第\s*([1-9]|10)\s*檔/u)
    ? value.match(/(?:speed|level|風速|风速|檔位|档位|第)\D{0,12}(10|[1-9])/iu)
    : value.match(/(?:dyson|purifier|清淨機|清净机|戴森)\D{0,20}(10|[1-9])(?:\s*(?:檔|档))?/iu);
  if (speed) return { kind: "speed", speed: Number(speed[1]) };
  if (/(?:turn|switch|power)[^.!?。！？]{0,40}\boff\b|shut\s*down|關掉|关掉|關閉|关闭|關機|关机/iu.test(value)) {
    return { kind: "power", enabled: false };
  }
  if (/(?:turn|switch|power)[^.!?。！？]{0,40}\bon\b|start(?:\s+the)?(?:\s+dyson|\s+purifier)?|開啟|开启|打開|打开|開機|开机/iu.test(value)) {
    return { kind: "power", enabled: true };
  }
  if (/(?:status|air quality|temperature|humidity|how is|狀態|状态|空氣品質|空气质量|溫度|温度|濕度|湿度|現在|目前)/iu.test(value)) {
    return { kind: "status" };
  }
  throw new Error("Try power, speed 1–10, auto mode, night mode, oscillation, or status.");
}

function flattenState(state = {}) {
  return Object.fromEntries(
    Object.entries(state).map(([key, value]) => [key, Array.isArray(value) ? value[1] : value]),
  );
}

function commandData(intent, current, type) {
  const link = linkProductTypes.has(type);
  if (intent.kind === "power") {
    return link
      ? { fmod: intent.enabled ? (current.fmod === "AUTO" ? "AUTO" : "FAN") : "OFF" }
      : { fpwr: intent.enabled ? "ON" : "OFF" };
  }
  if (intent.kind === "speed") {
    return link
      ? { fmod: "FAN", fnsp: String(intent.speed).padStart(4, "0") }
      : { fpwr: "ON", fnsp: String(intent.speed).padStart(4, "0") };
  }
  if (intent.kind === "auto") {
    return link
      ? { fmod: intent.enabled ? "AUTO" : "FAN" }
      : { auto: intent.enabled ? "ON" : "OFF" };
  }
  if (intent.kind === "night") return { nmod: intent.enabled ? "ON" : "OFF" };
  if (intent.kind === "oscillation") {
    const alternate = typeof current.oson === "string" && current.oson.startsWith("OI");
    return { oson: alternate ? (intent.enabled ? "OION" : "OIOF") : (intent.enabled ? "ON" : "OFF") };
  }
  return null;
}

function mqttTime() {
  return new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function connectClient(config) {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(`mqtt://${config.host}:1883`, {
      protocolVersion: 3,
      username: config.serial,
      password: config.credential,
      clientId: `vox-${randomUUID().replaceAll("-", "").slice(0, 18)}`,
      clean: true,
      connectTimeout: 7_000,
      reconnectPeriod: 0,
    });
    const timer = setTimeout(() => {
      client.end(true);
      reject(new Error("The Dyson purifier did not answer on the local network."));
    }, 8_000);
    const onError = (error) => {
      clearTimeout(timer);
      client.end(true);
      reject(new Error(/not authorized|bad user|bad password|connack/iu.test(error.message)
        ? "The purifier rejected its local device credential."
        : "Vox could not connect to the Dyson purifier on this Wi-Fi network."));
    };
    client.once("error", onError);
    client.once("connect", () => {
      clearTimeout(timer);
      client.off("error", onError);
      resolve(client);
    });
  });
}

async function endClient(client) {
  await new Promise((resolve) => client.end(true, {}, resolve));
}

function publish(client, topic, payload, options = {}) {
  return new Promise((resolve, reject) => {
    client.publish(topic, JSON.stringify(payload), options, (error) => error ? reject(error) : resolve());
  });
}

function summary(config, state, environment, connected) {
  const modernPower = state.fpwr;
  const linkPower = state.fmod;
  const powered = modernPower ? modernPower === "ON" : linkPower ? linkPower !== "OFF" : null;
  const rawTemperature = Number(environment.tact);
  const temperatureC = Number.isFinite(rawTemperature) && rawTemperature > 0
    ? Math.round((rawTemperature / 10 - 273.15) * 10) / 10
    : null;
  const humidity = Number(environment.hact);
  const pm25 = Number(environment.p25r ?? environment.pm25);
  const pm10 = Number(environment.p10r ?? environment.pm10);
  const speed = state.fnsp === "AUTO" ? "auto" : Number(state.fnsp) || null;
  return {
    configured: true,
    connected,
    name: config.name,
    host: config.host,
    serial: config.serial,
    productType: config.productType,
    powered,
    speed,
    autoMode: state.auto ? state.auto === "ON" : state.fmod === "AUTO",
    nightMode: state.nmod ? state.nmod === "ON" : null,
    oscillating: state.oson ? ["ON", "OION"].includes(state.oson) : null,
    temperatureC,
    humidity: Number.isFinite(humidity) ? humidity : null,
    pm25: Number.isFinite(pm25) ? pm25 : null,
    pm10: Number.isFinite(pm10) ? pm10 : null,
  };
}

function answerFor(intent, status, prompt, verified) {
  const zh = taiwanMandarin(prompt);
  const name = status.name;
  if (intent.kind === "status") {
    const facts = [];
    if (status.powered !== null) facts.push(zh ? `目前${status.powered ? "開著" : "關著"}` : `is ${status.powered ? "on" : "off"}`);
    if (status.speed) facts.push(zh ? `風速${status.speed === "auto" ? "自動" : status.speed}` : `fan speed ${status.speed}`);
    if (status.temperatureC !== null) facts.push(zh ? `${status.temperatureC}°C` : `${status.temperatureC}°C`);
    if (status.humidity !== null) facts.push(zh ? `濕度 ${status.humidity}%` : `${status.humidity}% humidity`);
    if (status.pm25 !== null) facts.push(`PM2.5 ${status.pm25}`);
    return zh ? `${name}${facts.length ? facts.join("，") : "已連線，但暫時沒有感測資料"}。` : `${name} ${facts.length ? facts.join(", ") : "is connected, but sensor data is not available yet"}.`;
  }
  const action = intent.kind === "power"
    ? (zh ? (intent.enabled ? "開啟" : "關閉") : (intent.enabled ? "turned on" : "turned off"))
    : intent.kind === "speed"
      ? (zh ? `把風速設為 ${intent.speed}` : `set the fan speed to ${intent.speed}`)
      : intent.kind === "auto"
        ? (zh ? `${intent.enabled ? "開啟" : "關閉"}自動模式` : `${intent.enabled ? "enabled" : "disabled"} auto mode`)
        : intent.kind === "night"
          ? (zh ? `${intent.enabled ? "開啟" : "關閉"}夜間模式` : `${intent.enabled ? "enabled" : "disabled"} night mode`)
          : (zh ? `${intent.enabled ? "開啟" : "關閉"}擺動` : `${intent.enabled ? "enabled" : "disabled"} oscillation`);
  return zh
    ? `${verified ? "已經" : "已送出本機指令，嘗試"}${action} ${name}。`
    : verified
      ? `I ${action} ${name}.`
      : `I sent a local command to ${name}, but could not verify the updated state.`;
}

export async function runDysonCommand(config, prompt) {
  const normalized = normalizeDysonManualConfiguration(config);
  const intent = parseDysonCommand(prompt);
  const client = await connectClient(normalized);
  const commandTopic = `${normalized.productType}/${normalized.serial}/command`;
  const statusTopic = `${normalized.productType}/${normalized.serial}/status/current`;
  let state = {};
  let environment = {};
  let stateRevision = 0;
  client.on("message", (_topic, payload) => {
    try {
      const message = JSON.parse(payload.toString("utf8"));
      if (message?.["product-state"]) {
        state = flattenState(message["product-state"]);
        stateRevision += 1;
      }
      if (message?.data && message.msg === "ENVIRONMENTAL-CURRENT-SENSOR-DATA") {
        environment = flattenState(message.data);
      }
    } catch {
      // Ignore malformed device messages and keep waiting for a valid state update.
    }
  });
  try {
    await new Promise((resolve, reject) => client.subscribe(statusTopic, (error) => error ? reject(error) : resolve()));
    await publish(client, commandTopic, { msg: "REQUEST-CURRENT-STATE", time: mqttTime() });
    await publish(client, commandTopic, {
      msg: "REQUEST-PRODUCT-ENVIRONMENT-CURRENT-SENSOR-DATA",
      time: mqttTime(),
    });
    for (let attempt = 0; attempt < 12 && stateRevision === 0; attempt += 1) await wait(150);

    if (intent.kind !== "status") {
      const beforeRevision = stateRevision;
      await publish(client, commandTopic, {
        msg: "STATE-SET",
        time: mqttTime(),
        "mode-reason": "LAPP",
        data: commandData(intent, state, normalized.productType),
      }, { qos: 1 });
      for (let attempt = 0; attempt < 10 && stateRevision === beforeRevision; attempt += 1) await wait(150);
    } else {
      await wait(700);
    }

    const status = summary(normalized, state, environment, true);
    return {
      ...status,
      answer: answerFor(intent, status, prompt, intent.kind === "status" || stateRevision > 1),
    };
  } finally {
    await endClient(client);
  }
}
