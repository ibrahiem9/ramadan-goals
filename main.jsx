import { useState, useEffect, useCallback, useRef } from "react";

import {
  CURRENT_YEAR,
  DEFAULT_APP_DATA,
  RAMADAN_DEFAULT_CITY,
  RAMADAN_DEFAULT_COUNTRY,
  STORAGE_KEY,
} from "/src/constants/app.js";
import { TEMPLATES } from "/src/constants/templates.js";
import { getDaysInRange, getRamadanDay, todayStr } from "/src/lib/date.js";
import { generateId } from "/src/lib/ids.js";
import { validateRamadanWindow } from "/src/lib/ramadanResolver.js";
import { useRamadanWindow } from "/src/hooks/useRamadanWindow.js";
import { useStorage } from "/src/hooks/useStorage.js";
import { useSupabaseSocial } from "/src/social/useSupabaseSocial.js";

const RAMADAN_SOURCE_MODES = ["global", "location", "manual"];

function normalizeRamadanSourceMode(mode) {
  return RAMADAN_SOURCE_MODES.includes(mode) ? mode : "global";
}

function getCountGoalTarget(goal) {
  const target = Number(goal?.target);
  return Number.isFinite(target) && target > 0 ? target : 1;
}

function clampCountGoalValue(goal, value) {
  const numericValue = Number(value);
  const safeValue = Number.isFinite(numericValue) ? numericValue : 0;
  const nonNegativeValue = Math.max(0, safeValue);

  if (goal?.fixed) {
    return Math.min(nonNegativeValue, getCountGoalTarget(goal));
  }

  return nonNegativeValue;
}

// ─── Animated Counter ───────────────────────────────
function AnimatedNumber({ value, max }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <div style={{ position: "relative", width: 48, height: 48 }}>
      <svg width="48" height="48" viewBox="0 0 48 48">
        <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="3" />
        <circle
          cx="24" cy="24" r="20" fill="none"
          stroke={pct >= 1 ? "#86efac" : "#fcd34d"}
          strokeWidth="3"
          strokeDasharray={`${pct * 125.6} 125.6`}
          strokeLinecap="round"
          transform="rotate(-90 24 24)"
          style={{ transition: "stroke-dasharray 0.5s cubic-bezier(.4,0,.2,1), stroke 0.3s" }}
        />
      </svg>
      <span style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: 13, fontWeight: 700,
        color: pct >= 1 ? "#86efac" : "#fff", fontFamily: "'DM Sans', sans-serif",
        transition: "color 0.3s"
      }}>{value}</span>
    </div>
  );
}

