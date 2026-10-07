import { requireUser } from "@/lib/auth";
import type { DashboardWeather } from "@/lib/dashboard";
import { approximateCoordinates, localClockTime, openMeteoUrl, weatherCondition, weatherPlace } from "@/lib/weather";

// Weather for roughly where the request comes from. The place is Cloudflare's
// guess from the network (never GPS), rounded before it leaves for Open-Meteo.

const WEATHER_TIMEOUT_MS = 5_000;

type CloudflareLocation = { latitude?: unknown; longitude?: unknown; city?: unknown; country?: unknown; timezone?: unknown };
type OpenMeteoForecast = {
  current?: { temperature_2m?: unknown; apparent_temperature?: unknown; weather_code?: unknown; is_day?: unknown };
  daily?: { sunrise?: unknown; sunset?: unknown };
};

function unavailable() {
  const body: DashboardWeather = { available: false };
  // Not cached, so the weather appears as soon as it can be looked up again.
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

function first(value: unknown) {
  return Array.isArray(value) ? value[0] : undefined;
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  const cf = (request as unknown as { cf?: CloudflareLocation }).cf;
  const coordinates = cf ? approximateCoordinates(cf.latitude, cf.longitude) : null;
  if (!cf || !coordinates) return unavailable();

  try {
    const response = await fetch(openMeteoUrl(coordinates), { signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);
    const forecast = (await response.json()) as OpenMeteoForecast;
    const current = forecast.current ?? {};
    const temperature = current.temperature_2m;
    if (typeof temperature !== "number" || !Number.isFinite(temperature)) throw new Error("No current temperature");
    const feelsLike = current.apparent_temperature;
    const body: DashboardWeather = {
      available: true,
      place: weatherPlace(cf.city, cf.country),
      temperatureC: temperature,
      feelsLikeC: typeof feelsLike === "number" && Number.isFinite(feelsLike) ? feelsLike : temperature,
      condition: weatherCondition(current.weather_code),
      isDay: current.is_day !== 0,
      sunrise: localClockTime(first(forecast.daily?.sunrise)),
      sunset: localClockTime(first(forecast.daily?.sunset)),
    };
    return Response.json(body, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (error) {
    console.error("Weather lookup failed", error instanceof Error ? error.message : "unknown");
    return unavailable();
  }
}
