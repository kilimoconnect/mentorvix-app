/**
 * Mentorvix Revenue Intelligence — Supabase data-access layer
 *
 * All functions accept a Supabase client instance so they work in both
 * browser (createBrowserClient) and server (createServerClient) contexts.
 *
 * Typical call sequence from apply/page.tsx:
 *   1. getOrCreateApplication(client, userId)        → applicationId
 *   2. saveIntakeConversation(...)                   → on every AI reply in Step 0
 *   3. saveStreams(...)                              → after [STREAMS_DETECTED]
 *   4. saveDriverConversation(...)                   → on every AI reply in Step 2
 *   5. saveStreamItems(...)                          → after [ITEMS_DETECTED] / import
 *   6. saveForecastConfig(...)                       → when user changes start/horizon
 *   7. saveProjectionSnapshot(...)                   → on "Save & Continue"
 *   8. loadApplicationState(...)                     → on page mount to resume progress
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/* ─────────────────────────────────────────── database row types ── */

export interface DbApplication {
  id: string;
  user_id: string;
  name: string | null;
  situation: string | null;   // e.g. "existing" | "new_business" | "expansion" etc.
  currency: string | null;    // ISO 4217 code, e.g. "USD", "NGN", "KES"
  wizard_step: number;         // last active step: 0=situation, 1=mapping, 2=confirm, 3=data, 4=forecast
  status: "draft" | "submitted" | "under_review" | "approved" | "rejected";
  intake_done: boolean;
  drivers_done: boolean;
  forecast_done: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbAiConversation {
  id: string;
  application_id: string;
  user_id: string;
  type: "intake" | "driver";
  stream_id: string | null;
  messages: { role: "user" | "assistant"; content: string }[];
  provider: "openai" | "gemini" | null;
  is_complete: boolean;
  created_at: string;
  updated_at: string;
}

export type StreamType =
  | "product" | "service" | "subscription"
  | "rental"  | "marketplace" | "contract" | "custom";

export type Confidence = "high" | "medium" | "low";

export interface DbRevenueStream {
  id: string;
  application_id: string;
  user_id: string;
  name: string;
  type: StreamType;
  confidence: Confidence;
  monthly_growth_pct: number;
  sub_new_per_month: number;
  sub_churn_pct: number;
  rental_occupancy_pct: number;
  driver_done: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface DbStreamItem {
  id: string;
  stream_id: string;
  user_id: string;
  name: string;
  category: string;
  volume: number;
  price: number;
  unit: string;
  note: string | null;
  seasonality_preset: string | null;   // SeasonalityPreset key — NULL = inherit from stream
  position: number;
  created_at: string;
  updated_at: string;
}

export interface DbForecastConfig {
  id: string;
  application_id: string;
  user_id: string;
  start_month: number;
  start_year: number;
  horizon_years: number;
  created_at: string;
  updated_at: string;
}

export interface DbProjectionSnapshot {
  id: string;
  application_id: string;
  user_id: string;
  forecast_config_id: string | null;
  monthly_baseline: number | null;
  year1_revenue: number | null;
  total_revenue: number | null;
  final_year_revenue: number | null;
  snapshot_data: unknown;   // ProjMonth[] — cast in consuming code
  created_at: string;
}

export interface ApplicationSummary extends DbApplication {
  stream_count: number;
  item_count: number;
  estimated_mrr: number;
  monthly_baseline: number | null;
  year1_revenue: number | null;
  total_revenue: number | null;
  final_year_revenue: number | null;
}

/* Complete state loaded from DB to hydrate the apply page */
export interface ApplicationState {
  application: DbApplication;
  intakeConversation: DbAiConversation | null;
  streams: DbRevenueStream[];
  itemsByStream: Record<string, DbStreamItem[]>;  // keyed by stream_id
  driverConversations: DbAiConversation[];        // type='driver'
  forecastConfig: DbForecastConfig | null;
  latestSnapshot: DbProjectionSnapshot | null;
}

/* ─────────────────────────────────────────── applications ── */

/**
 * Returns the user's most recent draft application,
 * or creates a new one if none exists.
 */
export async function getOrCreateApplication(
  supabase: SupabaseClient,
  userId: string,
  name?: string,
): Promise<DbApplication> {
  // Try to find an existing draft
  const { data: existing, error: findErr } = await supabase
    .from("applications")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "draft")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findErr) throw new Error(`getOrCreateApplication find: ${findErr.message}`);
  if (existing) return existing as DbApplication;

