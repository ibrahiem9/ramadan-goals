import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ALADHAN_BASE_URL,
  CURRENT_YEAR,
  DEFAULT_APP_DATA,
  RAMADAN_END,
  RAMADAN_START,
} from "/src/constants/app.js";
import {
  buildResolverCacheKey,
  resolveRamadanWindowByLocation,
  resolveRamadanWindowGlobal,
  resolveTargetHijriYear,
  validateRamadanWindow,
} from "/src/lib/ramadanResolver.js";
import { todayStr } from "/src/lib/date.js";

const SOURCE_MODES = new Set(["global", "location", "manual"]);

const FALLBACK_WINDOW = {
  start: RAMADAN_START,
  end: RAMADAN_END,
  seasonYear: CURRENT_YEAR,
};

function normalizeRamadanState(data) {
  return {
    ...DEFAULT_APP_DATA.ramadan,
    ...(data?.ramadan && typeof data.ramadan === "object" ? data.ramadan : {}),
  };
}

function hasPatchChanges(current, patch) {
  return Object.entries(patch).some(([key, value]) => current[key] !== value);
}

export function useRamadanWindow(data, save) {
  const [ramadanWindow, setRamadanWindow] = useState(FALLBACK_WINDOW);
  const [ramadanStatus, setRamadanStatus] = useState("loading");
  const [ramadanError, setRamadanError] = useState("");
  const [resolveNonce, setResolveNonce] = useState(0);

  const ramadanState = useMemo(() => normalizeRamadanState(data), [data]);
  const activeSourceMode = SOURCE_MODES.has(ramadanState.sourceMode)
    ? ramadanState.sourceMode
    : "global";

  const saveRamadanPatch = useCallback((patch) => {
    if (!data) return;
    const current = normalizeRamadanState(data);
    if (!hasPatchChanges(current, patch)) return;
    save({
      ...data,
      ramadan: {
        ...current,
        ...patch,
      },
    });
  }, [data, save]);

  const saveManualRamadanWindow = useCallback((start, end) => {
    const validation = validateRamadanWindow(start, end);
    if (!validation.ok) {
      setRamadanStatus("needs_manual");
      setRamadanError(validation.error);
      return { ok: false, error: validation.error };
    }

    const patch = {
      sourceMode: "manual",
      manualStart: start,
      manualEnd: end,
      resolvedStart: start,
      resolvedEnd: end,
      resolvedSeasonYear: validation.seasonYear,
      resolvedSource: "manual",
      resolvedHijriYear: null,
      resolvedCacheKey: buildResolverCacheKey("manual", "manual", "", ""),
      resolveError: "",
      setupComplete: true,
    };

    saveRamadanPatch(patch);
    setRamadanWindow({
      start,
      end,
      seasonYear: validation.seasonYear,
    });
    setRamadanStatus("ready");
    setRamadanError("");
    return { ok: true, error: "" };
  }, [saveRamadanPatch]);

  const setRamadanSourceMode = useCallback((mode) => {
    if (!SOURCE_MODES.has(mode)) return;
    saveRamadanPatch({
      sourceMode: mode,
      setupComplete: true,
      resolveError: "",
    });
    if (mode !== "manual") {
      setResolveNonce((value) => value + 1);
    }
  }, [saveRamadanPatch]);

  const updateRamadanLocation = useCallback((city, country) => {
    saveRamadanPatch({
      locationCity: String(city || ""),
      locationCountry: String(country || ""),
      setupComplete: true,
      resolveError: "",
    });
    if (activeSourceMode === "location") {
      setResolveNonce((value) => value + 1);
    }
  }, [activeSourceMode, saveRamadanPatch]);

  const retryRamadanResolve = useCallback(() => {
    setResolveNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!data) {
      setRamadanWindow(FALLBACK_WINDOW);
      setRamadanStatus("loading");
      setRamadanError("");
      return;
    }

    const persistedValidation = validateRamadanWindow(
      ramadanState.resolvedStart,
      ramadanState.resolvedEnd
    );
    const persistedWindow = persistedValidation.ok
      ? {
          start: ramadanState.resolvedStart,
          end: ramadanState.resolvedEnd,
          seasonYear: ramadanState.resolvedSeasonYear || persistedValidation.seasonYear,
        }
      : FALLBACK_WINDOW;
    setRamadanWindow(persistedWindow);

    if (activeSourceMode === "manual") {
      const manualValidation = validateRamadanWindow(ramadanState.manualStart, ramadanState.manualEnd);
      if (!manualValidation.ok) {
        setRamadanStatus("needs_manual");
        setRamadanError(manualValidation.error);
        return;
      }

      const manualWindow = {
        start: ramadanState.manualStart,
        end: ramadanState.manualEnd,
        seasonYear: manualValidation.seasonYear,
      };
      setRamadanWindow(manualWindow);
      setRamadanStatus("ready");
      setRamadanError("");
      saveRamadanPatch({
        resolvedStart: manualWindow.start,
        resolvedEnd: manualWindow.end,
        resolvedSeasonYear: manualWindow.seasonYear,
        resolvedSource: "manual",
        resolvedHijriYear: null,
        resolvedCacheKey: buildResolverCacheKey("manual", "manual", "", ""),
        resolveError: "",
      });
      return;
    }

    if (
      activeSourceMode === "location" &&
      (!String(ramadanState.locationCity || "").trim() || !String(ramadanState.locationCountry || "").trim())
    ) {
      const message = "Enter city and country, or switch source mode.";
      setRamadanStatus("ready");
      setRamadanError(message);
      saveRamadanPatch({ resolveError: message });
      return;
    }

    let cancelled = false;

    (async () => {
      setRamadanStatus("loading");
      setRamadanError("");

      try {
        const today = todayStr();
        const targetHijriYear = await resolveTargetHijriYear(today, ALADHAN_BASE_URL);
        const expectedCacheKey = buildResolverCacheKey(
          activeSourceMode,
          targetHijriYear,
          ramadanState.locationCity,
          ramadanState.locationCountry
        );

        if (persistedValidation.ok && ramadanState.resolvedCacheKey === expectedCacheKey) {
          if (cancelled) return;
          setRamadanStatus("ready");
          setRamadanError("");
          if (ramadanState.resolveError) {
            saveRamadanPatch({ resolveError: "" });
          }
          return;
        }

        const resolved = activeSourceMode === "location"
          ? await resolveRamadanWindowByLocation(
              today,
              ramadanState.locationCity,
              ramadanState.locationCountry,
              {
                baseUrl: ALADHAN_BASE_URL,
                targetHijriYear,
              }
            )
          : await resolveRamadanWindowGlobal(today, {
              baseUrl: ALADHAN_BASE_URL,
              targetHijriYear,
            });

        if (cancelled) return;
        setRamadanWindow({
          start: resolved.start,
          end: resolved.end,
          seasonYear: resolved.seasonYear,
        });
        setRamadanStatus("ready");
        setRamadanError("");

        saveRamadanPatch({
          resolvedStart: resolved.start,
          resolvedEnd: resolved.end,
          resolvedSeasonYear: resolved.seasonYear,
          resolvedSource: resolved.source,
          resolvedHijriYear: resolved.hijriYear,
          resolvedCacheKey: resolved.cacheKey,
          resolveError: "",
        });
      } catch (error) {
        if (cancelled) return;
        const message = error?.message || "Failed to resolve Ramadan dates.";
        setRamadanStatus("needs_manual");
        setRamadanError(message);
        saveRamadanPatch({ resolveError: message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSourceMode, data, ramadanState, resolveNonce, saveRamadanPatch]);

  return {
    ramadanWindow,
    ramadanStatus,
    ramadanSourceMode: activeSourceMode,
    ramadanError,
    setRamadanSourceMode,
    updateRamadanLocation,
    saveManualRamadanWindow,
    retryRamadanResolve,
  };
}
