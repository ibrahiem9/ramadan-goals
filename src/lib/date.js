import { RAMADAN_END, RAMADAN_START } from "/src/constants/app.js";

const pad2 = n => String(n).padStart(2, "0");

export function localDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseLocalDate(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayStr() {
  return localDateStr(new Date());
}

export function getDaysInRange(start, end) {
  const days = [];
  let d = parseLocalDate(start);
  const e = parseLocalDate(end);
  while (d <= e) {
    days.push(localDateStr(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

export function getRamadanDay(dateStr, ramadanWindow) {
  const start = ramadanWindow?.start || RAMADAN_START;
  const end = ramadanWindow?.end || RAMADAN_END;
  const startDate = parseLocalDate(start);
  const endDate = parseLocalDate(end);
  const d = parseLocalDate(dateStr);
  if (d < startDate || d > endDate) return null;
  const diff = Math.floor((d - startDate) / 86400000) + 1;
  return diff >= 1 ? diff : null;
}

export function clampRamadanDate(dateStr, ramadanWindow) {
  const start = ramadanWindow?.start || RAMADAN_START;
  const end = ramadanWindow?.end || RAMADAN_END;
  if (dateStr < start) return start;
  if (dateStr > end) return end;
  return dateStr;
}

export function getRamadanWindowSeasonYear(ramadanWindow) {
  const start = ramadanWindow?.start || RAMADAN_START;
  const year = Number(start.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

export function getDefaultRamadanWindow() {
  return {
    start: RAMADAN_START,
    end: RAMADAN_END,
    seasonYear: getRamadanWindowSeasonYear({ start: RAMADAN_START }) || new Date().getFullYear(),
  };
}