  // Create new
  const { data, error } = await supabase
    .from("applications")
    .insert({ user_id: userId, name: name ?? null })
    .select()
    .single();

  if (error) throw new Error(`getOrCreateApplication insert: ${error.message}`);
  return data as DbApplication;
}

/** Update application progress flags */
export async function updateApplicationFlags(
  supabase: SupabaseClient,
  applicationId: string,
  flags: Partial<Pick<DbApplication, "intake_done" | "drivers_done" | "forecast_done" | "name" | "status" | "situation" | "wizard_step" | "currency">>,
): Promise<void> {
  const { error } = await supabase
    .from("applications")
    .update(flags)
    .eq("id", applicationId);
  if (error) throw new Error(`updateApplicationFlags: ${error.message}`);
}

/** Fetch all applications for a user (for dashboard list) */
export async function getUserApplications(
  supabase: SupabaseClient,
  userId: string,
): Promise<ApplicationSummary[]> {
  const { data, error } = await supabase
    .from("application_summaries")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ApplicationSummary[];
}

/* ─────────────────────────────────────────── AI conversations ── */

/**
 * Upsert the intake conversation for an application.
 * If a conversation already exists, replaces its messages.
 */
export async function saveIntakeConversation(
  supabase: SupabaseClient,
  applicationId: string,
  userId: string,
  messages: { role: "user" | "assistant"; content: string }[],
  provider: "openai" | "gemini" | null,
  isComplete: boolean,
): Promise<DbAiConversation> {
  // Check if one already exists
  const { data: existing } = await supabase
    .from("ai_conversations")
    .select("id")
    .eq("application_id", applicationId)
    .eq("type", "intake")
    .maybeSingle();

  if (existing?.id) {
    const { data, error } = await supabase
      .from("ai_conversations")
      .update({ messages, provider, is_complete: isComplete })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw new Error(`saveIntakeConversation update: ${error.message}`);
    return data as DbAiConversation;
  }

  const { data, error } = await supabase
    .from("ai_conversations")
    .insert({ application_id: applicationId, user_id: userId, type: "intake", messages, provider, is_complete: isComplete })
    .select()
    .single();
  if (error) throw new Error(`saveIntakeConversation insert: ${error.message}`);
  return data as DbAiConversation;
}

/**
 * Upsert a driver conversation for a specific stream.
 * One driver conversation per stream — updates messages in place.
 */
export async function saveDriverConversation(
  supabase: SupabaseClient,
  applicationId: string,
  userId: string,
  streamId: string,
  messages: { role: "user" | "assistant"; content: string }[],
  provider: "openai" | "gemini" | null,
  isComplete: boolean,
): Promise<DbAiConversation> {
  const { data: existing } = await supabase
    .from("ai_conversations")
    .select("id")
    .eq("application_id", applicationId)
    .eq("stream_id", streamId)
    .eq("type", "driver")
    .maybeSingle();

  if (existing?.id) {
    const { data, error } = await supabase
      .from("ai_conversations")
      .update({ messages, provider, is_complete: isComplete })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw new Error(`saveDriverConversation update: ${error.message}`);
    return data as DbAiConversation;
  }

  const { data, error } = await supabase
    .from("ai_conversations")
    .insert({
      application_id: applicationId,
      user_id: userId,
      type: "driver",
      stream_id: streamId,
      messages,
      provider,
      is_complete: isComplete,
    })
    .select()
    .single();
  if (error) throw new Error(`saveDriverConversation insert: ${error.message}`);
  return data as DbAiConversation;
}

/* ─────────────────────────────────────────── revenue streams ── */

/**
 * Full replace: deletes all existing streams for this application
 * and inserts the current set in order.
 * Called after AI detects streams (Step 1) and on every stream edit.
 */
