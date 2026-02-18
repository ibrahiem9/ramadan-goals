import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

import {
  DEFAULT_APP_DATA,
  HAS_SUPABASE,
  MAX_CIRCLE_MEMBERS,
  REACTION_EMOJIS,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from "/src/constants/app.js";
import { buildCircleSnapshot, inferGoalIcon } from "/src/lib/data.js";
import { todayStr } from "/src/lib/date.js";
import { generateInviteCode } from "/src/lib/ids.js";

const supabase = HAS_SUPABASE
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

const RLS_HOTFIX_HINT =
  "Supabase Circle policies are outdated. Run supabase/friend-sharing-v1-rls-hotfix.sql in the Supabase SQL editor.";

function normalizeSocialError(error, fallbackMessage = "Unexpected social backend error.") {
  if (error?.code === "42P17") {
    return new Error(RLS_HOTFIX_HINT);
  }
  const rawMessage = typeof error?.message === "string" ? error.message.trim() : "";
  const status = error?.status || error?.statusCode || 0;
  const combined = `${rawMessage} ${error?.code || ""}`.toLowerCase();

  if (status === 429 || /rate.?limit|over_email_send_rate_limit/.test(combined)) {
    return new Error("Too many requests. Please wait a moment and try again.");
  }
  if (/weak.?password/.test(combined)) {
    return new Error("Password is too weak. Use at least 6 characters.");
  }
  if (/invalid.?login|invalid.?credentials/.test(combined)) {
    return new Error("Invalid email or password.");
  }
  if (/already.?registered|user.?already.?exists/.test(combined)) {
    return new Error("An account with this email already exists. Try signing in instead.");
  }
  if (/provider|oauth|access.?denied/.test(combined)) {
    return new Error("Authentication provider error. Please try again.");
  }
  if (/otp.?expired|token.?expired|invalid.?token/.test(combined)) {
    return new Error("This link has expired. Please request a new one.");
  }
  if (/email.?not.?confirmed/.test(combined)) {
    return new Error("Please confirm your email address before signing in.");
  }
  if (error instanceof Error) return error;
  return new Error(rawMessage || fallbackMessage);
}

function throwIfSocialError(error) {
  if (error) throw normalizeSocialError(error);
}

export function useSupabaseSocial(data, save, ramadanWindow) {
  const [session, setSession] = useState(null);
  const [circles, setCircles] = useState([]);
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [authRecoveryMode, setAuthRecoveryMode] = useState(false);
  const bootstrappedRef = useRef(false);

  const backendReady = HAS_SUPABASE && !!supabase;
  const activeCircleId = data?.social?.activeCircleId || null;

  const setActiveCircle = useCallback((circleId) => {
    if (!data) return;
    if (data.social?.activeCircleId === circleId) return;
    save({
      ...data,
      social: {
        ...data.social,
        activeCircleId: circleId,
      },
    });
  }, [data, save]);

  const authSignInWithMagicLink = useCallback(async (email) => {
    if (!backendReady) throw new Error("Supabase is not configured.");
    setError("");
    const normalized = (email || "").trim().toLowerCase();
    if (!normalized) throw new Error("Email is required.");
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: normalized,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });
    if (signInError) {
        const msg = typeof signInError.message === "string" ? signInError.message : "";
        if (/rate.?limit|too many requests/i.test(msg)) {
          throw new Error("Too many sign-in attempts. Please wait a few minutes before trying again.");
        }
        throwIfSocialError(signInError);
      }
  }, [backendReady]);

  const authSignOut = useCallback(async () => {
    if (!backendReady) return;
    setError("");
    const { error: signOutError } = await supabase.auth.signOut();
    throwIfSocialError(signOutError);
  }, [backendReady]);

  const authSignUpWithPassword = useCallback(async (email, password) => {
    if (!backendReady) throw new Error("Supabase is not configured.");
    setError("");
    const normalized = (email || "").trim().toLowerCase();
    if (!normalized) throw new Error("Email is required.");
    if (!password || password.length < 6) throw new Error("Password must be at least 6 characters.");
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: normalized,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    throwIfSocialError(signUpError);
    return { needsConfirmation: !signUpData.session };
  }, [backendReady]);

  const authSignInWithPassword = useCallback(async (email, password) => {
    if (!backendReady) throw new Error("Supabase is not configured.");
    setError("");
    const normalized = (email || "").trim().toLowerCase();
    if (!normalized) throw new Error("Email is required.");
    if (!password) throw new Error("Password is required.");
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: normalized,
      password,
    });
    throwIfSocialError(signInError);
  }, [backendReady]);

  const authRequestPasswordReset = useCallback(async (email) => {
    if (!backendReady) throw new Error("Supabase is not configured.");
    setError("");
    const normalized = (email || "").trim().toLowerCase();
    if (!normalized) throw new Error("Email is required.");
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalized, {
      redirectTo: window.location.origin,
    });
    throwIfSocialError(resetError);
  }, [backendReady]);

  const authUpdatePassword = useCallback(async (newPassword) => {
    if (!backendReady) throw new Error("Supabase is not configured.");
    setError("");
    if (!newPassword || newPassword.length < 6) throw new Error("Password must be at least 6 characters.");
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    throwIfSocialError(updateError);
    setAuthRecoveryMode(false);
  }, [backendReady]);

  const authSignInWithGoogle = useCallback(async () => {
    if (!backendReady) throw new Error("Supabase is not configured.");
    setError("");
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    throwIfSocialError(oauthError);
  }, [backendReady]);

  const ensureProfile = useCallback(async (localData = data) => {
    if (!backendReady || !session?.user) return;
    const fallbackName = session.user.email?.split("@")[0] || "Member";
    const displayName = localData?.userName?.trim() || fallbackName;
    const { error: upsertError } = await supabase.from("profiles").upsert(
      {
        id: session.user.id,
        display_name: displayName,
      },
      { onConflict: "id" }
    );
    throwIfSocialError(upsertError);
  }, [backendReady, data, session?.user]);

  const upsertGoal = useCallback(async (goal) => {
    if (!backendReady || !session?.user) return;
    const { error: goalError } = await supabase.from("user_goals").upsert(
      {
        id: goal.id,
        user_id: session.user.id,
        title: goal.title,
        type: goal.type,
        target: goal.target,
        unit: goal.unit || "",
        archived: false,
      },
      { onConflict: "id" }
    );
    throwIfSocialError(goalError);
  }, [backendReady, session?.user]);

  const upsertCheckin = useCallback(async (goalId, date, value) => {
    if (!backendReady || !session?.user) return;
    const parsedValue = Number(value) || 0;
    const { data: existing, error: existingError } = await supabase
      .from("user_goal_checkins")
      .select("value")
      .eq("user_id", session.user.id)
      .eq("goal_id", goalId)
      .eq("checkin_date", date)
      .maybeSingle();
    throwIfSocialError(existingError);

    const merged = Math.max(Number(existing?.value) || 0, parsedValue);
    const { error: upsertError } = await supabase.from("user_goal_checkins").upsert(
      {
        user_id: session.user.id,
        goal_id: goalId,
        checkin_date: date,
        value: merged,
      },
      { onConflict: "user_id,goal_id,checkin_date" }
    );
    throwIfSocialError(upsertError);
  }, [backendReady, session?.user]);

  const listUserCircles = useCallback(async () => {
    if (!backendReady || !session?.user) return [];
    const { data: memberships, error: membershipError } = await supabase
      .from("circle_members")
      .select("circle_id, role")
      .eq("user_id", session.user.id);
    throwIfSocialError(membershipError);

    if (!memberships?.length) {
      setCircles([]);
      return [];
    }

    const circleIds = memberships.map((row) => row.circle_id);
    const roleByCircle = new Map(memberships.map((row) => [row.circle_id, row.role]));
    const { data: circlesData, error: circlesError } = await supabase
      .from("circles")
      .select("id, name, invite_code, owner_user_id, member_limit, is_active, created_at")
      .in("id", circleIds)
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    throwIfSocialError(circlesError);

    const hydrated = (circlesData || []).map((circle) => ({
      ...circle,
      role: roleByCircle.get(circle.id) || "member",
    }));
    setCircles(hydrated);
    return hydrated;
  }, [backendReady, session?.user]);

  const buildReactionSummary = useCallback((rows, me) => {
    return REACTION_EMOJIS.map((emoji) => {
      const matching = rows.filter((row) => row.emoji === emoji);
      return {
        emoji,
        count: matching.length,
        reactedByMe: matching.some((row) => row.user_id === me),
      };
    });
  }, []);

  const getCircleFeed = useCallback(async (circleId) => {
    if (!backendReady || !session?.user || !circleId) return [];
    const { data: updates, error: updatesError } = await supabase
      .from("circle_updates")
      .select(
        "id, circle_id, user_id, snapshot_date, overall_completion_pct, today_completed_count, today_total_goals, goal_progress_json, source_updated_at"
      )
      .eq("circle_id", circleId)
      .order("source_updated_at", { ascending: false })
      .limit(60);
    throwIfSocialError(updatesError);

    const userIds = [...new Set((updates || []).map((row) => row.user_id))];
    const updateIds = (updates || []).map((row) => row.id);

    const [
      { data: profiles, error: profilesError },
      { data: reactionRows, error: reactionError },
    ] = await Promise.all([
      userIds.length
        ? supabase.from("profiles").select("id, display_name").in("id", userIds)
        : Promise.resolve({ data: [] }),
      updateIds.length
        ? supabase
            .from("circle_update_reactions")
            .select("update_id, user_id, emoji")
            .in("update_id", updateIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    throwIfSocialError(profilesError);
    throwIfSocialError(reactionError);

    const profileNameById = new Map(
      (profiles || []).map((profile) => [profile.id, profile.display_name || "Member"])
    );
    const reactionsByUpdateId = new Map();
    (reactionRows || []).forEach((row) => {
      const existing = reactionsByUpdateId.get(row.update_id) || [];
      existing.push(row);
      reactionsByUpdateId.set(row.update_id, existing);
    });

    return (updates || []).map((row) => ({
      updateId: row.id,
      authorDisplayName: profileNameById.get(row.user_id) || "Member",
      snapshotDate: row.snapshot_date,
      overallCompletionPct: Number(row.overall_completion_pct || 0),
      todayCompletedCount: row.today_completed_count,
      todayTotalGoals: row.today_total_goals,
      goalProgress: Array.isArray(row.goal_progress_json) ? row.goal_progress_json : [],
      reactionSummary: buildReactionSummary(
        reactionsByUpdateId.get(row.id) || [],
        session.user.id
      ),
    }));
  }, [backendReady, buildReactionSummary, session?.user]);

  const refreshFeed = useCallback(async () => {
    if (!activeCircleId || !session?.user || !backendReady) {
      setFeed([]);
      return;
    }
    const rows = await getCircleFeed(activeCircleId);
    setFeed(rows);
  }, [activeCircleId, backendReady, getCircleFeed, session?.user]);

  const upsertSnapshotForCircle = useCallback(async (circleId, localData) => {
    if (!backendReady || !session?.user) return;
    const snapshot = buildCircleSnapshot(localData, ramadanWindow, todayStr());
    const now = new Date().toISOString();
    const { error: snapshotError } = await supabase.from("circle_updates").upsert(
      {
        circle_id: circleId,
        user_id: session.user.id,
        snapshot_date: snapshot.snapshotDate,
        overall_completion_pct: snapshot.overallCompletionPct,
        today_completed_count: snapshot.todayCompletedCount,
        today_total_goals: snapshot.todayTotalGoals,
        goal_progress_json: snapshot.goalProgress,
        source_updated_at: now,
        updated_at: now,
      },
      { onConflict: "circle_id,user_id,snapshot_date" }
    );
    throwIfSocialError(snapshotError);
  }, [backendReady, ramadanWindow, session?.user]);

  const syncFromLocal = useCallback(async (localData) => {
    if (!backendReady || !session?.user) return;
    setSyncing(true);
    setError("");
    try {
      await ensureProfile(localData);
      for (const goal of localData.goals || []) {
        await upsertGoal(goal);
      }

      const checkins = localData.checkins || {};
      for (const [date, dayCheckins] of Object.entries(checkins)) {
        if (date === "_migrated") continue;
        if (!dayCheckins || typeof dayCheckins !== "object") continue;
        for (const [goalId, value] of Object.entries(dayCheckins)) {
          if (!goalId) continue;
          await upsertCheckin(goalId, date, value);
        }
      }

      const circleRows = circles.length ? circles : await listUserCircles();
      for (const circle of circleRows) {
        await upsertSnapshotForCircle(circle.id, localData);
      }

      const now = new Date().toISOString();
      const baseForAuth = localData || data || DEFAULT_APP_DATA;
      save({
        ...baseForAuth,
        cloudAuth: {
          ...baseForAuth.cloudAuth,
          userId: session.user.id,
          email: session.user.email || "",
          sessionPresent: true,
          seededAt: baseForAuth.cloudAuth.seededAt || now,
          lastSyncAt: now,
        },
      });
      await refreshFeed();
    } finally {
      setSyncing(false);
    }
  }, [
    backendReady,
    circles,
    data,
    ensureProfile,
    listUserCircles,
    refreshFeed,
    save,
    session?.user,
    upsertCheckin,
    upsertGoal,
    upsertSnapshotForCircle,
  ]);

  const seedCloudFromLocal = useCallback(async (localData) => {
    if (!backendReady || !session?.user) return;
    const { count, error: countError } = await supabase
      .from("user_goals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", session.user.id);
    throwIfSocialError(countError);
    if ((count || 0) > 0) return;
    await syncFromLocal(localData);
  }, [backendReady, session?.user, syncFromLocal]);

  const pullCloudToLocal = useCallback(async () => {
    if (!backendReady || !session?.user || !data) return;
    const [{ data: goalRows, error: goalError }, { data: checkinRows, error: checkinError }] =
      await Promise.all([
        supabase
          .from("user_goals")
          .select("id, title, type, target, unit, created_at")
          .eq("user_id", session.user.id)
          .eq("archived", false)
          .order("created_at", { ascending: true }),
        supabase
          .from("user_goal_checkins")
          .select("goal_id, checkin_date, value")
          .eq("user_id", session.user.id),
      ]);
    throwIfSocialError(goalError);
    throwIfSocialError(checkinError);

    const iconByGoalId = new Map((data.goals || []).map((goal) => [goal.id, goal.icon]));
    const cloudGoals = (goalRows || []).map((goal) => ({
      id: goal.id,
      title: goal.title,
      icon: iconByGoalId.get(goal.id) || inferGoalIcon(goal.title),
      type: goal.type,
      target: goal.target,
      unit: goal.unit || "",
    }));
    const cloudCheckins = { _migrated: true };
    (checkinRows || []).forEach((row) => {
      if (!cloudCheckins[row.checkin_date]) cloudCheckins[row.checkin_date] = {};
      cloudCheckins[row.checkin_date][row.goal_id] = row.value;
    });

    const now = new Date().toISOString();
    save({
      ...data,
      goals: cloudGoals,
      checkins: cloudCheckins,
      cloudAuth: {
        ...data.cloudAuth,
        userId: session.user.id,
        email: session.user.email || "",
        sessionPresent: true,
        seededAt: data.cloudAuth.seededAt || now,
        lastSyncAt: now,
      },
    });
  }, [backendReady, data, save, session?.user]);

  const createCircle = useCallback(async (name) => {
    if (!backendReady || !session?.user) throw new Error("Sign in first.");
    const trimmed = (name || "").trim();
    if (!trimmed) throw new Error("Group name is required.");
    setError("");

    const { data: inserted, error: insertError } = await supabase
      .from("circles")
      .insert({
        name: trimmed,
        owner_user_id: session.user.id,
        invite_code: generateInviteCode(),
        member_limit: MAX_CIRCLE_MEMBERS,
        is_active: true,
      })
      .select("id, name, invite_code, owner_user_id, member_limit, is_active, created_at")
      .single();
    throwIfSocialError(insertError);

    const { error: memberError } = await supabase.from("circle_members").insert({
      circle_id: inserted.id,
      user_id: session.user.id,
      role: "owner",
    });
    throwIfSocialError(memberError);

    const nextCircles = await listUserCircles();
    setActiveCircle(inserted.id);
    if (nextCircles.length) await upsertSnapshotForCircle(inserted.id, data || DEFAULT_APP_DATA);
    return inserted;
  }, [backendReady, data, listUserCircles, session?.user, setActiveCircle, upsertSnapshotForCircle]);

  const joinCircleByInvite = useCallback(async (code) => {
    if (!backendReady || !session?.user) throw new Error("Sign in first.");
    const normalized = (code || "").trim().toUpperCase();
    if (!normalized) throw new Error("Invite code is required.");
    setError("");

    const { data: circle, error: joinRpcError } = await supabase
      .rpc("join_circle_by_invite", { invite_code_input: normalized })
      .single();
    throwIfSocialError(joinRpcError);
    if (!circle) throw new Error("Invite code not found.");

    await listUserCircles();
    setActiveCircle(circle.id);
    return circle;
  }, [backendReady, listUserCircles, session?.user, setActiveCircle]);

  const toggleReaction = useCallback(async (updateId, emoji) => {
    if (!backendReady || !session?.user) throw new Error("Sign in first.");
    if (!REACTION_EMOJIS.includes(emoji)) throw new Error("Invalid reaction.");
    setError("");

    const { data: existing, error: existingError } = await supabase
      .from("circle_update_reactions")
      .select("update_id")
      .eq("update_id", updateId)
      .eq("user_id", session.user.id)
      .eq("emoji", emoji)
      .maybeSingle();
    throwIfSocialError(existingError);

    if (existing) {
      const { error: deleteError } = await supabase
        .from("circle_update_reactions")
        .delete()
        .eq("update_id", updateId)
        .eq("user_id", session.user.id)
        .eq("emoji", emoji);
      throwIfSocialError(deleteError);
    } else {
      const { error: insertError } = await supabase.from("circle_update_reactions").insert({
        update_id: updateId,
        user_id: session.user.id,
        emoji,
      });
      throwIfSocialError(insertError);
    }
    await refreshFeed();
  }, [backendReady, refreshFeed, session?.user]);

  useEffect(() => {
    if (!backendReady) return;
    let mounted = true;
    supabase.auth.getSession().then(({ data: authData, error: sessionError }) => {
      if (sessionError) console.error("Session recovery error:", sessionError.message);
      if (mounted) setSession(authData?.session || null);
    });
    const { data: authSub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession || null);
      if (event === "PASSWORD_RECOVERY") setAuthRecoveryMode(true);
      if (event === "SIGNED_OUT") setAuthRecoveryMode(false);
    });
    return () => {
      mounted = false;
      authSub.subscription.unsubscribe();
    };
  }, [backendReady]);

  useEffect(() => {
    if (!data) return;
    const nextUserId = session?.user?.id || null;
    const nextEmail = session?.user?.email || "";
    const nextSessionPresent = Boolean(session?.user);
    if (
      data.cloudAuth.userId !== nextUserId ||
      data.cloudAuth.email !== nextEmail ||
      data.cloudAuth.sessionPresent !== nextSessionPresent
    ) {
      save({
        ...data,
        cloudAuth: {
          ...data.cloudAuth,
          userId: nextUserId,
          email: nextEmail,
          sessionPresent: nextSessionPresent,
        },
      });
    }
  }, [data, save, session?.user]);

  useEffect(() => {
    if (!session?.user) {
      bootstrappedRef.current = false;
      setCircles([]);
      setFeed([]);
      return;
    }
    if (!backendReady || !data || bootstrappedRef.current) return;

    let cancelled = false;
    bootstrappedRef.current = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        await ensureProfile(data);
        await seedCloudFromLocal(data);
        await pullCloudToLocal();
        const listed = await listUserCircles();
        const targetCircleId =
          data.social?.activeCircleId && listed.some((circle) => circle.id === data.social.activeCircleId)
            ? data.social.activeCircleId
            : listed[0]?.id || null;
        if (!cancelled) {
          if (targetCircleId !== data.social?.activeCircleId) setActiveCircle(targetCircleId);
          if (targetCircleId) {
            const rows = await getCircleFeed(targetCircleId);
            if (!cancelled) setFeed(rows);
          }
        }
      } catch (err) {
        const normalizedError = normalizeSocialError(err, "Failed to bootstrap social backend.");
        console.error(normalizedError);
        if (!cancelled) setError(normalizedError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    backendReady,
    data,
    ensureProfile,
    getCircleFeed,
    listUserCircles,
    pullCloudToLocal,
    seedCloudFromLocal,
    session?.user,
    setActiveCircle,
  ]);

  useEffect(() => {
    if (!session?.user || !backendReady) return;
    let cancelled = false;
    (async () => {
      try {
        const listed = await listUserCircles();
        const targetCircleId =
          data?.social?.activeCircleId && listed.some((circle) => circle.id === data.social.activeCircleId)
            ? data.social.activeCircleId
            : listed[0]?.id || null;
        if (!cancelled && targetCircleId !== (data?.social?.activeCircleId || null)) {
          setActiveCircle(targetCircleId);
        }
      } catch (err) {
        console.error(normalizeSocialError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backendReady, data?.social?.activeCircleId, listUserCircles, session?.user, setActiveCircle]);

  useEffect(() => {
    if (!session?.user || !backendReady || !activeCircleId) {
      setFeed([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const rows = await getCircleFeed(activeCircleId);
        if (!cancelled) setFeed(rows);
      } catch (err) {
        const normalizedError = normalizeSocialError(err, "Failed to load circle feed.");
        console.error(normalizedError);
        if (!cancelled) setError(normalizedError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCircleId, backendReady, getCircleFeed, session?.user]);

  return {
    backendReady,
    session,
    circles,
    activeCircleId,
    feed,
    loading,
    syncing,
    error,
    authRecoveryMode,
    authSignInWithMagicLink,
    authSignUpWithPassword,
    authSignInWithPassword,
    authRequestPasswordReset,
    authUpdatePassword,
    authSignInWithGoogle,
    authSignOut,
    createCircle,
    joinCircleByInvite,
    listUserCircles,
    setActiveCircle,
    upsertGoal,
    upsertCheckin,
    seedCloudFromLocal,
    getCircleFeed,
    toggleReaction,
    syncFromLocal,
    refreshFeed,
  };
}
