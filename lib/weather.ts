// Weather for the dashboard: the pure parts. The place is approximate (from
// the network, not GPS) and the numbers come from Open-Meteo.

/** A short English condition for a WMO weather interpretation code. */
export function weatherCondition(code: unknown): string {
  switch (typeof code === "number" && Number.isInteger(code) ? code : -1) {
    case 0:
      return "Clear";
    case 1:
      return "Mostly clear";
    case 2:
      return "Partly cloudy";
    case 3:
      return "Overcast";
    case 45:
    case 48:
      return "Fog";
    case 51:
    case 53:
    case 55:
      return "Drizzle";
    case 56:
    case 57:
      return "Freezing drizzle";
    case 61:
      return "Light rain";
    case 63:
      return "Rain";
    case 65:
      return "Heavy rain";
    case 66:
    case 67:
      return "Freezing rain";
    case 71:
      return "Light snow";
    case 73:
      return "Snow";
    case 75:
      return "Heavy snow";
    case 77:
      return "Snow grains";
    case 80:
      return "Light showers";
    case 81:
      return "Showers";
    case 82:
      return "Heavy showers";
    case 85:
    case 86:
      return "Snow showers";
    case 95:
      return "Thunderstorm";
    case 96:
    case 99:
      return "Thunderstorm with hail";
    default:
      return "Unknown";
  }
}

/** "HH:MM" from Open-Meteo's local-time string ("2026-10-07T05:52"), or null. */
export function localClockTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})(?::\d{2})?$/u.exec(value.trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return `${match[1]}:${match[2]}`;
}

/** "City, CC" when the city is known, else null. */
export function weatherPlace(city: unknown, country: unknown): string | null {
  const name = typeof city === "string" ? city.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/gu, " ").trim().slice(0, 80) : "";
  if (!name) return null;
  const code = typeof country === "string" && /^[A-Za-z]{2}$/u.test(country.trim()) ? country.trim().toUpperCase() : "";
  return code ? `${name}, ${code}` : name;
}

/**
 * Latitude and longitude rounded to 2 decimals (about a kilometre), which is
 * all that is sent to the weather service. Null when they aren't a real place.
 */
export function approximateCoordinates(latitude: unknown, longitude: unknown): { latitude: number; longitude: number } | null {
  const parse = (value: unknown) =>
    typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  const lat = parse(latitude);
  const lon = parse(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const round = (value: number) => Math.round(value * 100) / 100 + 0;
  return { latitude: round(lat), longitude: round(lon) };
}

export function openMeteoUrl(coordinates: { latitude: number; longitude: number }) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", coordinates.latitude.toFixed(2));
  url.searchParams.set("longitude", coordinates.longitude.toFixed(2));
  url.searchParams.set("current", "temperature_2m,apparent_temperature,weather_code,is_day");
  url.searchParams.set("daily", "sunrise,sunset");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");
  return url.toString();
}