export async function saveStreams(
  supabase: SupabaseClient,
  applicationId: string,
  userId: string,
  streams: Array<{
    id?: string;
    name: string;
    type: StreamType;
    confidence: Confidence;
    monthly_growth_pct: number;
    sub_new_per_month: number;
    sub_churn_pct: number;
    rental_occupancy_pct: number;
    driver_done: boolean;
    position: number;
  }>,
): Promise<DbRevenueStream[]> {
  // ── 1. Delete streams no longer in the list ────────────────────────────────
  const { data: existing, error: selErr } = await supabase
    .from("revenue_streams")
    .select("id")
    .eq("application_id", applicationId);

  if (selErr) throw new Error(`saveStreams select: ${selErr.message}`);

  const currentDbIds = new Set(streams.map((s) => s.id).filter(Boolean));
  const toDelete = (existing ?? [])
    .map((r: { id: string }) => r.id)
    .filter((id: string) => !currentDbIds.has(id));

  if (toDelete.length > 0) {
    const { error: delErr } = await supabase
      .from("revenue_streams")
      .delete()
      .in("id", toDelete);
    if (delErr) throw new Error(`saveStreams delete: ${delErr.message}`);
  }

  // ── 2. Separate new streams (no DB id) from existing ones (have DB id) ────
  //   New streams  → INSERT  (lets the DB generate a UUID — avoids upsert ambiguity)
  //   Existing     → UPSERT  (UPDATE the row in place, preserving stream_items FK)
  const newStreams      = streams.filter((s) => !s.id);
  const existingStreams = streams.filter((s) =>  s.id);

  const baseFields = (s: typeof streams[number], i: number) => ({
    application_id:       applicationId,
    user_id:              userId,
    name:                 s.name,
    type:                 s.type,
    confidence:           s.confidence,
    monthly_growth_pct:   s.monthly_growth_pct,
    sub_new_per_month:    s.sub_new_per_month,
    sub_churn_pct:        s.sub_churn_pct,
    rental_occupancy_pct: s.rental_occupancy_pct,
    driver_done:          s.driver_done,
    position:             s.position ?? i,
  });

  const saved: DbRevenueStream[] = [];

  if (newStreams.length > 0) {
    const rows = newStreams.map((s, i) => baseFields(s, streams.indexOf(s) >= 0 ? streams.indexOf(s) : i));
    const { data, error } = await supabase
      .from("revenue_streams")
      .insert(rows)
      .select();
    if (error) throw new Error(`saveStreams insert: ${error.message}`);
    saved.push(...((data ?? []) as DbRevenueStream[]));
  }

  if (existingStreams.length > 0) {
    const rows = existingStreams.map((s, i) => ({
      id: s.id!,
      ...baseFields(s, streams.indexOf(s) >= 0 ? streams.indexOf(s) : i),
    }));
    const { data, error } = await supabase
      .from("revenue_streams")
      .upsert(rows, { onConflict: "id" })
      .select();
    if (error) throw new Error(`saveStreams upsert: ${error.message}`);
    saved.push(...((data ?? []) as DbRevenueStream[]));
  }

  // Return sorted by position so callers can match by index
  return saved.sort((a, b) => a.position - b.position);
}

/** Update a single stream's fields without touching the others */
export async function updateStream(
  supabase: SupabaseClient,
  streamId: string,
  patch: Partial<Omit<DbRevenueStream, "id" | "application_id" | "user_id" | "created_at" | "updated_at">>,
): Promise<void> {
  const { error } = await supabase
    .from("revenue_streams")
    .update(patch)
    .eq("id", streamId);
  if (error) throw error;
}

/* ─────────────────────────────────────────── stream items ── */

/**
 * Full replace for one stream's items.
 * Deletes all existing items for this stream and inserts fresh ones.
 * Called after AI emits [ITEMS_DETECTED], after import, or on manual edit.
 */
export async function saveStreamItems(
  supabase: SupabaseClient,
  streamId: string,
  userId: string,
  items: Array<{
    name: string;
    category: string;
    volume: number;
    price: number;
    unit: string;
    note?: string;
    seasonalityPreset?: string;
    position?: number;
  }>,
): Promise<DbStreamItem[]> {
  // Delete all existing items for this stream
  await supabase.from("stream_items").delete().eq("stream_id", streamId);

  if (items.length === 0) return [];

  const rows = items.map((it, i) => ({
    stream_id: streamId,
    user_id: userId,
    name: it.name,
    category: it.category,
    volume: it.volume,
    price: it.price,
    unit: it.unit,
    note: it.note ?? null,
    seasonality_preset: it.seasonalityPreset ?? null,
    position: it.position ?? i,
  }));

  const { data, error } = await supabase
    .from("stream_items")
    .insert(rows)
    .select();
  if (error) throw new Error(`saveStreamItems insert: ${error.message}`);
  return (data ?? []) as DbStreamItem[];
}

/* ─────────────────────────────────────────── forecast config ── */

/** Upsert the forecast configuration for an application (one row enforced by UNIQUE) */
export async function saveForecastConfig(
  supabase: SupabaseClient,
  applicationId: string,
  userId: string,
  config: { startMonth: number; startYear: number; horizonYears: number },
): Promise<DbForecastConfig> {
  const { data, error } = await supabase
    .from("forecast_configs")
    .upsert(
      {
        application_id: applicationId,
        user_id: userId,
        start_month: config.startMonth,
        start_year: config.startYear,
        horizon_years: config.horizonYears,
      },
      { onConflict: "application_id" },
    )
    .select()
    .single();
  if (error) throw new Error(`saveForecastConfig: ${error.message}`);
  return data as DbForecastConfig;
}

