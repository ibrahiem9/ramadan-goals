import { DEFAULT_APP_DATA, RAMADAN_END, RAMADAN_START } from "/src/constants/app.js";
import { TEMPLATES } from "/src/constants/templates.js";
import { clampRamadanDate, getDaysInRange, todayStr } from "/src/lib/date.js";

export function normalizeAppData(raw) {
  const parsed = raw && typeof raw === "object" ? raw : {};
  const merged = {
    ...DEFAULT_APP_DATA,
    ...parsed,
    goals: Array.isArray(parsed.goals) ? parsed.goals : [],
    checkins: parsed.checkins && typeof parsed.checkins === "object" ? parsed.checkins : {},
    groups: Array.isArray(parsed.groups) ? parsed.groups : [],
    userName: typeof parsed.userName === "string" ? parsed.userName : "",
    cloudAuth: {
      ...DEFAULT_APP_DATA.cloudAuth,
      ...(parsed.cloudAuth && typeof parsed.cloudAuth === "object" ? parsed.cloudAuth : {}),
    },
    social: {
      ...DEFAULT_APP_DATA.social,
      ...(parsed.social && typeof parsed.social === "object" ? parsed.social : {}),
    },
    ramadan: {
      ...DEFAULT_APP_DATA.ramadan,
      ...(parsed.ramadan && typeof parsed.ramadan === "object" ? parsed.ramadan : {}),
    },
  };
  return merged;
}

export function buildCircleSnapshot(localData, ramadanWindow, snapshotDate = todayStr()) {
  const rangeStart = ramadanWindow?.start || RAMADAN_START;
  const rangeEnd = ramadanWindow?.end || RAMADAN_END;
  const boundedDate = clampRamadanDate(snapshotDate, { start: rangeStart, end: rangeEnd });
  const daysToDate = getDaysInRange(rangeStart, boundedDate);
  const totalDays = Math.max(daysToDate.length, 1);
  const todayCheckins = localData.checkins[boundedDate] || {};

  const goalProgress = localData.goals.map((goal) => {
    let completedDays = 0;
    daysToDate.forEach((day) => {
      const value = (localData.checkins[day] || {})[goal.id] || 0;
      if (value >= goal.target) completedDays++;
    });
    const completionPctToDate = Number(((completedDays / totalDays) * 100).toFixed(2));
    const todayCompleted = (todayCheckins[goal.id] || 0) >= goal.target;
    return {
      goalId: goal.id,
      title: goal.title,
      target: goal.target,
      unit: goal.unit || "",
      completionPctToDate,
      todayCompleted,
    };
  });

  const overallCompletionPct = goalProgress.length
    ? Number(
        (
          goalProgress.reduce((sum, goal) => sum + goal.completionPctToDate, 0) /
          goalProgress.length
        ).toFixed(2)
      )
    : 0;
  const todayCompletedCount = goalProgress.filter((goal) => goal.todayCompleted).length;

  return {
    snapshotDate: boundedDate,
    overallCompletionPct,
    todayCompletedCount,
    todayTotalGoals: localData.goals.length,
    goalProgress,
  };
}

export function inferGoalIcon(title) {
  const template = TEMPLATES.find((item) => item.title === title);
  return template ? template.icon : "⭐";
}

export function migrateCheckins(checkins, goals) {
  if (!checkins || checkins._migrated) return checkins;
  const migrated = {};
  Object.keys(checkins).forEach((dateStr) => {
    const dayData = checkins[dateStr];
    if (!dayData || typeof dayData !== "object") return;
    const newDay = {};
    Object.keys(dayData).forEach((key) => {
      const idx = parseInt(key, 10);
      if (!isNaN(idx) && idx >= 0 && idx < goals.length) {
        newDay[goals[idx].id] = dayData[key];
      } else {
        newDay[key] = dayData[key];
      }
    });
    migrated[dateStr] = newDay;
  });
  migrated._migrated = true;
  return migrated;
}
