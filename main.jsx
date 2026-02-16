import { useState, useEffect, useCallback, useRef } from "react";

const STORAGE_KEY = "ramadan-goals-v1";
const CURRENT_YEAR = 2026;
const RAMADAN_START = "2026-02-27";
const RAMADAN_END = "2026-03-28";

// ─── Helpers ────────────────────────────────────────
const pad2 = n => String(n).padStart(2, '0');
function localDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getRamadanDay(dateStr) {
  const start = parseLocalDate(RAMADAN_START);
  const d = parseLocalDate(dateStr);
  const diff = Math.floor((d - start) / 86400000) + 1;
  return diff >= 1 && diff <= 30 ? diff : null;
}

function todayStr() {
  return localDateStr(new Date());
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function getDaysInRange(start, end) {
  const days = [];
  let d = parseLocalDate(start);
  const e = parseLocalDate(end);
  while (d <= e) {
    days.push(localDateStr(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

// ─── Checkin Migration (index-keyed → UUID-keyed) ──
function migrateCheckins(checkins, goals) {
  if (!checkins || checkins._migrated) return checkins;
  const migrated = {};
  Object.keys(checkins).forEach(dateStr => {
    const dayData = checkins[dateStr];
    if (!dayData || typeof dayData !== 'object') return;
    const newDay = {};
    Object.keys(dayData).forEach(key => {
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

// ─── Default Templates ─────────────────────────────
const TEMPLATES = [
  { title: "Salah on time", icon: "🕌", type: "boolean", target: 1, unit: "" },
  { title: "Qur'an pages", icon: "📖", type: "count", target: 5, unit: "pages" },
  { title: "Taraweeh", icon: "🌙", type: "boolean", target: 1, unit: "" },
  { title: "Dhikr", icon: "📿", type: "count", target: 100, unit: "times" },
  { title: "Sadaqah", icon: "💝", type: "boolean", target: 1, unit: "" },
  { title: "Dua for others", icon: "🤲", type: "boolean", target: 1, unit: "" },
  { title: "Water intake (Suhoor)", icon: "💧", type: "count", target: 8, unit: "cups" },
  { title: "Avoid backbiting", icon: "🤐", type: "boolean", target: 1, unit: "" },
];

// ─── Persistent Storage Hook ────────────────────────
function useStorage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const result = await window.storage.get(STORAGE_KEY);
        if (result && result.value) {
          const parsed = JSON.parse(result.value);
          if (parsed.goals && parsed.checkins && !parsed.checkins._migrated) {
            parsed.checkins = migrateCheckins(parsed.checkins, parsed.goals);
            await window.storage.set(STORAGE_KEY, JSON.stringify(parsed));
          }
          setData(parsed);
        } else {
          setData({ goals: [], checkins: {}, groups: [], userName: "" });
        }
      } catch {
        setData({ goals: [], checkins: {}, groups: [], userName: "" });
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
  const timerRef = useRef(null);
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
function Heatmap({ checkins, goals, onDayTap }) {
  const days = getDaysInRange(RAMADAN_START, RAMADAN_END);
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
function StreakBadge({ checkins, goalId, goal }) {
  let streak = 0;
  const days = getDaysInRange(RAMADAN_START, todayStr());
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
            <button onClick={() => setVal(Math.max(0, val - 1))} style={{
              width: 48, height: 48, borderRadius: 16, background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)", color: "#fff", fontSize: 24,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}>−</button>
            <span style={{
              fontSize: 36, fontWeight: 700, color: "#fff", fontFamily: "'DM Sans', sans-serif",
              minWidth: 60, textAlign: "center",
            }}>{val}</span>
            <button onClick={() => setVal(val + 1)} style={{
              width: 48, height: 48, borderRadius: 16, background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)", color: "#fff", fontSize: 24,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}>+</button>
          </div>
        )}
        <button onClick={() => onSave(val)} style={{
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
function SettingsModal({ data, save, onClose, onReset }) {
  const [editName, setEditName] = useState(data.userName);
  const [confirmReset, setConfirmReset] = useState(false);
  const nameDirty = editName.trim() && editName.trim() !== data.userName;

  const handleSaveName = () => {
    if (nameDirty) {
      save({ ...data, userName: editName.trim() });
    }
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
        borderRadius: 24, padding: "28px 24px", width: "85%", maxWidth: 360,
        animation: "scaleIn 0.25s cubic-bezier(.4,0,.2,1)",
      }}>
        <h3 style={{
          fontSize: 20, fontWeight: 700, color: "#fff",
          fontFamily: "'Playfair Display', serif", marginBottom: 24, textAlign: "center",
        }}>Settings</h3>

        {/* Name editing */}
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

        {/* Reset */}
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

        {/* About */}
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
function DayDetailModal({ date, goals, checkins, onSave, onClose }) {
  const ramDay = getRamadanDay(date);
  const dayCheckins = checkins[date] || {};
  const completedCount = goals.filter(g => (dayCheckins[g.id] || 0) >= g.target).length;

  const handleGoalTap = (goal) => {
    const current = dayCheckins[goal.id] || 0;
    const newVal = goal.type === "boolean" ? (current >= 1 ? 0 : 1) : current + 1;
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
                    <button onClick={() => handleGoalTap(goal)} style={{
                      width: 32, height: 32, borderRadius: 10,
                      background: "rgba(255,255,255,0.08)", border: "none",
                      color: "#fff", fontSize: 18, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>+</button>
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

// ─── Onboarding ─────────────────────────────────────
function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState(new Set([0, 1, 2]));

  const toggle = i => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
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
          <button
            disabled={selected.size === 0}
            onClick={() => {
              const goals = [...selected].map(i => ({ ...TEMPLATES[i], id: generateId() }));
              onComplete(name.trim(), goals);
            }}
            style={{
              width: "100%", padding: "16px",
              background: selected.size > 0 ? "linear-gradient(135deg, #22c55e, #059669)" : "rgba(255,255,255,0.08)",
              border: "none", borderRadius: 16, color: "#fff", fontSize: 17,
              fontWeight: 700, cursor: selected.size > 0 ? "pointer" : "default",
              fontFamily: "'DM Sans', sans-serif",
              opacity: selected.size > 0 ? 1 : 0.4,
            }}
          >Start Ramadan {CURRENT_YEAR}</button>
        </div>
      )}
    </div>
  );
}

// ─── Today Screen ───────────────────────────────────
function TodayScreen({ data, save, onReset }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editIdx, setEditIdx] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const today = todayStr();
  const ramDay = getRamadanDay(today);
  const dayCheckins = data.checkins[today] || {};

  const handleTap = (goal) => {
    const current = dayCheckins[goal.id] || 0;
    const newVal = goal.type === "boolean" ? (current >= 1 ? 0 : 1) : current + 1;
    const newCheckins = { ...data.checkins, [today]: { ...dayCheckins, [goal.id]: newVal } };
    save({ ...data, checkins: newCheckins });
  };

  const handleEditSave = (val) => {
    const goal = data.goals[editIdx];
    const newCheckins = { ...data.checkins, [today]: { ...dayCheckins, [goal.id]: val } };
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
            {ramDay ? `Ramadan Day ${ramDay}` : `Ramadan ${CURRENT_YEAR}`}
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
          onClose={() => setShowSettings(false)}
          onReset={onReset}
        />
      )}
    </div>
  );
}

// ─── Progress Screen ────────────────────────────────
function ProgressScreen({ data, save }) {
  const [selectedDay, setSelectedDay] = useState(null);
  const today = todayStr();
  const days = getDaysInRange(RAMADAN_START, today < RAMADAN_START ? RAMADAN_START : today > RAMADAN_END ? RAMADAN_END : today);

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
        }}>Ramadan {CURRENT_YEAR}</p>
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
        <Heatmap checkins={data.checkins} goals={data.goals} onDayTap={setSelectedDay} />
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
              <StreakBadge checkins={data.checkins} goalId={gs.goal.id} goal={gs.goal} />
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
function CircleScreen({ data, save }) {
  const [showCreate, setShowCreate] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [joinCode, setJoinCode] = useState("");

  const sampleLeaderboard = [
    { name: data.userName || "You", pct: 78, isYou: true },
    { name: "Amina", pct: 92, isYou: false },
    { name: "Yusuf", pct: 85, isYou: false },
    { name: "Fatima", pct: 71, isYou: false },
  ].sort((a, b) => b.pct - a.pct);

  return (
    <div style={{ padding: "0 16px 100px" }}>
      <div style={{ paddingTop: 20, marginBottom: 24 }}>
        <h1 style={{
          fontSize: 28, fontWeight: 700, color: "#fff",
          fontFamily: "'Playfair Display', serif", margin: 0, marginBottom: 4,
        }}>Circle</h1>
        <p style={{
          color: "rgba(255,255,255,0.4)", fontSize: 14, margin: 0,
          fontFamily: "'DM Sans', sans-serif",
        }}>Journey together</p>
      </div>

      {/* Feature Preview Card */}
      <div style={{
        background: "linear-gradient(135deg, rgba(139,92,246,0.12), rgba(59,130,246,0.08))",
        borderRadius: 20, padding: 24, marginBottom: 20,
        border: "1px solid rgba(139,92,246,0.2)",
      }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>👥</div>
        <h3 style={{
          fontSize: 18, fontWeight: 700, color: "#fff",
          fontFamily: "'Playfair Display', serif", marginBottom: 8,
        }}>Friendly Accountability</h3>
        <p style={{
          fontSize: 14, color: "rgba(255,255,255,0.5)", margin: 0, lineHeight: 1.5,
          fontFamily: "'DM Sans', sans-serif", marginBottom: 16,
        }}>
          Create a small group with friends. See each other's completion rates and encourage one another.
          All data shared is aggregate — daily details stay private.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setShowCreate(true)} style={{
            flex: 1, padding: "12px", background: "rgba(139,92,246,0.25)",
            border: "1px solid rgba(139,92,246,0.4)", borderRadius: 12,
            color: "#c4b5fd", fontSize: 14, fontWeight: 600, cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif",
          }}>Create Group</button>
          <button style={{
            flex: 1, padding: "12px", background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12,
            color: "rgba(255,255,255,0.6)", fontSize: 14, fontWeight: 600, cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif",
          }}>Join Group</button>
        </div>
      </div>

      {/* Sample Leaderboard Preview */}
      <div style={{
        background: "rgba(255,255,255,0.03)", borderRadius: 20,
        padding: 20, border: "1px solid rgba(255,255,255,0.06)",
      }}>
        <h3 style={{
          fontSize: 16, fontWeight: 600, color: "rgba(255,255,255,0.7)",
          fontFamily: "'DM Sans', sans-serif", marginBottom: 16,
        }}>Preview: Group Leaderboard</h3>
        {sampleLeaderboard.map((person, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "10px 0",
            borderBottom: i < sampleLeaderboard.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
          }}>
            <span style={{
              width: 28, height: 28, borderRadius: 14,
              background: i === 0 ? "linear-gradient(135deg, #f59e0b, #d97706)" :
                i === 1 ? "rgba(148,163,184,0.3)" :
                i === 2 ? "rgba(180,130,80,0.3)" : "rgba(255,255,255,0.08)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 700, color: "#fff",
              fontFamily: "'DM Sans', sans-serif",
            }}>{i + 1}</span>
            <span style={{
              flex: 1, fontSize: 15, fontWeight: person.isYou ? 700 : 500,
              color: person.isYou ? "#fff" : "rgba(255,255,255,0.6)",
              fontFamily: "'DM Sans', sans-serif",
            }}>
              {person.name} {person.isYou && <span style={{ color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>(you)</span>}
            </span>
            <div style={{
              width: 80, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}>
              <div style={{
                height: "100%", borderRadius: 3,
                background: person.isYou ? "linear-gradient(90deg, #22c55e, #86efac)" : "linear-gradient(90deg, #3b82f6, #60a5fa)",
                width: `${person.pct}%`,
                transition: "width 0.6s",
              }} />
            </div>
            <span style={{
              fontSize: 14, fontWeight: 700, color: person.isYou ? "#22c55e" : "rgba(255,255,255,0.5)",
              fontFamily: "'DM Sans', sans-serif", minWidth: 38, textAlign: "right",
            }}>{person.pct}%</span>
          </div>
        ))}
        <div style={{
          marginTop: 16, display: "flex", gap: 8, justifyContent: "center",
        }}>
          {["🤲", "💪", "✨", "🌙"].map((emoji, i) => (
            <button key={i} style={{
              width: 44, height: 44, borderRadius: 22,
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
              fontSize: 20, cursor: "pointer", display: "flex",
              alignItems: "center", justifyContent: "center",
              transition: "transform 0.15s",
            }}
              onPointerDown={e => e.target.style.transform = "scale(0.9)"}
              onPointerUp={e => e.target.style.transform = "scale(1)"}
            >{emoji}</button>
          ))}
        </div>
      </div>

      {showCreate && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 100,
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          animation: "fadeIn 0.2s",
        }} onClick={() => setShowCreate(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "linear-gradient(180deg, #1e293b, #0f172a)",
            borderRadius: 24, padding: "28px 24px", width: "85%", maxWidth: 340,
            animation: "scaleIn 0.25s cubic-bezier(.4,0,.2,1)",
          }}>
            <h3 style={{
              fontSize: 20, fontWeight: 700, color: "#fff",
              fontFamily: "'Playfair Display', serif", marginBottom: 16,
            }}>Create a Group</h3>
            <p style={{
              fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 16,
              fontFamily: "'DM Sans', sans-serif", lineHeight: 1.5,
            }}>
              Groups share completion percentages only. Your daily details stay private.
            </p>
            <input
              placeholder="Group name"
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
              style={{
                width: "100%", background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12,
                padding: "12px 16px", color: "#fff", fontSize: 15,
                fontFamily: "'DM Sans', sans-serif", outline: "none",
                marginBottom: 12, boxSizing: "border-box",
              }}
            />
            <button style={{
              width: "100%", padding: "14px",
              background: "linear-gradient(135deg, #8b5cf6, #7c3aed)",
              border: "none", borderRadius: 14, color: "#fff", fontSize: 16,
              fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
              opacity: groupName.trim() ? 1 : 0.4,
            }}>Create & Get Invite Link</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main App ───────────────────────────────────────
export default function RamadanGoals() {
  const { data, save, loading } = useStorage();
  const [tab, setTab] = useState("today");
  const [hasOnboarded, setHasOnboarded] = useState(null);

  useEffect(() => {
    if (data && !loading) {
      setHasOnboarded(data.userName && data.goals && data.goals.length > 0);
    }
  }, [data, loading]);

  const handleOnboardingComplete = (name, goals) => {
    save({ ...data, userName: name, goals, checkins: data.checkins || {} });
    setHasOnboarded(true);
  };

  const handleReset = () => {
    save({ goals: [], checkins: {}, groups: [], userName: "" });
    setHasOnboarded(false);
    setTab("today");
  };

  if (loading || hasOnboarded === null) {
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
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

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
        {tab === "today" && <TodayScreen data={data} save={save} onReset={handleReset} />}
        {tab === "progress" && <ProgressScreen data={data} save={save} />}
        {tab === "circle" && <CircleScreen data={data} save={save} />}
      </div>

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