/* ─────────────────────────────────────────── projection snapshots ── */

/**
 * Save a new projection snapshot (immutable, point-in-time).
 * Creates a new row on every call — history is preserved.
 */
export async function saveProjectionSnapshot(
  supabase: SupabaseClient,
  applicationId: string,
  userId: string,
  forecastConfigId: string | null,
  metrics: {
    monthlyBaseline: number;
    year1Revenue: number;
    totalRevenue: number;
    finalYearRevenue: number;
  },
  snapshotData: unknown,   // ProjMonth[]
): Promise<DbProjectionSnapshot> {
  const { data, error } = await supabase
    .from("projection_snapshots")
    .insert({
      application_id: applicationId,
      user_id: userId,
      forecast_config_id: forecastConfigId ?? null,
      monthly_baseline: metrics.monthlyBaseline,
      year1_revenue: metrics.year1Revenue,
      total_revenue: metrics.totalRevenue,
      final_year_revenue: metrics.finalYearRevenue,
      snapshot_data: snapshotData,
    })
    .select()
    .single();
  if (error) throw new Error(`saveProjectionSnapshot: ${error.message}`);
  return data as DbProjectionSnapshot;
}

/** Fetch all snapshots for an application (newest first) */
export async function getProjectionHistory(
  supabase: SupabaseClient,
  applicationId: string,
): Promise<Omit<DbProjectionSnapshot, "snapshot_data">[]> {
  const { data, error } = await supabase
    .from("projection_snapshots")
    .select("id, application_id, user_id, forecast_config_id, monthly_baseline, year1_revenue, total_revenue, final_year_revenue, created_at")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Omit<DbProjectionSnapshot, "snapshot_data">[];
}

/** Fetch the full snapshot data for one specific snapshot */
export async function getSnapshotData(
  supabase: SupabaseClient,
  snapshotId: string,
): Promise<DbProjectionSnapshot> {
  const { data, error } = await supabase
    .from("projection_snapshots")
    .select("*")
    .eq("id", snapshotId)
    .single();
  if (error) throw error;
  return data as DbProjectionSnapshot;
}

/* ─────────────────────────────────────────── full state load ── */

/**
 * Load the complete application state needed to hydrate the apply page.
 * Returns everything in one round-trip batch (multiple queries but no joins needed client-side).
 */
export async function loadApplicationState(
  supabase: SupabaseClient,
  applicationId: string,
): Promise<ApplicationState> {
  const [appRes, convRes, streamsRes, snapshotRes] = await Promise.all([
    supabase.from("applications").select("*").eq("id", applicationId).single(),
    supabase.from("ai_conversations").select("*").eq("application_id", applicationId),
    supabase.from("revenue_streams").select("*").eq("application_id", applicationId).order("position"),
    supabase.from("projection_snapshots")
      .select("id, application_id, user_id, forecast_config_id, monthly_baseline, year1_revenue, total_revenue, final_year_revenue, created_at")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (appRes.error)     throw appRes.error;
  if (convRes.error)    throw convRes.error;
  if (streamsRes.error) throw streamsRes.error;

  const streams = (streamsRes.data ?? []) as DbRevenueStream[];
  const conversations = (convRes.data ?? []) as DbAiConversation[];

  // Load items for all streams in parallel
  const itemResults = await Promise.all(
    streams.map((s) =>
      supabase
        .from("stream_items")
        .select("*")
        .eq("stream_id", s.id)
        .order("position"),
    ),
  );

  const itemsByStream: Record<string, DbStreamItem[]> = {};
  streams.forEach((s, i) => {
    itemsByStream[s.id] = (itemResults[i].data ?? []) as DbStreamItem[];
  });

  // Load forecast config
  const { data: fcData } = await supabase
    .from("forecast_configs")
    .select("*")
    .eq("application_id", applicationId)
    .maybeSingle();

  return {
    application: appRes.data as DbApplication,
    intakeConversation: conversations.find((c) => c.type === "intake") ?? null,
    streams,
    itemsByStream,
    driverConversations: conversations.filter((c) => c.type === "driver"),
    forecastConfig: (fcData ?? null) as DbForecastConfig | null,
    latestSnapshot: (snapshotRes.data ?? null) as DbProjectionSnapshot | null,
  };
}
