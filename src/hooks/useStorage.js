import { useCallback, useEffect, useState } from "react";

import { DEFAULT_APP_DATA, STORAGE_KEY } from "/src/constants/app.js";
import { migrateCheckins, migrateSalahGoalConfig, normalizeAppData } from "/src/lib/data.js";

export function useStorage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const result = await window.storage.get(STORAGE_KEY);
        if (result && result.value) {
          const parsed = normalizeAppData(JSON.parse(result.value));
          let nextData = parsed;
          let shouldPersist = false;

          if (nextData.goals && nextData.checkins && !nextData.checkins._migrated) {
            nextData = {
              ...nextData,
              checkins: migrateCheckins(nextData.checkins, nextData.goals),
            };
            shouldPersist = true;
          }

          const salahMigration = migrateSalahGoalConfig(nextData.goals, nextData.checkins);
          if (salahMigration.changed) {
            nextData = {
              ...nextData,
              goals: salahMigration.goals,
              checkins: salahMigration.checkins,
            };
            shouldPersist = true;
          }

          if (shouldPersist) {
            await window.storage.set(STORAGE_KEY, JSON.stringify(nextData));
          }
          setData(nextData);
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