// ─── Goal Card ──────────────────────────────────────
function GoalCard({ goal, value, onTap, onLongPress, completed }) {
  const [pressed, setPressed] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const longRef = useRef(null);

  const handleDown = () => {
    setPressed(true);
    longRef.current = setTimeout(() => {
      onLongPress && onLongPress();
      longRef.current = null;
    }, 500);
  };

  const handleUp = () => {
    setPressed(false);
    if (longRef.current) {
      clearTimeout(longRef.current);
      longRef.current = null;
      onTap();
      if (value + 1 >= goal.target && !completed) {
        setCelebrate(true);
        setTimeout(() => setCelebrate(false), 800);
      }
    }
  };

  return (
    <div
      onPointerDown={handleDown}
      onPointerUp={handleUp}
      onPointerLeave={() => { setPressed(false); clearTimeout(longRef.current); }}
      style={{
        background: completed
          ? "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(34,197,94,0.08))"
          : "linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))",
        borderRadius: 20,
        padding: "18px 20px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        cursor: "pointer",
        userSelect: "none",
        WebkitUserSelect: "none",
        transform: pressed ? "scale(0.97)" : celebrate ? "scale(1.03)" : "scale(1)",
        transition: "transform 0.2s cubic-bezier(.4,0,.2,1), background 0.4s",
        border: completed ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(255,255,255,0.06)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {celebrate && (
        <div style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(circle at center, rgba(134,239,172,0.2), transparent 70%)",
          animation: "celebratePulse 0.8s ease-out",
          pointerEvents: "none",
        }} />
      )}
      <span style={{ fontSize: 28, lineHeight: 1 }}>{goal.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 15, fontWeight: 600, color: "#fff",
          fontFamily: "'DM Sans', sans-serif",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{goal.title}</div>
        <div style={{
          fontSize: 12, color: "rgba(255,255,255,0.45)", marginTop: 2,
          fontFamily: "'DM Sans', sans-serif",
        }}>
          {goal.type === "boolean"
            ? (completed ? "Done ✓" : "Tap to complete")
            : `${value} / ${goal.target} ${goal.unit}`}
        </div>
      </div>
      {goal.type === "count" ? (
        <AnimatedNumber value={value} max={goal.target} />
      ) : (
        <div style={{
          width: 44, height: 44, borderRadius: 22,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: completed ? "rgba(34,197,94,0.25)" : "rgba(255,255,255,0.08)",
          transition: "background 0.3s",
          fontSize: 20,
        }}>
          {completed ? "✓" : "○"}
        </div>
      )}
    </div>
  );
}

// ─── Heatmap ────────────────────────────────────────
function Heatmap({ checkins, goals, onDayTap, ramadanWindow }) {
  const days = getDaysInRange(ramadanWindow.start, ramadanWindow.end);
  const today = todayStr();

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6,
      padding: "0 4px",
    }}>
      {days.map((day, i) => {
        const dayCheckins = checkins[day] || {};
        const totalGoals = goals.length || 1;
        const completed = goals.filter(g => (dayCheckins[g.id] || 0) >= g.target).length;
        const pct = goals.length > 0 ? completed / totalGoals : 0;
        const isFuture = day > today;
        const isToday = day === today;
        const tappable = !isFuture && onDayTap;

        return (
          <div
            key={day}
            onClick={tappable ? () => onDayTap(day) : undefined}
            style={{
              aspectRatio: "1", borderRadius: 8,
              background: isFuture
                ? "rgba(255,255,255,0.03)"
                : pct === 0
                  ? "rgba(255,255,255,0.06)"
                  : `rgba(34,197,94,${0.15 + pct * 0.55})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 600,
              color: isToday ? "#fcd34d" : isFuture ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.5)",
              fontFamily: "'DM Sans', sans-serif",
              border: isToday ? "2px solid rgba(252,211,77,0.5)" : "2px solid transparent",
              transition: "background 0.3s, transform 0.15s",
              cursor: tappable ? "pointer" : "default",
            }}
          >
            {i + 1}
          </div>
        );
      })}
    </div>
  );
}

// ─── Goal Streak Badge ──────────────────────────────
function StreakBadge({ checkins, goalId, goal, ramadanWindow }) {
  let streak = 0;
  const boundedToday = todayStr() < ramadanWindow.start
    ? ramadanWindow.start
    : todayStr() > ramadanWindow.end
      ? ramadanWindow.end
      : todayStr();
  const days = getDaysInRange(ramadanWindow.start, boundedToday);
  for (let i = days.length - 1; i >= 0; i--) {
    const dc = checkins[days[i]];
    if (dc && dc[goalId] >= goal.target) streak++;
    else break;
  }
  if (streak === 0) return null;
  return (
    <span style={{
      background: "linear-gradient(135deg, #f59e0b, #d97706)",
      color: "#fff", fontSize: 11, fontWeight: 700,
      padding: "2px 8px", borderRadius: 10,
      fontFamily: "'DM Sans', sans-serif",
    }}>🔥 {streak} day streak</span>
  );
}

// ─── Add Goal Modal ─────────────────────────────────
function AddGoalModal({ onAdd, onClose }) {
  const [step, setStep] = useState("pick");
  const [custom, setCustom] = useState({ title: "", icon: "⭐", type: "boolean", target: 1, unit: "" });

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
      animation: "fadeIn 0.2s ease-out",
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "linear-gradient(180deg, #1e293b, #0f172a)",
        borderRadius: "24px 24px 0 0", width: "100%", maxWidth: 480,
        maxHeight: "80vh", overflow: "auto",
        padding: "24px 20px 40px", animation: "slideUp 0.3s cubic-bezier(.4,0,.2,1)",
      }}>
        <div style={{
          width: 40, height: 4, background: "rgba(255,255,255,0.2)",
          borderRadius: 2, margin: "0 auto 20px",
        }} />
        {step === "pick" ? (
          <>
            <h3 style={{
              fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 16,
              fontFamily: "'Playfair Display', serif",
            }}>Add a Goal</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {TEMPLATES.map((t, i) => (
                <button key={i} onClick={() => onAdd({ ...t, id: generateId() })} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 14, padding: "14px 16px", cursor: "pointer",
                  color: "#fff", textAlign: "left",
                }}>
                  <span style={{ fontSize: 24 }}>{t.icon}</span>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>{t.title}</div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontFamily: "'DM Sans', sans-serif" }}>
                      {t.type === "boolean" ? "Daily yes/no" : `Target: ${t.target} ${t.unit}/day`}
                    </div>
                  </div>
                </button>
              ))}
              <button onClick={() => setStep("custom")} style={{
                display: "flex", alignItems: "center", gap: 12,
                background: "rgba(139,92,246,0.12)", border: "1px dashed rgba(139,92,246,0.4)",
                borderRadius: 14, padding: "14px 16px", cursor: "pointer",
                color: "#a78bfa", textAlign: "left",
              }}>
                <span style={{ fontSize: 24 }}>✨</span>
                <div style={{ fontSize: 15, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>Custom goal…</div>
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 style={{
              fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 16,
              fontFamily: "'Playfair Display', serif",
            }}>Custom Goal</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input
                placeholder="Goal title"
                value={custom.title}
                onChange={e => setCustom(c => ({ ...c, title: e.target.value }))}
                style={{
                  background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 12, padding: "12px 16px", color: "#fff", fontSize: 15,
                  fontFamily: "'DM Sans', sans-serif", outline: "none",
                }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setCustom(c => ({ ...c, type: "boolean", target: 1, unit: "" }))}
                  style={{
                    flex: 1, padding: "10px", borderRadius: 10, cursor: "pointer",
                    background: custom.type === "boolean" ? "rgba(34,197,94,0.2)" : "rgba(255,255,255,0.06)",
                    border: custom.type === "boolean" ? "1px solid rgba(34,197,94,0.4)" : "1px solid rgba(255,255,255,0.08)",
                    color: "#fff", fontSize: 13, fontFamily: "'DM Sans', sans-serif",
                  }}
                >Yes / No</button>
                <button
                  onClick={() => setCustom(c => ({ ...c, type: "count", target: 5, unit: "times" }))}
                  style={{
                    flex: 1, padding: "10px", borderRadius: 10, cursor: "pointer",
                    background: custom.type === "count" ? "rgba(34,197,94,0.2)" : "rgba(255,255,255,0.06)",
                    border: custom.type === "count" ? "1px solid rgba(34,197,94,0.4)" : "1px solid rgba(255,255,255,0.08)",
                    color: "#fff", fontSize: 13, fontFamily: "'DM Sans', sans-serif",
                  }}
                >Counter</button>
              </div>
              {custom.type === "count" && (
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="number" placeholder="Target" value={custom.target}
                    onChange={e => setCustom(c => ({ ...c, target: parseInt(e.target.value) || 1 }))}
                    style={{
                      flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 12, padding: "10px 14px", color: "#fff", fontSize: 14,
                      fontFamily: "'DM Sans', sans-serif", outline: "none",
                    }}
                  />
                  <input
                    placeholder="Unit (pages, min…)"
                    value={custom.unit}
                    onChange={e => setCustom(c => ({ ...c, unit: e.target.value }))}
                    style={{
                      flex: 1, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 12, padding: "10px 14px", color: "#fff", fontSize: 14,
                      fontFamily: "'DM Sans', sans-serif", outline: "none",
                    }}
                  />
                </div>
              )}
              <button
                disabled={!custom.title.trim()}
                onClick={() => {
                  onAdd({ ...custom, id: generateId() });
                }}
                style={{
                  background: custom.title.trim() ? "linear-gradient(135deg, #22c55e, #16a34a)" : "rgba(255,255,255,0.08)",
                  border: "none", borderRadius: 14, padding: "14px",
                  color: "#fff", fontSize: 16, fontWeight: 700, cursor: custom.title.trim() ? "pointer" : "default",
                  fontFamily: "'DM Sans', sans-serif", marginTop: 4,
                  opacity: custom.title.trim() ? 1 : 0.4,
                }}
              >Add Goal</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Edit Value Modal ───────────────────────────────
function EditValueModal({ goal, value, onSave, onDelete, onClose }) {
  const [val, setVal] = useState(value);
  const countTarget = getCountGoalTarget(goal);
  const disableIncrement = goal.type === "count" && goal.fixed && val >= countTarget;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "fadeIn 0.2s",
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "linear-gradient(180deg, #1e293b, #0f172a)",
        borderRadius: 24, padding: "28px 24px", width: "85%", maxWidth: 340,
        animation: "scaleIn 0.25s cubic-bezier(.4,0,.2,1)",
      }}>
        <div style={{ fontSize: 28, textAlign: "center", marginBottom: 8 }}>{goal.icon}</div>
        <h3 style={{
          fontSize: 18, fontWeight: 700, color: "#fff", textAlign: "center",
          fontFamily: "'Playfair Display', serif", marginBottom: 20,
        }}>{goal.title}</h3>
        {goal.type === "boolean" ? (
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 20 }}>
            {[0, 1].map(v => (
              <button key={v} onClick={() => setVal(v)} style={{
                width: 80, height: 80, borderRadius: 20, fontSize: 32,
                background: val === v ? (v === 1 ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.15)") : "rgba(255,255,255,0.06)",
                border: val === v ? `2px solid ${v === 1 ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.3)"}` : "2px solid transparent",
                cursor: "pointer", color: "#fff",
                transition: "all 0.2s",
              }}>{v === 1 ? "✓" : "✗"}</button>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 20 }}>
            <button onClick={() => setVal((prev) => clampCountGoalValue(goal, prev - 1))} style={{
              width: 48, height: 48, borderRadius: 16, background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)", color: "#fff", fontSize: 24,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}>−</button>
            <span style={{
              fontSize: 36, fontWeight: 700, color: "#fff", fontFamily: "'DM Sans', sans-serif",
              minWidth: 60, textAlign: "center",
            }}>{val}</span>
            <button
              disabled={disableIncrement}
              onClick={() => setVal((prev) => clampCountGoalValue(goal, prev + 1))}
              style={{
              width: 48, height: 48, borderRadius: 16, background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)", color: "#fff", fontSize: 24,
              cursor: disableIncrement ? "default" : "pointer",
              opacity: disableIncrement ? 0.45 : 1,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
            >+</button>
          </div>
        )}
        <button onClick={() => onSave(goal.type === "count" ? clampCountGoalValue(goal, val) : (val >= 1 ? 1 : 0))} style={{
          width: "100%", background: "linear-gradient(135deg, #22c55e, #16a34a)",
          border: "none", borderRadius: 14, padding: "14px", color: "#fff",
          fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
        }}>Save</button>
        <button onClick={onDelete} style={{
          width: "100%", background: "none", border: "none", color: "rgba(239,68,68,0.7)",
          fontSize: 13, cursor: "pointer", marginTop: 12, fontFamily: "'DM Sans', sans-serif",
          padding: 8,
        }}>Remove this goal</button>
      </div>
    </div>
  );
}

