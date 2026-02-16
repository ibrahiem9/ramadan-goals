export const STORAGE_KEY = "ramadan-goals-v1";
export const CURRENT_YEAR = 2026;
export const RAMADAN_START = "2026-02-27";
export const RAMADAN_END = "2026-03-28";
export const RAMADAN_DEFAULT_CITY = window.__APP_CONFIG__?.RAMADAN_DEFAULT_CITY || "";
export const RAMADAN_DEFAULT_COUNTRY = window.__APP_CONFIG__?.RAMADAN_DEFAULT_COUNTRY || "";
export const ALADHAN_BASE_URL = window.__APP_CONFIG__?.ALADHAN_BASE_URL || "https://api.aladhan.com/v1";
export const MAX_CIRCLE_MEMBERS = 12;
export const REACTION_EMOJIS = ["🤲", "💪", "✨", "🌙"];

export const DEFAULT_APP_DATA = {
  goals: [],
  checkins: {},
  groups: [],
  userName: "",
  cloudAuth: {
    userId: null,
    email: "",
    sessionPresent: false,
    seededAt: null,
    lastSyncAt: null,
  },
  social: {
    activeCircleId: null,
  },
  ramadan: {
    sourceMode: "global",
    locationCity: RAMADAN_DEFAULT_CITY,
    locationCountry: RAMADAN_DEFAULT_COUNTRY,
    manualStart: "",
    manualEnd: "",
    resolvedStart: RAMADAN_START,
    resolvedEnd: RAMADAN_END,
    resolvedSeasonYear: CURRENT_YEAR,
    resolvedSource: "fallback",
    resolvedHijriYear: null,
    resolvedCacheKey: "",
    resolveError: "",
    setupComplete: false,
  },
};

export const SUPABASE_URL = window.__APP_CONFIG__?.SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = window.__APP_CONFIG__?.SUPABASE_ANON_KEY || "";
export const HAS_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
