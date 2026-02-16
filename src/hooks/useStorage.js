import { useCallback, useEffect, useState } from "react";

import { DEFAULT_APP_DATA, STORAGE_KEY } from "/src/constants/app.js";
import { migrateCheckins, normalizeAppData } from "/src/lib/data.js";

export function useStorage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const result = await window.storage.get(STORAGE_KEY);
        if (result && result.value) {
          const parsed = normalizeAppData(JSON.parse(result.value));
          if (parsed.goals && parsed.checkins && !parsed.checkins._migrated) {
            parsed.checkins = migrateCheckins(parsed.checkins, parsed.goals);
            await window.storage.set(STORAGE_KEY, JSON.stringify(parsed));
          }
          setData(parsed);
        } else {
          setData({ ...DEFAULT_APP_DATA });
        }
      } catch {
        setData({ ...DEFAULT_APP_DATA });
      }
      setLoading(false);
    }
    load();
  }, []);

  const save = useCallback(async (newData) => {
    setData(newData);
    try {
      await window.storage.set(STORAGE_KEY, JSON.stringify(newData));
    } catch (e) {
      console.error("Storage save failed:", e);
    }
  }, []);

  return { data, save, loading };
}