// ─── Settings Modal ────────────────────────────────
function SettingsModal({ data, save, ramadanWindow, ramadanTools, onClose, onReset }) {
  const [editName, setEditName] = useState(data.userName);
  const [confirmReset, setConfirmReset] = useState(false);
  const [sourceMode, setSourceMode] = useState(
    normalizeRamadanSourceMode(data.ramadan?.sourceMode || ramadanTools.ramadanSourceMode)
  );
  const [locationCity, setLocationCity] = useState(data.ramadan?.locationCity || RAMADAN_DEFAULT_CITY);
  const [locationCountry, setLocationCountry] = useState(data.ramadan?.locationCountry || RAMADAN_DEFAULT_COUNTRY);
  const [manualStart, setManualStart] = useState(data.ramadan?.manualStart || "");
  const [manualEnd, setManualEnd] = useState(data.ramadan?.manualEnd || "");
  const [ramadanMessage, setRamadanMessage] = useState("");
  const nameDirty = editName.trim() && editName.trim() !== data.userName;

  const handleSaveName = () => {
    if (nameDirty) {
      save({ ...data, userName: editName.trim() });
    }
  };

  const handleSaveRamadanMode = async () => {
    setRamadanMessage("");

    if (sourceMode === "manual") {
      const result = ramadanTools.saveManualRamadanWindow(manualStart.trim(), manualEnd.trim());
      if (!result.ok) {
        setRamadanMessage(result.error);
        return;
      }
      setRamadanMessage("Manual Ramadan dates saved.");
      return;
    }

    if (sourceMode === "location") {
      if (!locationCity.trim() || !locationCountry.trim()) {
        setRamadanMessage("City and country are required for location mode.");
        return;
      }
      ramadanTools.updateRamadanLocation(locationCity.trim(), locationCountry.trim());
    }

    ramadanTools.setRamadanSourceMode(sourceMode);
    ramadanTools.retryRamadanResolve();
    setRamadanMessage("Ramadan date source updated.");
  };

  const handleReset = async () => {
    try {
      await window.storage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.error("Storage clear failed:", e);
    }
    onReset();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "fadeIn 0.2s",
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "linear-gradient(180deg, #1e293b, #0f172a)",
        borderRadius: 24, padding: "28px 24px", width: "88%", maxWidth: 380,
        maxHeight: "85vh", overflow: "auto",
        animation: "scaleIn 0.25s cubic-bezier(.4,0,.2,1)",
      }}>
        <h3 style={{
          fontSize: 20, fontWeight: 700, color: "#fff",
          fontFamily: "'Playfair Display', serif", marginBottom: 24, textAlign: "center",
        }}>Settings</h3>

        <div style={{ marginBottom: 24 }}>
          <div style={{
            fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.4)",
            fontFamily: "'DM Sans', sans-serif", marginBottom: 8, textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}>Display Name</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              style={{
                flex: 1, background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12,
                padding: "10px 14px", color: "#fff", fontSize: 15,
                fontFamily: "'DM Sans', sans-serif", outline: "none",
              }}
            />
            <button
              disabled={!nameDirty}
              onClick={handleSaveName}
              style={{
                padding: "10px 16px", borderRadius: 12, border: "none",
                background: nameDirty ? "linear-gradient(135deg, #22c55e, #16a34a)" : "rgba(255,255,255,0.06)",
                color: "#fff", fontSize: 14, fontWeight: 600, cursor: nameDirty ? "pointer" : "default",
                fontFamily: "'DM Sans', sans-serif", opacity: nameDirty ? 1 : 0.4,
                transition: "opacity 0.2s, background 0.2s",
              }}
            >Save</button>
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <div style={{
            fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.4)",
            fontFamily: "'DM Sans', sans-serif", marginBottom: 8, textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}>Ramadan Dates</div>
          <div style={{
            fontSize: 12, color: "rgba(255,255,255,0.55)", marginBottom: 10,
            fontFamily: "'DM Sans', sans-serif",
          }}>
            Current window: {ramadanWindow.start} to {ramadanWindow.end} ({ramadanWindow.seasonYear})
          </div>
          <div style={{
            fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 10,
            fontFamily: "'DM Sans', sans-serif",
          }}>
            Status: {ramadanTools.ramadanStatus}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
            {RAMADAN_SOURCE_MODES.map((mode) => (
              <button key={mode} onClick={() => setSourceMode(mode)} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                background: sourceMode === mode ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.04)",
                border: sourceMode === mode ? "1px solid rgba(34,197,94,0.35)" : "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12, padding: "10px 12px", cursor: "pointer", color: "#fff",
                fontFamily: "'DM Sans', sans-serif", textTransform: "capitalize",
              }}>
                <span>{mode === "global" ? "Global API" : mode === "location" ? "Location-Based API" : "Manual Dates"}</span>
                <span>{sourceMode === mode ? "✓" : ""}</span>
              </button>
            ))}
          </div>

          {sourceMode === "location" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
              <input
                placeholder="City"
                value={locationCity}
                onChange={(e) => setLocationCity(e.target.value)}
                style={{
                  width: "100%", background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12,
                  padding: "10px 12px", color: "#fff", fontSize: 14,
                  fontFamily: "'DM Sans', sans-serif", outline: "none",
                }}
              />
              <input
                placeholder="Country"
                value={locationCountry}
                onChange={(e) => setLocationCountry(e.target.value)}
                style={{
                  width: "100%", background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12,
                  padding: "10px 12px", color: "#fff", fontSize: 14,
                  fontFamily: "'DM Sans', sans-serif", outline: "none",
                }}
              />
            </div>
          )}

          {sourceMode === "manual" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
              <input
                placeholder="Start date (YYYY-MM-DD)"
                value={manualStart}
                onChange={(e) => setManualStart(e.target.value)}
                style={{
                  width: "100%", background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12,
                  padding: "10px 12px", color: "#fff", fontSize: 14,
                  fontFamily: "'DM Sans', sans-serif", outline: "none",
                }}
              />
              <input
                placeholder="End date (YYYY-MM-DD)"
                value={manualEnd}
                onChange={(e) => setManualEnd(e.target.value)}
                style={{
                  width: "100%", background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12,
                  padding: "10px 12px", color: "#fff", fontSize: 14,
                  fontFamily: "'DM Sans', sans-serif", outline: "none",
                }}
              />
            </div>
          )}

          {ramadanTools.ramadanError && (
            <div style={{
              fontSize: 12, color: "#fca5a5", marginBottom: 10,
              fontFamily: "'DM Sans', sans-serif",
            }}>{ramadanTools.ramadanError}</div>
          )}
          {ramadanMessage && (
            <div style={{
              fontSize: 12, color: "#86efac", marginBottom: 10,
              fontFamily: "'DM Sans', sans-serif",
            }}>{ramadanMessage}</div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleSaveRamadanMode} style={{
              flex: 1, padding: "10px 12px",
              background: "linear-gradient(135deg, #22c55e, #16a34a)",
              border: "none", borderRadius: 12, color: "#fff", fontSize: 14, fontWeight: 700,
              cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
            }}>Save Source</button>
            {(sourceMode === "global" || sourceMode === "location") && (
              <button onClick={ramadanTools.retryRamadanResolve} style={{
                flex: 1, padding: "10px 12px",
                background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 12, color: "rgba(255,255,255,0.8)", fontSize: 14, fontWeight: 600,
                cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
              }}>Retry API</button>
            )}
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <div style={{
            fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.4)",
            fontFamily: "'DM Sans', sans-serif", marginBottom: 8, textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}>Data</div>
          {!confirmReset ? (
            <button onClick={() => setConfirmReset(true)} style={{
              width: "100%", padding: "12px", borderRadius: 12,
              background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
              color: "rgba(239,68,68,0.8)", fontSize: 14, fontWeight: 600,
              cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
            }}>Reset All Data</button>
          ) : (
            <div style={{
              background: "rgba(239,68,68,0.08)", borderRadius: 12,
              padding: 16, border: "1px solid rgba(239,68,68,0.2)",
            }}>
              <div style={{
                fontSize: 14, color: "rgba(255,255,255,0.7)", marginBottom: 12,
                fontFamily: "'DM Sans', sans-serif", lineHeight: 1.5,
              }}>This will permanently delete all goals, check-ins, and settings. This cannot be undone.</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setConfirmReset(false)} style={{
                  flex: 1, padding: "10px", borderRadius: 10,
                  background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
                  color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: 600,
                  cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                }}>Cancel</button>
                <button onClick={handleReset} style={{
                  flex: 1, padding: "10px", borderRadius: 10,
                  background: "linear-gradient(135deg, #ef4444, #dc2626)", border: "none",
                  color: "#fff", fontSize: 14, fontWeight: 700,
                  cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                }}>Delete Everything</button>
              </div>
            </div>
          )}
        </div>

        <div style={{
          borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 16,
        }}>
          <div style={{
            fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.4)",
            fontFamily: "'DM Sans', sans-serif", marginBottom: 8, textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}>About</div>
          <div style={{
            fontSize: 14, color: "rgba(255,255,255,0.5)",
            fontFamily: "'DM Sans', sans-serif", lineHeight: 1.6,
          }}>
            <div>Ramadan Goals v0.1.0</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
              Track your spiritual journey. Grow year after year.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Day Detail Modal ──────────────────────────────
