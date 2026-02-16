import { ALADHAN_BASE_URL } from "/src/constants/app.js";
import { getDaysInRange, parseLocalDate, todayStr } from "/src/lib/date.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function trimBaseUrl(baseUrl) {
  return String(baseUrl || ALADHAN_BASE_URL).replace(/\/+$/, "");
}

function toIsoFromDdMmYyyy(value) {
  if (!value || typeof value !== "string") return "";
  const parts = value.split("-").map(Number);
  if (parts.length !== 3) return "";
  const [dd, mm, yyyy] = parts;
  if (!yyyy || !mm || !dd) return "";
  const date = new Date(yyyy, mm - 1, dd);
  if (Number.isNaN(date.getTime())) return "";
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toDdMmYyyyFromIso(value) {
  if (!isIsoDate(value)) return "";
  const [yyyy, mm, dd] = value.split("-");
  return `${dd}-${mm}-${yyyy}`;
}

function subtractOneDay(isoDate) {
  const date = parseLocalDate(isoDate);
  date.setDate(date.getDate() - 1);
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeString(value) {
  return String(value || "").trim();
}

async function fetchAlAdhan(path, params = {}, baseUrl = ALADHAN_BASE_URL) {
  const normalizedBase = trimBaseUrl(baseUrl);
  const url = new URL(`${normalizedBase}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    const normalized = String(value).trim();
    if (!normalized) return;
    url.searchParams.set(key, normalized);
  });

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`AlAdhan request failed (${response.status}).`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("AlAdhan response was not valid JSON.");
  }

  if (payload?.code && Number(payload.code) !== 200) {
    throw new Error(payload?.status || "AlAdhan returned a non-success response.");
  }

  return payload;
}

function getYearMonthTriplet(year, month) {
  const result = [];
  for (let offset = -1; offset <= 1; offset++) {
    const cursor = new Date(year, month - 1 + offset, 1);
    result.push({
      year: cursor.getFullYear(),
      month: cursor.getMonth() + 1,
    });
  }
  return result;
}

function normalizeCityCountry(city, country) {
  return {
    city: normalizeString(city),
    country: normalizeString(country),
  };
}

export function isIsoDate(value) {
  if (!ISO_DATE_RE.test(String(value || ""))) return false;
  const parsed = parseLocalDate(String(value));
  return !Number.isNaN(parsed.getTime());
}

export function validateRamadanWindow(start, end) {
  const normalizedStart = normalizeString(start);
  const normalizedEnd = normalizeString(end);

  if (!isIsoDate(normalizedStart) || !isIsoDate(normalizedEnd)) {
    return { ok: false, error: "Enter dates in YYYY-MM-DD format." };
  }

  if (normalizedEnd < normalizedStart) {
    return { ok: false, error: "End date must be on or after start date." };
  }

  const days = getDaysInRange(normalizedStart, normalizedEnd).length;
  if (days < 29 || days > 30) {
    return { ok: false, error: "Ramadan date range must be 29 or 30 days." };
  }

  return {
    ok: true,
    error: "",
    seasonYear: Number(normalizedStart.slice(0, 4)),
    days,
  };
}

export function buildResolverCacheKey(mode, targetHijriYear, city = "", country = "") {
  const locationPart = mode === "location"
    ? `${normalizeString(city).toLowerCase()}|${normalizeString(country).toLowerCase()}`
    : "global";
  return `${mode}|${targetHijriYear || ""}|${locationPart}`;
}

export async function resolveTargetHijriYear(todayIso = todayStr(), baseUrl = ALADHAN_BASE_URL) {
  const todayDdMmYyyy = toDdMmYyyyFromIso(todayIso);
  if (!todayDdMmYyyy) {
    throw new Error("Could not compute today's date for Hijri resolution.");
  }

  const payload = await fetchAlAdhan(`/gToH/${todayDdMmYyyy}`, {}, baseUrl);
  const hijriMonth = Number(payload?.data?.hijri?.month?.number || 0);
  const hijriYear = Number(payload?.data?.hijri?.year || 0);
  if (!hijriMonth || !hijriYear) {
    throw new Error("AlAdhan did not return a valid Hijri month/year.");
  }

  return hijriMonth <= 9 ? hijriYear : hijriYear + 1;
}

export async function resolveRamadanWindowGlobal(todayIso = todayStr(), options = {}) {
  const baseUrl = options.baseUrl || ALADHAN_BASE_URL;
  const targetHijriYear =
    options.targetHijriYear || (await resolveTargetHijriYear(todayIso, baseUrl));

  const [startPayload, shawwalPayload] = await Promise.all([
    fetchAlAdhan(`/hToG/01-09-${targetHijriYear}`, {}, baseUrl),
    fetchAlAdhan(`/hToG/01-10-${targetHijriYear}`, {}, baseUrl),
  ]);

  const start = toIsoFromDdMmYyyy(startPayload?.data?.gregorian?.date || "");
  const shawwalStart = toIsoFromDdMmYyyy(shawwalPayload?.data?.gregorian?.date || "");
  if (!start || !shawwalStart) {
    throw new Error("AlAdhan did not return valid Gregorian Ramadan boundaries.");
  }

  const end = subtractOneDay(shawwalStart);
  const validation = validateRamadanWindow(start, end);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  return {
    start,
    end,
    seasonYear: validation.seasonYear,
    hijriYear: targetHijriYear,
    source: "api-global",
    cacheKey: buildResolverCacheKey("global", targetHijriYear),
  };
}

export async function resolveRamadanWindowByLocation(
  todayIso = todayStr(),
  city,
  country,
  options = {}
) {
  const { city: normalizedCity, country: normalizedCountry } = normalizeCityCountry(city, country);
  if (!normalizedCity || !normalizedCountry) {
    throw new Error("City and country are required for location-based date resolution.");
  }

  const baseUrl = options.baseUrl || ALADHAN_BASE_URL;
  const targetHijriYear =
    options.targetHijriYear || (await resolveTargetHijriYear(todayIso, baseUrl));

  const globalWindow = await resolveRamadanWindowGlobal(todayIso, {
    baseUrl,
    targetHijriYear,
  });

  const startDate = parseLocalDate(globalWindow.start);
  const candidates = getYearMonthTriplet(startDate.getFullYear(), startDate.getMonth() + 1);

  const calendarResponses = await Promise.all(
    candidates.map(({ year, month }) =>
      fetchAlAdhan(`/calendarByCity/${year}/${month}`, {
        city: normalizedCity,
        country: normalizedCountry,
      }, baseUrl)
    )
  );

  const ramadanDays = new Set();
  calendarResponses.forEach((payload) => {
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    rows.forEach((row) => {
      const hijriMonth = Number(row?.hijri?.month?.number || 0);
      const hijriYear = Number(row?.hijri?.year || 0);
      if (hijriMonth !== 9 || hijriYear !== targetHijriYear) return;
      const iso = toIsoFromDdMmYyyy(row?.gregorian?.date || "");
      if (iso) ramadanDays.add(iso);
    });
  });

  const sortedDays = [...ramadanDays].sort();
  if (!sortedDays.length) {
    throw new Error("No Ramadan dates were returned for the selected location.");
  }

  const start = sortedDays[0];
  const end = sortedDays[sortedDays.length - 1];
  const validation = validateRamadanWindow(start, end);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  return {
    start,
    end,
    seasonYear: validation.seasonYear,
    hijriYear: targetHijriYear,
    source: "api-location",
    cacheKey: buildResolverCacheKey("location", targetHijriYear, normalizedCity, normalizedCountry),
  };
}