function DayDetailModal({ date, goals, checkins, onSave, onClose, ramadanWindow }) {
  const ramDay = getRamadanDay(date, ramadanWindow);
  const dayCheckins = checkins[date] || {};
  const completedCount = goals.filter(g => (dayCheckins[g.id] || 0) >= g.target).length;

  const handleGoalTap = (goal) => {
    const current = dayCheckins[goal.id] || 0;
    const newVal = goal.type === "boolean"
      ? (current >= 1 ? 0 : 1)
      : clampCountGoalValue(goal, current + 1);
    if (newVal === current) return;
    onSave(date, goal.id, newVal);
  };

  const handleDecrement = (goal) => {
    const current = dayCheckins[goal.id] || 0;
    if (current > 0) onSave(date, goal.id, current - 1);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
      animation: "fadeIn 0.2s ease-out",
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "linear-gradient(180deg, #1e293b, #0f172a)",
        borderRadius: "24px 24px 0 0", width: "100%", maxWidth: 480,
        maxHeight: "80vh", overflow: "auto",
        padding: "24px 20px 40px", animation: "slideUp 0.3s cubic-bezier(.4,0,.2,1)",
      }}>
        <div style={{
          width: 40, height: 4, background: "rgba(255,255,255,0.2)",
          borderRadius: 2, margin: "0 auto 16px",
        }} />
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <h3 style={{
            fontSize: 20, fontWeight: 700, color: "#fff",
            fontFamily: "'Playfair Display', serif", margin: 0, marginBottom: 4,
          }}>{ramDay ? `Day ${ramDay}` : date}</h3>
          <div style={{
            fontSize: 13, color: "rgba(255,255,255,0.4)",
            fontFamily: "'DM Sans', sans-serif",
          }}>{date} — {completedCount}/{goals.length} completed</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {goals.map(goal => {
            const val = dayCheckins[goal.id] || 0;
            const done = val >= goal.target;
            const disableIncrement = goal.type === "count" && goal.fixed && val >= getCountGoalTarget(goal);
            return (
              <div
                key={goal.id}
                style={{
                  background: done
                    ? "linear-gradient(135deg, rgba(34,197,94,0.18), rgba(34,197,94,0.08))"
                    : "linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))",
                  borderRadius: 16, padding: "14px 16px",
                  display: "flex", alignItems: "center", gap: 12,
                  border: done ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(255,255,255,0.06)",
                  transition: "background 0.3s",
                }}
              >
                <span style={{ fontSize: 24 }}>{goal.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 14, fontWeight: 600, color: "#fff",
                    fontFamily: "'DM Sans', sans-serif",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{goal.title}</div>
                  <div style={{
                    fontSize: 12, color: "rgba(255,255,255,0.4)",
                    fontFamily: "'DM Sans', sans-serif", marginTop: 2,
                  }}>
                    {goal.type === "boolean"
                      ? (done ? "Done ✓" : "Not done")
                      : `${val} / ${goal.target} ${goal.unit}`}
                  </div>
                </div>
                {goal.type === "boolean" ? (
                  <button onClick={() => handleGoalTap(goal)} style={{
                    width: 40, height: 40, borderRadius: 12,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: done ? "rgba(34,197,94,0.25)" : "rgba(255,255,255,0.08)",
                    border: "none", fontSize: 18, cursor: "pointer", color: "#fff",
                    transition: "background 0.2s",
                  }}>{done ? "✓" : "○"}</button>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button onClick={() => handleDecrement(goal)} style={{
                      width: 32, height: 32, borderRadius: 10,
                      background: "rgba(255,255,255,0.08)", border: "none",
                      color: "#fff", fontSize: 18, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>−</button>
                    <span style={{
                      fontSize: 16, fontWeight: 700, color: "#fff",
                      fontFamily: "'DM Sans', sans-serif", minWidth: 28, textAlign: "center",
                    }}>{val}</span>
                    <button
                      disabled={disableIncrement}
                      onClick={() => handleGoalTap(goal)}
                      style={{
                      width: 32, height: 32, borderRadius: 10,
                      background: "rgba(255,255,255,0.08)", border: "none",
                      color: "#fff", fontSize: 18,
                      opacity: disableIncrement ? 0.45 : 1,
                      cursor: disableIncrement ? "default" : "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                    >+</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RamadanManualFallbackModal({ error, onSaveManual }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [localError, setLocalError] = useState("");

  const handleSubmit = () => {
    setLocalError("");
    const result = onSaveManual(start.trim(), end.trim());
    if (!result.ok) {
      setLocalError(result.error || "Enter valid Ramadan dates.");
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "fadeIn 0.2s",
    }}>
      <div style={{
        width: "90%", maxWidth: 380,
        background: "linear-gradient(180deg, #1e293b, #0f172a)",
        borderRadius: 18, padding: 20,
        border: "1px solid rgba(239,68,68,0.25)",
      }}>
        <h3 style={{
          fontSize: 18, margin: 0, marginBottom: 8, color: "#fff",
          fontFamily: "'Playfair Display', serif",
        }}>Set Ramadan Dates Manually</h3>
        <p style={{
          margin: 0, marginBottom: 12, fontSize: 13, lineHeight: 1.5,
          color: "rgba(255,255,255,0.7)", fontFamily: "'DM Sans', sans-serif",
        }}>
          We could not resolve dates from the API. Enter start and end dates to continue.
        </p>
        {error && (
          <div style={{
            fontSize: 12, color: "#fca5a5", marginBottom: 10,
            fontFamily: "'DM Sans', sans-serif",
          }}>{error}</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          <input
            placeholder="Start date (YYYY-MM-DD)"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            style={{
              width: "100%", background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12,
              padding: "10px 12px", color: "#fff", fontSize: 14,
              fontFamily: "'DM Sans', sans-serif", outline: "none",
            }}
          />
          <input
            placeholder="End date (YYYY-MM-DD)"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            style={{
              width: "100%", background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12,
              padding: "10px 12px", color: "#fff", fontSize: 14,
              fontFamily: "'DM Sans', sans-serif", outline: "none",
            }}
          />
        </div>
        {localError && (
          <div style={{
            fontSize: 12, color: "#fca5a5", marginBottom: 10,
            fontFamily: "'DM Sans', sans-serif",
          }}>{localError}</div>
        )}
        <button onClick={handleSubmit} style={{
          width: "100%", padding: "12px",
          background: "linear-gradient(135deg, #22c55e, #16a34a)",
          border: "none", borderRadius: 12, color: "#fff", fontSize: 14,
          fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
        }}>Save and Continue</button>
      </div>
    </div>
  );
}

// ─── Onboarding ─────────────────────────────────────
function Onboarding({ onComplete, seasonYear }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState(new Set([0, 1, 2]));
  const [sourceMode, setSourceMode] = useState("global");
  const [locationCity, setLocationCity] = useState(RAMADAN_DEFAULT_CITY);
  const [locationCountry, setLocationCountry] = useState(RAMADAN_DEFAULT_COUNTRY);
  const [manualStart, setManualStart] = useState("");
  const [manualEnd, setManualEnd] = useState("");
  const [sourceError, setSourceError] = useState("");

  const toggle = i => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const canContinueDateStep = sourceMode === "global"
    || (sourceMode === "location" && locationCity.trim() && locationCountry.trim())
    || sourceMode === "manual";

  const handleDateStepContinue = () => {
    setSourceError("");
    if (sourceMode === "manual") {
      const validation = validateRamadanWindow(manualStart, manualEnd);
      if (!validation.ok) {
        setSourceError(validation.error);
        return;
      }
    }
    if (sourceMode === "location" && (!locationCity.trim() || !locationCountry.trim())) {
      setSourceError("City and country are required for location mode.");
      return;
    }
    setStep(2);
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(180deg, #0c1222 0%, #0f172a 50%, #1a1a2e 100%)",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: 24,
    }}>
      {step === 0 && (
        <div style={{ textAlign: "center", animation: "fadeIn 0.5s ease-out", maxWidth: 360 }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🌙</div>
          <h1 style={{
            fontSize: 32, fontWeight: 700, color: "#fff",
            fontFamily: "'Playfair Display', serif", marginBottom: 8,
            lineHeight: 1.2,
          }}>Ramadan Goals</h1>
          <p style={{
            color: "rgba(255,255,255,0.5)", fontSize: 16, marginBottom: 32,
            fontFamily: "'DM Sans', sans-serif", lineHeight: 1.5,
          }}>Track your spiritual journey.<br />Grow year after year.</p>
          <input
            placeholder="Your name"
            value={name}
            onChange={e => setName(e.target.value)}
            style={{
              width: "100%", background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.15)", borderRadius: 16,
              padding: "16px 20px", color: "#fff", fontSize: 16,
              fontFamily: "'DM Sans', sans-serif", outline: "none",
              textAlign: "center", marginBottom: 16, boxSizing: "border-box",
            }}
          />
          <button
            disabled={!name.trim()}
            onClick={() => setStep(1)}
            style={{
              width: "100%", padding: "16px",
              background: name.trim() ? "linear-gradient(135deg, #22c55e, #059669)" : "rgba(255,255,255,0.08)",
              border: "none", borderRadius: 16, color: "#fff", fontSize: 17,
              fontWeight: 700, cursor: name.trim() ? "pointer" : "default",
              fontFamily: "'DM Sans', sans-serif",
              opacity: name.trim() ? 1 : 0.4,
              transition: "opacity 0.3s, background 0.3s",
            }}
          >Continue</button>
        </div>
      )}

      {step === 1 && (
        <div style={{ animation: "fadeIn 0.4s ease-out", width: "100%", maxWidth: 420 }}>
          <h2 style={{
            fontSize: 24, fontWeight: 700, color: "#fff", textAlign: "center",
            fontFamily: "'Playfair Display', serif", marginBottom: 6,
          }}>Choose Date Source</h2>
          <p style={{
            color: "rgba(255,255,255,0.45)", fontSize: 14, textAlign: "center",
            fontFamily: "'DM Sans', sans-serif", marginBottom: 20,
          }}>You can change this anytime in Settings.</p>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            <button onClick={() => setSourceMode("global")} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              background: sourceMode === "global" ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.04)",
              border: sourceMode === "global" ? "1px solid rgba(34,197,94,0.35)" : "1px solid rgba(255,255,255,0.08)",
              borderRadius: 14, padding: "14px 16px", color: "#fff", cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif",
            }}>
              <span>Global API</span>
              <span>{sourceMode === "global" ? "✓" : ""}</span>
            </button>
            <button onClick={() => setSourceMode("location")} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              background: sourceMode === "location" ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.04)",
              border: sourceMode === "location" ? "1px solid rgba(34,197,94,0.35)" : "1px solid rgba(255,255,255,0.08)",
              borderRadius: 14, padding: "14px 16px", color: "#fff", cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif",
            }}>
              <span>Location-Based API</span>
              <span>{sourceMode === "location" ? "✓" : ""}</span>
            </button>
            <button onClick={() => setSourceMode("manual")} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              background: sourceMode === "manual" ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.04)",
              border: sourceMode === "manual" ? "1px solid rgba(34,197,94,0.35)" : "1px solid rgba(255,255,255,0.08)",
              borderRadius: 14, padding: "14px 16px", color: "#fff", cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif",
            }}>
              <span>Manual Dates</span>
              <span>{sourceMode === "manual" ? "✓" : ""}</span>
            </button>
          </div>

          {sourceMode === "location" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              <input
                placeholder="City"
                value={locationCity}
                onChange={(e) => setLocationCity(e.target.value)}
                style={{
                  width: "100%", background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12,
                  padding: "12px 14px", color: "#fff", fontSize: 14,
                  fontFamily: "'DM Sans', sans-serif", outline: "none", boxSizing: "border-box",
                }}
              />
              <input
                placeholder="Country"
                value={locationCountry}
                onChange={(e) => setLocationCountry(e.target.value)}
                style={{
                  width: "100%", background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12,
                  padding: "12px 14px", color: "#fff", fontSize: 14,
                  fontFamily: "'DM Sans', sans-serif", outline: "none", boxSizing: "border-box",
                }}
              />
            </div>
          )}

          {sourceMode === "manual" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              <input
                placeholder="Start date (YYYY-MM-DD)"
                value={manualStart}
                onChange={(e) => setManualStart(e.target.value)}
                style={{
                  width: "100%", background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12,
                  padding: "12px 14px", color: "#fff", fontSize: 14,
                  fontFamily: "'DM Sans', sans-serif", outline: "none", boxSizing: "border-box",
                }}
              />
              <input
                placeholder="End date (YYYY-MM-DD)"
                value={manualEnd}
                onChange={(e) => setManualEnd(e.target.value)}
                style={{
                  width: "100%", background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12,
                  padding: "12px 14px", color: "#fff", fontSize: 14,
                  fontFamily: "'DM Sans', sans-serif", outline: "none", boxSizing: "border-box",
                }}
              />
            </div>
          )}

          {sourceError && (
            <div style={{
              color: "#fca5a5",
              fontSize: 13,
              marginBottom: 12,
              fontFamily: "'DM Sans', sans-serif",
            }}>{sourceError}</div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setStep(0)} style={{
              flex: 1, padding: "12px",
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 12, color: "rgba(255,255,255,0.7)", fontSize: 14, cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif",
            }}>Back</button>
            <button
              disabled={!canContinueDateStep}
              onClick={handleDateStepContinue}
              style={{
                flex: 1, padding: "12px",
                background: canContinueDateStep
                  ? "linear-gradient(135deg, #22c55e, #059669)"
                  : "rgba(255,255,255,0.08)",
                border: "none", borderRadius: 12, color: "#fff", fontSize: 14,
                fontWeight: 700, cursor: canContinueDateStep ? "pointer" : "default",
                fontFamily: "'DM Sans', sans-serif", opacity: canContinueDateStep ? 1 : 0.4,
              }}
            >Continue</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div style={{ animation: "fadeIn 0.4s ease-out", width: "100%", maxWidth: 400 }}>
          <h2 style={{
            fontSize: 24, fontWeight: 700, color: "#fff", textAlign: "center",
            fontFamily: "'Playfair Display', serif", marginBottom: 6,
          }}>Choose Your Goals</h2>
          <p style={{
            color: "rgba(255,255,255,0.45)", fontSize: 14, textAlign: "center",
            fontFamily: "'DM Sans', sans-serif", marginBottom: 24,
          }}>Pick a few to start. You can always add more later.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
            {TEMPLATES.map((t, i) => (
              <button key={i} onClick={() => toggle(i)} style={{
                display: "flex", alignItems: "center", gap: 12,
                background: selected.has(i) ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.04)",
                border: selected.has(i) ? "1px solid rgba(34,197,94,0.35)" : "1px solid rgba(255,255,255,0.08)",
                borderRadius: 14, padding: "14px 16px", cursor: "pointer",
                color: "#fff", textAlign: "left", transition: "all 0.2s",
              }}>
                <span style={{ fontSize: 24 }}>{t.icon}</span>
                <span style={{ flex: 1, fontSize: 15, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>{t.title}</span>
                <span style={{
                  width: 24, height: 24, borderRadius: 7,
                  background: selected.has(i) ? "#22c55e" : "rgba(255,255,255,0.1)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, transition: "background 0.2s",
                }}>{selected.has(i) ? "✓" : ""}</span>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setStep(1)} style={{
              flex: 1, padding: "12px",
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 12, color: "rgba(255,255,255,0.7)", fontSize: 14, cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif",
            }}>Back</button>
            <button
              disabled={selected.size === 0}
              onClick={() => {
                const goals = [...selected].map(i => ({ ...TEMPLATES[i], id: generateId() }));
                onComplete(name.trim(), goals, {
                  sourceMode,
                  locationCity: sourceMode === "location" ? locationCity.trim() : RAMADAN_DEFAULT_CITY,
                  locationCountry: sourceMode === "location" ? locationCountry.trim() : RAMADAN_DEFAULT_COUNTRY,
                  manualStart: sourceMode === "manual" ? manualStart.trim() : "",
                  manualEnd: sourceMode === "manual" ? manualEnd.trim() : "",
                  setupComplete: true,
                });
              }}
              style={{
                flex: 1, padding: "12px",
                background: selected.size > 0 ? "linear-gradient(135deg, #22c55e, #059669)" : "rgba(255,255,255,0.08)",
                border: "none", borderRadius: 12, color: "#fff", fontSize: 14,
                fontWeight: 700, cursor: selected.size > 0 ? "pointer" : "default",
                fontFamily: "'DM Sans', sans-serif",
                opacity: selected.size > 0 ? 1 : 0.4,
              }}
            >Start Ramadan {seasonYear || CURRENT_YEAR}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Today Screen ───────────────────────────────────
function TodayScreen({ data, save, onReset, ramadanWindow, ramadanTools }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editIdx, setEditIdx] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const today = todayStr();
  const ramDay = getRamadanDay(today, ramadanWindow);
  const dayCheckins = data.checkins[today] || {};

  const handleTap = (goal) => {
    const current = dayCheckins[goal.id] || 0;
    const newVal = goal.type === "boolean"
      ? (current >= 1 ? 0 : 1)
      : clampCountGoalValue(goal, current + 1);
    if (newVal === current) return;
    const newCheckins = { ...data.checkins, [today]: { ...dayCheckins, [goal.id]: newVal } };
    save({ ...data, checkins: newCheckins });
  };

  const handleEditSave = (val) => {
    const goal = data.goals[editIdx];
    const current = dayCheckins[goal.id] || 0;
    const nextVal = goal.type === "boolean" ? (val >= 1 ? 1 : 0) : clampCountGoalValue(goal, val);
    if (nextVal === current) {
      setEditIdx(null);
      return;
    }
    const newCheckins = { ...data.checkins, [today]: { ...dayCheckins, [goal.id]: nextVal } };
    save({ ...data, checkins: newCheckins });
    setEditIdx(null);
  };

  const handleDelete = () => {
    const newGoals = data.goals.filter((_, i) => i !== editIdx);
    save({ ...data, goals: newGoals });
    setEditIdx(null);
  };

  const handleAddGoal = (goal) => {
    save({ ...data, goals: [...data.goals, goal] });
    setShowAdd(false);
  };

  const completedCount = data.goals.filter(g => (dayCheckins[g.id] || 0) >= g.target).length;
  const allDone = data.goals.length > 0 && completedCount === data.goals.length;

  return (
    <div style={{ padding: "0 16px 100px" }}>
      {/* Header */}
      <div style={{ paddingTop: 20, marginBottom: 24 }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 4,
        }}>
          <div style={{
            fontSize: 13, color: "rgba(255,255,255,0.4)", fontFamily: "'DM Sans', sans-serif",
            fontWeight: 500,
          }}>
            {ramDay ? `Ramadan Day ${ramDay}` : `Ramadan ${ramadanWindow.seasonYear}`}
          </div>
          <button onClick={() => setShowSettings(true)} style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 18, color: "rgba(255,255,255,0.35)", padding: "4px",
            lineHeight: 1, transition: "color 0.2s",
          }}>⚙</button>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h1 style={{
            fontSize: 28, fontWeight: 700, color: "#fff",
            fontFamily: "'Playfair Display', serif", margin: 0,
          }}>
            {allDone ? "All done today! ✨" : `Salaam, ${data.userName}`}
          </h1>
          <span style={{
            fontSize: 14, color: "rgba(255,255,255,0.4)", fontFamily: "'DM Sans', sans-serif",
            fontWeight: 600,
          }}>{completedCount}/{data.goals.length}</span>
        </div>
        {/* Overall progress bar */}
        <div style={{
          height: 4, borderRadius: 2, background: "rgba(255,255,255,0.08)",
          marginTop: 12, overflow: "hidden",
        }}>
          <div style={{
            height: "100%", borderRadius: 2,
            background: allDone ? "linear-gradient(90deg, #22c55e, #86efac)" : "linear-gradient(90deg, #22c55e, #4ade80)",
            width: `${data.goals.length > 0 ? (completedCount / data.goals.length) * 100 : 0}%`,
            transition: "width 0.5s cubic-bezier(.4,0,.2,1)",
          }} />
        </div>
      </div>

      {/* Goal Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {data.goals.map((goal, idx) => (
          <GoalCard
            key={goal.id}
            goal={goal}
            value={dayCheckins[goal.id] || 0}
            completed={(dayCheckins[goal.id] || 0) >= goal.target}
            onTap={() => handleTap(goal)}
            onLongPress={() => setEditIdx(idx)}
          />
        ))}
      </div>

      {/* Add Goal Button */}
      <button onClick={() => setShowAdd(true)} style={{
        width: "100%", marginTop: 16, padding: "16px",
        background: "rgba(255,255,255,0.04)", border: "1px dashed rgba(255,255,255,0.15)",
        borderRadius: 18, color: "rgba(255,255,255,0.4)", fontSize: 15,
        fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
      }}>+ Add Goal</button>

      {showAdd && <AddGoalModal onAdd={handleAddGoal} onClose={() => setShowAdd(false)} />}
      {editIdx !== null && (
        <EditValueModal
          goal={data.goals[editIdx]}
          value={dayCheckins[data.goals[editIdx].id] || 0}
          onSave={handleEditSave}
          onDelete={handleDelete}
          onClose={() => setEditIdx(null)}
        />
      )}
      {showSettings && (
        <SettingsModal
          data={data}
          save={save}
          ramadanWindow={ramadanWindow}
          ramadanTools={ramadanTools}
          onClose={() => setShowSettings(false)}
          onReset={onReset}
        />
      )}
    </div>
  );
}

// ─── Progress Screen ────────────────────────────────
function ProgressScreen({ data, save, ramadanWindow }) {
  const [selectedDay, setSelectedDay] = useState(null);
  const today = todayStr();
  const boundedToday = today < ramadanWindow.start
    ? ramadanWindow.start
    : today > ramadanWindow.end
      ? ramadanWindow.end
      : today;
  const days = getDaysInRange(ramadanWindow.start, boundedToday);

  const goalStats = data.goals.map((goal) => {
    let completed = 0, total = 0, bestStreak = 0, currentStreak = 0;
    days.forEach(day => {
      total++;
      const val = (data.checkins[day] || {})[goal.id] || 0;
      if (val >= goal.target) {
        completed++;
        currentStreak++;
        bestStreak = Math.max(bestStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    });
    return { goal, completed, total, bestStreak, rate: total > 0 ? completed / total : 0 };
  });

  const overallRate = goalStats.length > 0
    ? goalStats.reduce((s, g) => s + g.rate, 0) / goalStats.length : 0;

  return (
    <div style={{ padding: "0 16px 100px" }}>
      <div style={{ paddingTop: 20, marginBottom: 24 }}>
        <h1 style={{
          fontSize: 28, fontWeight: 700, color: "#fff",
          fontFamily: "'Playfair Display', serif", margin: 0, marginBottom: 4,
        }}>Progress</h1>
        <p style={{
          color: "rgba(255,255,255,0.4)", fontSize: 14, margin: 0,
          fontFamily: "'DM Sans', sans-serif",
        }}>Ramadan {ramadanWindow.seasonYear}</p>
      </div>

      {/* Overall Score */}
      <div style={{
        background: "linear-gradient(135deg, rgba(34,197,94,0.12), rgba(16,185,129,0.06))",
        borderRadius: 20, padding: "24px", textAlign: "center", marginBottom: 24,
        border: "1px solid rgba(34,197,94,0.15)",
      }}>
        <div style={{
          fontSize: 48, fontWeight: 700, color: "#22c55e",
          fontFamily: "'DM Sans', sans-serif", lineHeight: 1,
        }}>{Math.round(overallRate * 100)}%</div>
        <div style={{
          fontSize: 14, color: "rgba(255,255,255,0.5)", marginTop: 6,
          fontFamily: "'DM Sans', sans-serif",
        }}>Overall completion rate</div>
      </div>

      {/* Heatmap */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={{
          fontSize: 16, fontWeight: 600, color: "rgba(255,255,255,0.7)",
          fontFamily: "'DM Sans', sans-serif", marginBottom: 12,
        }}>Daily consistency</h3>
        <Heatmap
          checkins={data.checkins}
          goals={data.goals}
          onDayTap={setSelectedDay}
          ramadanWindow={ramadanWindow}
        />
      </div>

      {/* Per-Goal Stats */}
      <h3 style={{
        fontSize: 16, fontWeight: 600, color: "rgba(255,255,255,0.7)",
        fontFamily: "'DM Sans', sans-serif", marginBottom: 12,
      }}>Goal breakdown</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {goalStats.map((gs, i) => (
          <div key={i} style={{
            background: "rgba(255,255,255,0.04)", borderRadius: 16,
            padding: "16px 18px", border: "1px solid rgba(255,255,255,0.06)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 22 }}>{gs.goal.icon}</span>
                <span style={{
                  fontSize: 15, fontWeight: 600, color: "#fff",
                  fontFamily: "'DM Sans', sans-serif",
                }}>{gs.goal.title}</span>
              </div>
              <StreakBadge
                checkins={data.checkins}
                goalId={gs.goal.id}
                goal={gs.goal}
                ramadanWindow={ramadanWindow}
              />
            </div>
            <div style={{
              height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}>
              <div style={{
                height: "100%", borderRadius: 3,
                background: gs.rate >= 0.8 ? "linear-gradient(90deg, #22c55e, #86efac)"
                  : gs.rate >= 0.5 ? "linear-gradient(90deg, #f59e0b, #fbbf24)"
                  : "linear-gradient(90deg, #ef4444, #f87171)",
                width: `${gs.rate * 100}%`,
                transition: "width 0.6s cubic-bezier(.4,0,.2,1)",
              }} />
            </div>
            <div style={{
              display: "flex", justifyContent: "space-between", marginTop: 8,
              fontSize: 12, color: "rgba(255,255,255,0.4)", fontFamily: "'DM Sans', sans-serif",
            }}>
              <span>{gs.completed}/{gs.total} days</span>
              <span>Best streak: {gs.bestStreak} days</span>
            </div>
          </div>
        ))}
      </div>

      {goalStats.length === 0 && (
        <div style={{
          textAlign: "center", padding: "40px 20px",
          color: "rgba(255,255,255,0.3)", fontFamily: "'DM Sans', sans-serif",
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
          <div>Add goals and start checking in to see your progress</div>
        </div>
      )}

      {selectedDay && (
        <DayDetailModal
          date={selectedDay}
          goals={data.goals}
          checkins={data.checkins}
          ramadanWindow={ramadanWindow}
          onSave={(date, goalId, val) => {
            const dayCheckins = data.checkins[date] || {};
            const newCheckins = { ...data.checkins, [date]: { ...dayCheckins, [goalId]: val } };
            save({ ...data, checkins: newCheckins });
          }}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  );
}

// ─── Circle Screen ──────────────────────────────────
function CircleScreen({ data, social }) {
  const [showCreate, setShowCreate] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  const runAction = async (fn) => {
    setBusy(true);
    setLocalError("");
    try {
      await fn();
    } catch (error) {
      console.error(error);
      setLocalError(error.message || "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  const activeCircle = social.circles.find((circle) => circle.id === social.activeCircleId) || null;

  return (
    <div style={{ padding: "0 16px 100px" }}>
      <div style={{ paddingTop: 20, marginBottom: 20 }}>
        <h1 style={{
          fontSize: 28, fontWeight: 700, color: "#fff",
          fontFamily: "'Playfair Display', serif", margin: 0, marginBottom: 4,
        }}>Circle</h1>
        <p style={{
          color: "rgba(255,255,255,0.4)", fontSize: 14, margin: 0,
          fontFamily: "'DM Sans', sans-serif",
        }}>Journey together</p>
      </div>

      {!social.backendReady && (
        <div style={{
          background: "rgba(245,158,11,0.12)",
          border: "1px solid rgba(245,158,11,0.35)",
          borderRadius: 18,
          padding: 18,
          marginBottom: 18,
          fontFamily: "'DM Sans', sans-serif",
        }}>
          <div style={{ fontWeight: 700, color: "#fcd34d", marginBottom: 8 }}>Backend Not Configured</div>
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, lineHeight: 1.6 }}>
            Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to `window.__APP_CONFIG__` in `index.html`
            to enable private circles, sharing, and reactions.
          </div>
        </div>
      )}

      {social.backendReady && !social.session && (
        <div style={{
          background: "linear-gradient(135deg, rgba(59,130,246,0.14), rgba(14,165,233,0.08))",
          border: "1px solid rgba(56,189,248,0.35)",
          borderRadius: 18,
          padding: 18,
          marginBottom: 18,
        }}>
          <div style={{
            fontSize: 16, fontWeight: 700, color: "#e0f2fe", marginBottom: 10,
            fontFamily: "'DM Sans', sans-serif",
          }}>Sign In to Share</div>
          <div style={{
            fontSize: 13, color: "rgba(255,255,255,0.7)", marginBottom: 12, lineHeight: 1.5,
            fontFamily: "'DM Sans', sans-serif",
          }}>
            Use magic-link email sign-in to create private circles and share progress with friends.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                flex: 1, background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12,
                padding: "10px 12px", color: "#fff", fontSize: 14,
                fontFamily: "'DM Sans', sans-serif", outline: "none",
              }}
            />
            <button
              disabled={busy || !email.trim()}
              onClick={() =>
                runAction(async () => {
                  await social.authSignInWithMagicLink(email);
                  setEmail("");
                })}
              style={{
                padding: "10px 14px", borderRadius: 12, border: "none",
                background: busy || !email.trim()
                  ? "rgba(255,255,255,0.14)"
                  : "linear-gradient(135deg, #22c55e, #16a34a)",
                color: "#fff", fontWeight: 700, cursor: busy || !email.trim() ? "default" : "pointer",
                fontFamily: "'DM Sans', sans-serif", opacity: busy || !email.trim() ? 0.5 : 1,
              }}
            >Send Link</button>
          </div>
        </div>
      )}

      {social.backendReady && social.session && (
        <>
          <div style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 18,
            padding: 16,
            marginBottom: 18,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}>
            <div>
              <div style={{
                fontSize: 12, color: "rgba(255,255,255,0.45)",
                fontFamily: "'DM Sans', sans-serif",
              }}>Signed in as</div>
              <div style={{
                fontSize: 14, color: "#fff", fontWeight: 600,
                fontFamily: "'DM Sans', sans-serif",
              }}>{social.session.user.email}</div>
            </div>
            <button
              onClick={() => runAction(() => social.authSignOut())}
              style={{
                padding: "9px 12px",
                background: "rgba(239,68,68,0.16)",
                border: "1px solid rgba(239,68,68,0.35)",
                borderRadius: 12,
                color: "#fca5a5",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif",
              }}
            >Sign Out</button>
          </div>

          <div style={{
            background: "linear-gradient(135deg, rgba(139,92,246,0.12), rgba(59,130,246,0.08))",
            borderRadius: 20, padding: 20, marginBottom: 18,
            border: "1px solid rgba(139,92,246,0.2)",
          }}>
            <div style={{
              fontSize: 18, fontWeight: 700, color: "#fff",
              fontFamily: "'Playfair Display', serif", marginBottom: 8,
            }}>Private Invite-Only Circles</div>
            <p style={{
              fontSize: 13, color: "rgba(255,255,255,0.6)", margin: 0, lineHeight: 1.5,
              fontFamily: "'DM Sans', sans-serif", marginBottom: 14,
            }}>
              Share goal progress snapshots and send emoji encouragement. Group size is limited to 12 members.
            </p>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button
                onClick={() => setShowCreate(true)}
                style={{
                  flex: 1, padding: "11px 12px", background: "rgba(139,92,246,0.24)",
                  border: "1px solid rgba(139,92,246,0.4)", borderRadius: 12,
                  color: "#ddd6fe", fontSize: 13, fontWeight: 700, cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >Create Circle</button>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                placeholder="Invite code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                style={{
                  flex: 1, background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12,
                  padding: "10px 12px", color: "#fff", fontSize: 14,
                  fontFamily: "'DM Sans', sans-serif", outline: "none",
                }}
              />
              <button
                disabled={!joinCode.trim() || busy}
                onClick={() =>
                  runAction(async () => {
                    await social.joinCircleByInvite(joinCode);
                    setJoinCode("");
                    await social.refreshFeed();
                  })}
                style={{
                  padding: "10px 14px",
                  background: !joinCode.trim() || busy
                    ? "rgba(255,255,255,0.12)"
                    : "linear-gradient(135deg, #3b82f6, #2563eb)",
                  border: "none",
                  borderRadius: 12,
                  color: "#fff",
                  fontWeight: 700,
                  cursor: !joinCode.trim() || busy ? "default" : "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                  opacity: !joinCode.trim() || busy ? 0.5 : 1,
                }}
              >Join</button>
            </div>
          </div>

          <div style={{
            marginBottom: 18,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 18,
            padding: 14,
          }}>
            <div style={{
              fontSize: 13, color: "rgba(255,255,255,0.6)", marginBottom: 10,
              fontFamily: "'DM Sans', sans-serif", fontWeight: 600,
            }}>Your Circles</div>
            {social.circles.length === 0 ? (
              <div style={{
                fontSize: 13, color: "rgba(255,255,255,0.35)",
                fontFamily: "'DM Sans', sans-serif",
              }}>No circles yet. Create one or join by invite code.</div>
            ) : (
              <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
                {social.circles.map((circle) => (
                  <button
                    key={circle.id}
                    onClick={() => social.setActiveCircle(circle.id)}
                    style={{
                      minWidth: 170,
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: social.activeCircleId === circle.id
                        ? "1px solid rgba(34,197,94,0.45)"
                        : "1px solid rgba(255,255,255,0.12)",
                      background: social.activeCircleId === circle.id
                        ? "rgba(34,197,94,0.16)"
                        : "rgba(255,255,255,0.05)",
                      color: "#fff",
                      cursor: "pointer",
                      fontFamily: "'DM Sans', sans-serif",
                    }}
                  >
                    <div style={{
                      fontSize: 14, fontWeight: 700, fontFamily: "'DM Sans', sans-serif",
                      marginBottom: 2,
                    }}>{circle.name}</div>
                    <div style={{
                      fontSize: 11, color: "rgba(255,255,255,0.5)",
                      fontFamily: "'DM Sans', sans-serif",
                    }}>Invite: {circle.invite_code}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 20,
            padding: 16,
            marginBottom: 12,
          }}>
            <div style={{
              display: "flex", alignItems: "baseline", justifyContent: "space-between",
              marginBottom: 12,
            }}>
              <div style={{
                fontSize: 16, color: "#fff", fontWeight: 700,
                fontFamily: "'DM Sans', sans-serif",
              }}>
                {activeCircle ? `${activeCircle.name} Feed` : "Circle Feed"}
              </div>
              <div style={{
                fontSize: 12, color: "rgba(255,255,255,0.4)",
                fontFamily: "'DM Sans', sans-serif",
              }}>{social.syncing ? "Syncing..." : "Live snapshots"}</div>
            </div>

            {social.loading && (
              <div style={{
                padding: "10px 0", color: "rgba(255,255,255,0.5)", fontSize: 13,
                fontFamily: "'DM Sans', sans-serif",
              }}>Loading feed...</div>
            )}

            {!social.loading && social.feed.length === 0 && (
              <div style={{
                padding: "10px 0", color: "rgba(255,255,255,0.4)", fontSize: 13,
                fontFamily: "'DM Sans', sans-serif", lineHeight: 1.6,
              }}>
                {activeCircle
                  ? "No updates yet. Check in on your goals to publish the first snapshot."
                  : "Select a circle to view shared updates."}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {social.feed.map((update) => (
                <div
                  key={update.updateId}
                  style={{
                    borderRadius: 14,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    padding: 12,
                  }}
                >
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    marginBottom: 8,
                  }}>
                    <div style={{
                      fontSize: 14, fontWeight: 700, color: "#fff",
                      fontFamily: "'DM Sans', sans-serif",
                    }}>{update.authorDisplayName}</div>
                    <div style={{
                      fontSize: 11, color: "rgba(255,255,255,0.4)",
                      fontFamily: "'DM Sans', sans-serif",
                    }}>{update.snapshotDate}</div>
                  </div>
                  <div style={{
                    fontSize: 13, color: "rgba(255,255,255,0.7)",
                    fontFamily: "'DM Sans', sans-serif", marginBottom: 8,
                  }}>
                    Overall {Math.round(update.overallCompletionPct)}% · Today {update.todayCompletedCount}/{update.todayTotalGoals}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                    {update.goalProgress.slice(0, 6).map((goal) => (
                      <div key={`${update.updateId}-${goal.goalId}`} style={{
                        display: "flex", justifyContent: "space-between",
                        fontSize: 12, color: "rgba(255,255,255,0.6)",
                        fontFamily: "'DM Sans', sans-serif",
                      }}>
                        <span>{goal.title}</span>
                        <span>{Math.round(goal.completionPctToDate)}% {goal.todayCompleted ? "✓" : ""}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {update.reactionSummary.map((item) => (
                      <button
                        key={`${update.updateId}-${item.emoji}`}
                        onClick={() => runAction(() => social.toggleReaction(update.updateId, item.emoji))}
                        style={{
                          minWidth: 46,
                          height: 34,
                          borderRadius: 17,
                          border: item.reactedByMe
                            ? "1px solid rgba(34,197,94,0.6)"
                            : "1px solid rgba(255,255,255,0.14)",
                          background: item.reactedByMe
                            ? "rgba(34,197,94,0.24)"
                            : "rgba(255,255,255,0.06)",
                          color: "#fff",
                          fontFamily: "'DM Sans', sans-serif",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 4,
                          cursor: "pointer",
                        }}
                      >
                        <span>{item.emoji}</span>
                        <span style={{ fontSize: 11 }}>{item.count || 0}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {(localError || social.error) && (
        <div style={{
          marginTop: 8, borderRadius: 12, padding: "10px 12px",
          background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
          color: "#fca5a5", fontSize: 13, fontFamily: "'DM Sans', sans-serif",
        }}>
          {localError || social.error}
        </div>
      )}

      {showCreate && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 100,
            background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "fadeIn 0.2s",
          }}
          onClick={() => setShowCreate(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "linear-gradient(180deg, #1e293b, #0f172a)",
              borderRadius: 24, padding: "28px 24px", width: "85%", maxWidth: 340,
              animation: "scaleIn 0.25s cubic-bezier(.4,0,.2,1)",
            }}
          >
            <h3 style={{
              fontSize: 20, fontWeight: 700, color: "#fff",
              fontFamily: "'Playfair Display', serif", marginBottom: 16,
            }}>Create a Circle</h3>
            <p style={{
              fontSize: 13, color: "rgba(255,255,255,0.45)", marginBottom: 16,
              fontFamily: "'DM Sans', sans-serif", lineHeight: 1.5,
            }}>
              Invite friends with a private code. Shared updates include goals and aggregate progress only.
            </p>
            <input
              placeholder="Circle name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              style={{
                width: "100%", background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12,
                padding: "12px 16px", color: "#fff", fontSize: 15,
                fontFamily: "'DM Sans', sans-serif", outline: "none",
                marginBottom: 12, boxSizing: "border-box",
              }}
            />
            <button
              disabled={!groupName.trim() || busy}
              onClick={() =>
                runAction(async () => {
                  await social.createCircle(groupName);
                  setGroupName("");
                  setShowCreate(false);
                  await social.refreshFeed();
                })}
              style={{
                width: "100%", padding: "14px",
                background: !groupName.trim() || busy
                  ? "rgba(255,255,255,0.12)"
                  : "linear-gradient(135deg, #8b5cf6, #7c3aed)",
                border: "none", borderRadius: 14, color: "#fff", fontSize: 16,
                fontWeight: 700, cursor: !groupName.trim() || busy ? "default" : "pointer",
                fontFamily: "'DM Sans', sans-serif",
                opacity: !groupName.trim() || busy ? 0.5 : 1,
              }}
            >Create Circle</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main App ───────────────────────────────────────
export default function RamadanGoals() {
  const { data, save, loading } = useStorage();
  const ramadanTools = useRamadanWindow(data, save);
  const social = useSupabaseSocial(data, save, ramadanTools.ramadanWindow);
  const [tab, setTab] = useState("today");
  const [hasOnboarded, setHasOnboarded] = useState(null);

  const saveWithCloudSync = useCallback((newData, options = {}) => {
    save(newData);
    if (
      !options.skipCloud &&
      social.backendReady &&
      social.session?.user &&
      newData?.cloudAuth?.seededAt
    ) {
      social.syncFromLocal(newData).catch((error) => {
        console.error(error);
      });
    }
  }, [save, social]);

  useEffect(() => {
    if (data && !loading) {
      setHasOnboarded(data.userName && data.goals && data.goals.length > 0);
    }
  }, [data, loading]);

  const handleOnboardingComplete = (name, goals, ramadanSetup) => {
    const nextRamadan = {
      ...DEFAULT_APP_DATA.ramadan,
      ...(data?.ramadan || {}),
      sourceMode: ramadanSetup?.sourceMode || "global",
      locationCity: ramadanSetup?.locationCity || RAMADAN_DEFAULT_CITY,
      locationCountry: ramadanSetup?.locationCountry || RAMADAN_DEFAULT_COUNTRY,
      manualStart: ramadanSetup?.manualStart || "",
      manualEnd: ramadanSetup?.manualEnd || "",
      setupComplete: true,
    };

    if (nextRamadan.sourceMode === "manual") {
      const validation = validateRamadanWindow(nextRamadan.manualStart, nextRamadan.manualEnd);
      if (validation.ok) {
        nextRamadan.resolvedStart = nextRamadan.manualStart;
        nextRamadan.resolvedEnd = nextRamadan.manualEnd;
        nextRamadan.resolvedSeasonYear = validation.seasonYear;
        nextRamadan.resolvedSource = "manual";
        nextRamadan.resolvedHijriYear = null;
        nextRamadan.resolvedCacheKey = "manual|manual|global";
        nextRamadan.resolveError = "";
      }
    }

    saveWithCloudSync({
      ...data,
      userName: name,
      goals,
      checkins: data?.checkins || {},
      ramadan: nextRamadan,
    });
    if (nextRamadan.sourceMode !== "manual") {
      ramadanTools.retryRamadanResolve();
    }
    setHasOnboarded(true);
  };

  const handleReset = () => {
    saveWithCloudSync({ ...DEFAULT_APP_DATA }, { skipCloud: true });
    setHasOnboarded(false);
    setTab("today");
  };

  if (loading || hasOnboarded === null || (hasOnboarded && ramadanTools.ramadanStatus === "loading")) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #0c1222 0%, #0f172a 50%, #1a1a2e 100%)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{
          fontSize: 40, animation: "pulse 1.5s infinite",
        }}>🌙</div>
      </div>
    );
  }

  if (!hasOnboarded) {
    return (
      <Onboarding
        onComplete={handleOnboardingComplete}
        seasonYear={ramadanTools.ramadanWindow?.seasonYear || CURRENT_YEAR}
      />
    );
  }

  const shouldShowRamadanManualFallback = (
    hasOnboarded
    && ramadanTools.ramadanStatus === "needs_manual"
    && ramadanTools.ramadanSourceMode !== "manual"
  );

  const tabs = [
    { id: "today", icon: "☀️", label: "Today" },
    { id: "progress", icon: "📊", label: "Progress" },
    { id: "circle", icon: "👥", label: "Circle" },
  ];

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(180deg, #0c1222 0%, #0f172a 50%, #1a1a2e 100%)",
      fontFamily: "'DM Sans', sans-serif",
      maxWidth: 480, margin: "0 auto",
      position: "relative",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700&family=Playfair+Display:wght@600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0c1222; overflow-x: hidden; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes scaleIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes celebratePulse { from { opacity: 0.6; transform: scale(0.8); } to { opacity: 0; transform: scale(1.5); } }
        input::placeholder { color: rgba(255,255,255,0.3); }
        button { font-family: 'DM Sans', sans-serif; }
      `}</style>

      {/* Subtle decorative element */}
      <div style={{
        position: "fixed", top: -120, right: -80, width: 300, height: 300,
        background: "radial-gradient(circle, rgba(34,197,94,0.04), transparent 70%)",
        borderRadius: "50%", pointerEvents: "none",
      }} />

      {/* Content */}
      <div style={{ animation: "fadeIn 0.3s ease-out" }}>
        {tab === "today" && (
          <TodayScreen
            data={data}
            save={saveWithCloudSync}
            onReset={handleReset}
            ramadanWindow={ramadanTools.ramadanWindow}
            ramadanTools={ramadanTools}
          />
        )}
        {tab === "progress" && (
          <ProgressScreen
            data={data}
            save={saveWithCloudSync}
            ramadanWindow={ramadanTools.ramadanWindow}
          />
        )}
        {tab === "circle" && <CircleScreen data={data} social={social} />}
      </div>

      {shouldShowRamadanManualFallback && (
        <RamadanManualFallbackModal
          error={ramadanTools.ramadanError}
          onSaveManual={ramadanTools.saveManualRamadanWindow}
        />
      )}

      {/* Bottom Tab Bar */}
      <div style={{
        position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
        width: "100%", maxWidth: 480,
        background: "rgba(15,23,42,0.95)", backdropFilter: "blur(20px)",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        display: "flex", justifyContent: "space-around",
        padding: "8px 0 env(safe-area-inset-bottom, 12px)",
      }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
            background: "none", border: "none", cursor: "pointer",
            padding: "8px 20px", borderRadius: 12,
            transition: "all 0.2s",
          }}>
            <span style={{
              fontSize: 22,
              filter: tab === t.id ? "none" : "grayscale(0.8)",
              opacity: tab === t.id ? 1 : 0.5,
              transition: "all 0.2s",
            }}>{t.icon}</span>
            <span style={{
              fontSize: 11, fontWeight: 600,
              color: tab === t.id ? "#22c55e" : "rgba(255,255,255,0.35)",
              fontFamily: "'DM Sans', sans-serif",
              transition: "color 0.2s",
            }}>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
