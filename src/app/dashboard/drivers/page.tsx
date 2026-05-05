"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { DashboardSidebar } from "../_nav";
import {
  loadApplicationState,
  updateStream as updateStreamDb,
  getOrCreateApplication,
} from "@/lib/supabase/revenue";
import type { DbStreamItem } from "@/lib/supabase/revenue";
import { makeFmt } from "@/lib/utils/currency";
import {
  Check, Loader2, BarChart3, AlertCircle,
  TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight,
  ShoppingBag, Briefcase, Repeat, Landmark, TrendingUp as TrendUp,
  ScrollText, Zap, Sparkles,
} from "lucide-react";
import { SeasonalityBarChart } from "@/components/SeasonalityBarChart";

/* ── Constants (kept in sync with apply/page.tsx) ─────────────── */
type SeasonalityPreset =
  | "none" | "q4_peak" | "q1_slow" | "summer_peak" | "end_of_year" | "construction"
  | "wet_season" | "harvest" | "school_term" | "tourism_high" | "ramadan"
  | "back_to_school" | "mid_year_slow" | "agri_planting" | "custom";

type GrowthScenario = "conservative" | "base" | "growth" | "custom";

const SEASONALITY_PRESETS: Record<SeasonalityPreset, { label: string; desc: string; months: number[] }> = {
  none:          { label: "None (Flat)",      desc: "No seasonal variation",                       months: Array(12).fill(1) as number[] },
  q4_peak:       { label: "Q4 Retail",        desc: "Nov–Dec surge, Jan–Feb slow",                 months: [0.82,0.80,0.90,0.92,0.95,0.98,0.95,0.92,1.00,1.05,1.20,1.51] },
  q1_slow:       { label: "Q1 Slow",          desc: "Post-holiday demand dip in Q1",               months: [0.75,0.78,0.95,1.05,1.10,1.12,1.12,1.08,1.02,1.02,1.00,1.01] },
  summer_peak:   { label: "Summer Peak",      desc: "Jun–Aug high season",                         months: [0.80,0.82,0.90,1.00,1.08,1.20,1.28,1.22,1.10,0.98,0.90,0.72] },
  end_of_year:   { label: "Year-End Corp",    desc: "Q4 corporate budget flush",                   months: [0.88,0.88,0.92,0.95,1.00,1.00,0.92,0.95,1.05,1.10,1.18,1.17] },
  construction:  { label: "Dry Season",       desc: "Dry-season peak (construction / farming)",    months: [1.15,1.18,1.20,1.10,1.05,0.85,0.80,0.82,0.90,1.00,1.05,0.90] },
  wet_season:    { label: "Wet Season",       desc: "Rainy season slowdown, dry months peak",      months: [1.10,1.05,1.00,0.90,0.75,0.65,0.60,0.65,0.80,1.00,1.10,1.15] },
  harvest:       { label: "Harvest Season",   desc: "Oct–Nov harvest spike",                       months: [0.85,0.82,0.90,0.95,1.00,0.95,0.90,0.95,1.05,1.25,1.35,1.03] },
  school_term:   { label: "School Term",      desc: "School holidays dip, term-time peaks",        months: [1.00,1.05,1.10,1.05,1.05,0.70,0.65,0.70,1.20,1.25,1.15,0.80] },
  tourism_high:  { label: "Tourism High",     desc: "Jan + Dec peak high season",                  months: [1.30,1.25,1.15,1.05,0.90,0.80,0.85,0.90,0.95,1.00,1.10,1.35] },
  ramadan:       { label: "Ramadan / Eid",    desc: "Mar–Apr surge, Dec festive boost",            months: [0.95,0.95,1.50,1.60,1.20,0.90,0.85,0.88,0.90,0.92,0.95,1.40] },
  back_to_school:{ label: "Back-to-School",   desc: "Aug–Sep back-to-school spike",                months: [1.10,1.05,0.95,0.92,0.90,0.80,0.80,1.45,1.35,1.10,0.92,0.72] },
  mid_year_slow: { label: "Mid-Year Slow",    desc: "Jun–Aug mid-year trough",                     months: [1.10,1.05,1.02,0.95,0.85,0.75,0.72,0.78,0.95,1.10,1.15,1.18] },
  agri_planting: { label: "Agri Planting",    desc: "Mar–May planting spend cycle",                months: [0.80,0.82,1.10,1.30,1.20,0.90,0.75,0.80,0.85,1.00,1.05,0.93] },
  custom:        { label: "Custom",           desc: "Engine-defined monthly pattern",              months: Array(12).fill(1) as number[] },
};

const GROWTH_PRESETS: Record<Exclude<GrowthScenario, "custom">, {
  label: string; volPct: number; pricePct: number;
  activeCls: string; inactiveCls: string;
}> = {
  conservative: { label: "Conservative",  volPct: 0.5, pricePct: 2.0, activeCls: "bg-amber-500 text-white shadow-sm",    inactiveCls: "text-amber-600 hover:bg-amber-50"    },
  base:         { label: "Base",          volPct: 0,   pricePct: 0,   activeCls: "bg-cyan-600 text-white shadow-sm",     inactiveCls: "text-cyan-700  hover:bg-cyan-50"     },
  growth:       { label: "Growth Case",   volPct: 3.0, pricePct: 8.0, activeCls: "bg-emerald-500 text-white shadow-sm",  inactiveCls: "text-emerald-600 hover:bg-emerald-50" },
};

const STREAM_COLORS: Record<string, string> = {
  product: "#0e7490", service: "#7c3aed", subscription: "#059669",
  rental: "#b45309", marketplace: "#e11d48", contract: "#0f766e", custom: "#6366f1",
};

const STREAM_TYPE_LABELS: Record<string, string> = {
  product: "Product Sales", service: "Service / Project", subscription: "Subscription / MRR",
  rental: "Rental / Lease", marketplace: "Marketplace", contract: "Contract / B2B", custom: "Custom",
};

const STREAM_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>> = {
  product: ShoppingBag, service: Briefcase, subscription: Repeat,
  rental: Landmark, marketplace: TrendUp, contract: ScrollText, custom: Zap,
};


function effectiveMonthlyGrowth(volPct: number, pricePct: number): number {
  return parseFloat((volPct + pricePct / 12).toFixed(2));
}

function classifyScenario(volPct: number, pricePct: number): GrowthScenario {
  const r = effectiveMonthlyGrowth(volPct, pricePct);
  if (r === 0) return "base";
  if (Math.abs(r - effectiveMonthlyGrowth(0.5, 2.0)) < 0.05) return "conservative";
  if (Math.abs(r - effectiveMonthlyGrowth(3.0, 8.0)) < 0.1)  return "growth";
  return "custom";
}

/* ── GrowthOverride (mirrors apply/page.tsx — kept in sync) ───── */
interface GrowthOverride {
  id:                     string;
  scope:                  "item" | "category";
  targetId:               string;
  targetName:             string;
  volumeGrowthPct?:       number | null;
  annualPriceGrowthPct?:  number | null;
  seasonalityPreset?:     SeasonalityPreset | null;
  seasonalityMultipliers?: number[] | null;
  launchMonth?:           number | null;
  sunsetMonth?:           number | null;
}

/* ── Local state per stream ───────────────────────────────────── */
interface StreamDriver {
  id:                     string;
  name:                   string;
  type:                   string;
  confidence:             "high" | "medium" | "low";
  baseRevMonthly:         number;
  volumeGrowthPct:        number;
  annualPriceGrowthPct:   number;
  seasonalityPreset:      SeasonalityPreset;
  seasonalityMultipliers: number[];
  overrides:              GrowthOverride[];   // mirrors revenue_streams.item_overrides
  items:                  DbStreamItem[];
  saveState:              "idle" | "saving" | "saved" | "error";
}


/* ── Accordion wrapper ─────────────────────────────────────────── */
function Accordion({
  title, subtitle, open, onToggle, children,
}: {
  title: string; subtitle?: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="border border-slate-100 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        <div>
          <p className="text-xs font-bold text-slate-700">{title}</p>
          {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        {open ? <ChevronDown size={14} className="text-slate-400 shrink-0" /> : <ChevronRight size={14} className="text-slate-400 shrink-0" />}
      </button>
      {open && <div className="px-4 py-4">{children}</div>}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════ */
export default function DriversPage() {
  const router = useRouter();
  const sb = useRef(createClient()).current;
  const saveTimers  = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const streamsRef  = useRef<StreamDriver[]>([]);

  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [streams,   setStreams]   = useState<StreamDriver[]>([]);
  const [currency,  setCurrency]  = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, Record<string, boolean>>>({});

  // Always keep ref in sync
  streamsRef.current = streams;

  /* ── Load ──────────────────────────────────────────────────── */
  useEffect(() => {
    (async () => {
      try {
        const { data: { user }, error: authErr } = await sb.auth.getUser();
        if (authErr || !user) { router.push("/"); return; }

        const app   = await getOrCreateApplication(sb, user.id);
        const state = await loadApplicationState(sb, app.id);
        setCurrency(state.application.currency);

        const mapped: StreamDriver[] = state.streams.map((s) => {
          const items = state.itemsByStream[s.id] ?? [];
          const occ   = (s.rental_occupancy_pct ?? 100) / 100;
          const baseRevMonthly = items.reduce((sum, it) => {
            if (s.type === "marketplace") return sum + it.volume * (it.price / 100);
            if (s.type === "rental")      return sum + it.volume * it.price * occ;
            return sum + it.volume * it.price;
          }, 0);

          const volPct   = s.volume_growth_pct       != null ? Number(s.volume_growth_pct)       : Number(s.monthly_growth_pct ?? 0);
          const pricePct = s.annual_price_growth_pct != null ? Number(s.annual_price_growth_pct) : 0;
          const preset   = (s.seasonality_preset ?? "none") as SeasonalityPreset;

          return {
            id:   s.id,
            name: s.name,
            type: s.type,
            confidence: s.confidence ?? "medium",
            baseRevMonthly,
            volumeGrowthPct:        volPct,
            annualPriceGrowthPct:   pricePct,
            seasonalityPreset:      preset,
            seasonalityMultipliers:
              (s.seasonality_multipliers as number[] | null)
              ?? SEASONALITY_PRESETS[preset]?.months
              ?? (Array(12).fill(1) as number[]),
            overrides: (s.item_overrides as GrowthOverride[] | null) ?? [],
            items,
            saveState: "idle",
          };
        });

        setStreams(mapped);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load drivers");
      } finally {
        setLoading(false);
      }
    })();
  }, [router, sb]);

  /* ── Persist one stream ────────────────────────────────────── */
  const persistStream = useCallback(async (streamId: string) => {
    const s = streamsRef.current.find((x) => x.id === streamId);
    if (!s) return;

    setStreams((prev) => prev.map((x) => x.id === streamId ? { ...x, saveState: "saving" } : x));

    try {
      await updateStreamDb(sb, streamId, {
        volume_growth_pct:       s.volumeGrowthPct,
        annual_price_growth_pct: s.annualPriceGrowthPct,
        monthly_growth_pct:      effectiveMonthlyGrowth(s.volumeGrowthPct, s.annualPriceGrowthPct),
        seasonality_preset:      s.seasonalityPreset,
        seasonality_multipliers: s.seasonalityMultipliers,
      });
      setStreams((prev) => prev.map((x) => x.id === streamId ? { ...x, saveState: "saved" } : x));
      setLastSaved(new Date());
      setTimeout(() => {
        setStreams((prev) => prev.map((x) =>
          x.id === streamId && x.saveState === "saved" ? { ...x, saveState: "idle" } : x,
        ));
      }, 2500);
    } catch (e) {
      console.error("[drivers] persist:", e);
      setStreams((prev) => prev.map((x) => x.id === streamId ? { ...x, saveState: "error" } : x));
    }
  }, [sb]);

  /* ── Per-item seasonality picker state ─────────────────────── */
  const [openItemPicker, setOpenItemPicker] = useState<string | null>(null);
  // Pending (un-confirmed) preset selection inside the modal
  const [pendingPreset,  setPendingPreset]  = useState<SeasonalityPreset | null>(null);
  // Custom seasonality editor
  const [customMults,       setCustomMults]       = useState<number[]>(Array(12).fill(1) as number[]);
  const [customInputStrings, setCustomInputStrings] = useState<string[]>(Array(12).fill("1.00") as string[]);
  const [customMode,  setCustomMode]  = useState<string | null>(null);

  const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  const openPicker = (itemId: string, existingMults?: number[] | null, currentPreset?: string | null) => {
    if (openItemPicker === itemId) { setOpenItemPicker(null); setCustomMode(null); return; }
    setOpenItemPicker(itemId);
    setCustomMode(null);
    const mults = existingMults ?? Array(12).fill(1) as number[];
    setCustomMults(mults);
    setCustomInputStrings(mults.map(v => v.toFixed(2)));
    // Initialise pending to the item's current preset so the chart preview shows immediately
    setPendingPreset((currentPreset ?? null) as SeasonalityPreset | null);
  };

  const closePicker = () => { setOpenItemPicker(null); setCustomMode(null); };

  /* ── Update one item's seasonality ─────────────────────────────────────────── */
  // Dual-write strategy for reliability:
  //   1. revenue_streams.item_overrides  (migration 010 — highest priority in getItemParams)
  //   2. stream_items.seasonality_preset (migration 004 — fallback in getItemParams)
  // If migration 010 hasn't been applied the first write fails silently; the second
  // write ensures the apply page can still read the value via its fallback chain.
  const updateItemSeason = useCallback((
    itemId: string, itemName: string, streamId: string,
    preset: SeasonalityPreset | null,
    multipliers?: number[] | null,
  ) => {
    // Capture the resolved newOverrides outside setStreams so we can use them in the
    // DB writes below (setStreams updater may run asynchronously in React 18).
    let resolvedOverrides: GrowthOverride[] = [];

    setStreams((prev) => prev.map((s) => {
      if (s.id !== streamId) return s;

      const existing = s.overrides.find(
        (o) => o.scope === "item" && (o.targetId === itemId || o.targetName === itemName)
      );

      let newOverrides: GrowthOverride[];
      if (preset === null) {
        // "Stream default" — strip seasonality; remove override if nothing else is on it.
        if (existing) {
          const stripped = { ...existing, seasonalityPreset: null, seasonalityMultipliers: null };
          const hasOther = stripped.volumeGrowthPct != null || stripped.annualPriceGrowthPct != null
                        || stripped.launchMonth != null || stripped.sunsetMonth != null;
          newOverrides = hasOther
            ? s.overrides.map((o) => (o === existing ? stripped : o))
            : s.overrides.filter((o) => o !== existing);
        } else {
          newOverrides = s.overrides;
        }
      } else if (existing) {
        newOverrides = s.overrides.map((o) =>
          o === existing
            ? { ...o, seasonalityPreset: preset, seasonalityMultipliers: preset === "custom" ? (multipliers ?? null) : null }
            : o
        );
      } else {
        const newOvr: GrowthOverride = {
          id:          crypto.randomUUID(),
          scope:       "item",
          targetId:    itemId,
          targetName:  itemName,
          seasonalityPreset:      preset,
          seasonalityMultipliers: preset === "custom" ? (multipliers ?? null) : null,
        };
        newOverrides = [...s.overrides, newOvr];
      }

      resolvedOverrides = newOverrides;
      return { ...s, overrides: newOverrides };
    }));

    // ── DB write 1: revenue_streams.item_overrides (migration 010, primary) ──
    const dbVal = resolvedOverrides.length > 0 ? (resolvedOverrides as unknown[]) : null;
    updateStreamDb(sb, streamId, { item_overrides: dbVal }).catch((e) =>
      console.error("[drivers] item_overrides write failed (migration 010 applied?):", e)
    );

    // ── DB write 2: stream_items.seasonality_preset (migration 004, fallback) ──
    // This is the column apply/page.tsx reads via getItemParams' fallback chain
    // (it.seasonalityPreset), so it works even when migration 010 is missing.
    (async () => {
      const { error } = await sb
        .from("stream_items")
        .update({ seasonality_preset: preset ?? null })
        .eq("id", itemId);
      if (error) {
        console.error("[drivers] stream_items seasonality_preset write failed:", error);
        return;
      }
      // Also try to write seasonality_multipliers (migration 009 — optional column)
      if (preset === "custom" && multipliers) {
        const { error: mErr } = await sb
          .from("stream_items")
          .update({ seasonality_multipliers: multipliers })
          .eq("id", itemId);
        if (mErr) console.error("[drivers] stream_items seasonality_multipliers write (migration 009 applied?):", mErr);
      }
    })();
  }, [sb]);

  /* ── Optimistic update + debounced save ───────────────────── */
  const updateDriver = useCallback((streamId: string, patch: Partial<StreamDriver>) => {
    setStreams((prev) => prev.map((s) => s.id === streamId ? { ...s, ...patch } : s));
    if (saveTimers.current[streamId]) clearTimeout(saveTimers.current[streamId]);
    saveTimers.current[streamId] = setTimeout(() => persistStream(streamId), 700);
  }, [persistStream]);

  /* ── Save all + navigate ───────────────────────────────────── */
  const saveDrivers = useCallback(async () => {
    setSaving(true);
    // Flush any pending debounce timers immediately
    Object.values(saveTimers.current).forEach(clearTimeout);
    saveTimers.current = {};
    await Promise.all(streamsRef.current.map((s) => persistStream(s.id)));
    setSaving(false);
    router.push("/dashboard/apply");
  }, [persistStream, router]);

  /* ── Section toggle ────────────────────────────────────────── */
  const toggleSection = (streamId: string, section: string) => {
    setOpenSections((prev) => ({
      ...prev,
      [streamId]: { ...prev[streamId], [section]: !prev[streamId]?.[section] },
    }));
  };

  /* ── Loading ────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="flex h-screen bg-slate-50 overflow-hidden">
        <DashboardSidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-cyan-600 animate-spin" />
            <p className="text-sm text-slate-500">Loading drivers…</p>
          </div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen bg-slate-50 overflow-hidden">
        <DashboardSidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <AlertCircle className="w-10 h-10 text-red-400 mx-auto" />
            <p className="text-slate-700 font-semibold">Couldn&apos;t load drivers</p>
            <p className="text-sm text-slate-500">{error}</p>
            <button onClick={() => router.refresh()} className="text-sm text-cyan-600 underline">Try again</button>
          </div>
        </main>
      </div>
    );
  }

  const fmt = makeFmt(currency);
  const totalRevMonthly = streams.reduce((s, x) => s + x.baseRevMonthly, 0);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <DashboardSidebar />
      <main className="flex-1 overflow-y-auto pb-20 md:pb-0">

        {/* ── Header ───────────────────────────────────────────── */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900">Revenue Drivers</h1>
              {streams.length > 0 && (
                <span className="text-[11px] font-semibold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                  {streams.length} stream{streams.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {lastSaved
                ? `Auto-saved at ${lastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : "Growth rates & seasonality — auto-saved per stream"}
            </p>
          </div>
          {totalRevMonthly > 0 && (
            <div className="text-right hidden sm:block">
              <p className="text-[11px] text-slate-400">Total base revenue</p>
              <p className="text-base font-bold text-slate-800">{fmt(totalRevMonthly)}<span className="text-slate-400 text-xs font-normal">/mo</span></p>
            </div>
          )}
        </div>

        {/* ── Empty state ──────────────────────────────────────── */}
        {streams.length === 0 && (
          <div className="flex flex-col items-center justify-center py-28 text-center px-6">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <BarChart3 className="w-7 h-7 text-slate-300" />
            </div>
            <p className="text-slate-700 font-semibold mb-1">No revenue streams yet</p>
            <p className="text-sm text-slate-400 mb-5">
              Run the Revenue Engine first to set up your streams and driver rates.
            </p>
            <Link
              href="/dashboard/apply"
              className="px-5 py-2.5 bg-cyan-600 text-white text-sm font-semibold rounded-xl hover:bg-cyan-700 transition-colors"
            >
              Open Revenue Engine
            </Link>
          </div>
        )}

        {/* ── Stream cards ─────────────────────────────────────── */}
        {streams.length > 0 && (
          <div className="max-w-5xl mx-auto px-3 sm:px-6 py-6 space-y-5">

            {streams.map((stream) => {
              const scenario      = classifyScenario(stream.volumeGrowthPct, stream.annualPriceGrowthPct);
              const effectiveRate = effectiveMonthlyGrowth(stream.volumeGrowthPct, stream.annualPriceGrowthPct);
              const color         = STREAM_COLORS[stream.type] ?? "#6366f1";
              const StreamIcon    = STREAM_ICONS[stream.type] ?? Zap;
              const isExpOpen     = openSections[stream.id]?.expansion ?? false;
              const isAovOpen     = openSections[stream.id]?.overrides ?? false;
              const streamTotal   = stream.items.reduce((sum, it) => sum + it.volume * it.price, 0);

              // Confidence chip
              const confLabel = stream.confidence === "high" ? "High Confidence" : stream.confidence === "low" ? "Low Confidence" : "Medium Confidence";
              const confCls   = stream.confidence === "high"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : stream.confidence === "low"
                  ? "bg-red-50 text-red-600 border border-red-200"
                  : "bg-amber-50 text-amber-700 border border-amber-200";

              return (
                <div key={stream.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">

                  {/* ── Card header ──────────────────────────── */}
                  <div
                    className="flex items-center justify-between px-5 py-4 border-b border-slate-100"
                    style={{ borderLeftColor: color, borderLeftWidth: 4 }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                           style={{ background: `${color}18` }}>
                        <StreamIcon size={15} style={{ color }} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 leading-tight truncate">{stream.name}</p>
                        <p className="text-[11px] text-slate-400">
                          {STREAM_TYPE_LABELS[stream.type] ?? stream.type}
                          {stream.baseRevMonthly > 0 && (
                            <> · <span className="font-semibold text-slate-600">{fmt(stream.baseRevMonthly)}/mo</span></>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {stream.saveState === "saving" && (
                        <span className="flex items-center gap-1 text-[11px] text-slate-400">
                          <Loader2 size={11} className="animate-spin" /> Saving
                        </span>
                      )}
                      {stream.saveState === "saved" && (
                        <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                          <Check size={11} /> Saved
                        </span>
                      )}
                      {stream.saveState === "error" && (
                        <span className="flex items-center gap-1 text-[11px] text-red-500">
                          <AlertCircle size={11} /> Error
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="px-3 sm:px-5 py-5 space-y-6">

                    {/* ── Growth Logic ─────────────────────── */}
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Growth Logic</p>

                      {/* Preset buttons */}
                      <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg w-fit mb-4">
                        {(["conservative", "base", "growth"] as const).map((sc) => {
                          const p      = GROWTH_PRESETS[sc];
                          const active = scenario === sc;
                          return (
                            <button
                              key={sc}
                              onClick={() => updateDriver(stream.id, {
                                volumeGrowthPct:      p.volPct,
                                annualPriceGrowthPct: p.pricePct,
                              })}
                              className={`text-[11px] font-semibold px-3 py-1 rounded-md transition-all ${
                                active ? p.activeCls : `text-slate-400 ${p.inactiveCls}`
                              }`}
                            >
                              {p.label}
                            </button>
                          );
                        })}
                        {scenario === "custom" && (
                          <span className="text-[11px] font-semibold px-3 py-1 rounded-md bg-violet-500 text-white shadow-sm">
                            Custom growth inputs
                          </span>
                        )}
                      </div>

                      {/* Sliders */}
                      <div className="space-y-3">
                        {/* Volume growth */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-xs text-slate-500">Volume Growth</label>
                            <div className="flex items-center gap-1 shrink-0">
                              <input
                                type="number" min={0} max={30} step={0.25}
                                value={stream.volumeGrowthPct}
                                onChange={(e) => {
                                  const v = Math.max(0, Math.min(30, parseFloat(e.target.value) || 0));
                                  updateDriver(stream.id, { volumeGrowthPct: v });
                                }}
                                className="w-14 text-xs font-bold text-slate-800 border border-slate-200 rounded-lg px-1.5 py-1.5 text-center focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-300/30"
                              />
                              <span className="text-[11px] text-slate-400">% / mo</span>
                            </div>
                          </div>
                          <input
                            type="range" min={0} max={10} step={0.25}
                            value={stream.volumeGrowthPct}
                            onChange={(e) => updateDriver(stream.id, { volumeGrowthPct: parseFloat(e.target.value) })}
                            className="w-full h-1.5 accent-cyan-600 cursor-pointer"
                          />
                        </div>

                        {/* Annual price */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-xs text-slate-500">Annual Price Increase</label>
                            <div className="flex items-center gap-1 shrink-0">
                              <input
                                type="number" min={0} max={50} step={0.5}
                                value={stream.annualPriceGrowthPct}
                                onChange={(e) => {
                                  const v = Math.max(0, Math.min(50, parseFloat(e.target.value) || 0));
                                  updateDriver(stream.id, { annualPriceGrowthPct: v });
                                }}
                                className="w-14 text-xs font-bold text-slate-800 border border-slate-200 rounded-lg px-1.5 py-1.5 text-center focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-300/30"
                              />
                              <span className="text-[11px] text-slate-400">% / yr</span>
                            </div>
                          </div>
                          <input
                            type="range" min={0} max={30} step={0.5}
                            value={stream.annualPriceGrowthPct}
                            onChange={(e) => updateDriver(stream.id, { annualPriceGrowthPct: parseFloat(e.target.value) })}
                            className="w-full h-1.5 accent-cyan-600 cursor-pointer"
                          />
                        </div>
                      </div>

                      {/* Effective rate row */}
                      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          {effectiveRate > 0
                            ? <TrendingUp   size={13} className="text-emerald-500" />
                            : effectiveRate < 0
                              ? <TrendingDown size={13} className="text-red-400" />
                              : <Minus        size={13} className="text-slate-300" />
                          }
                          <span className="text-[11px] text-slate-400">Effective rate:</span>
                          <span className={`text-[12px] font-bold ${
                            effectiveRate > 0 ? "text-emerald-600"
                            : effectiveRate < 0 ? "text-red-500" : "text-slate-500"
                          }`}>
                            {effectiveRate > 0 ? "+" : ""}{effectiveRate.toFixed(2)}% / month
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${confCls}`}>
                            {confLabel}
                          </span>
                          <span className="text-[10px] text-slate-400">Forecast reliability</span>
                        </div>
                      </div>
                    </div>

                    {/* ── Seasonality ──────────────────────── */}
                    <div>
                      {/* Seasonality — label + dropdown inline, chart always visible */}
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Seasonality</p>
                        <select
                          value={stream.seasonalityPreset}
                          onChange={(e) => {
                            const preset = e.target.value as SeasonalityPreset;
                            const mults  = preset !== "custom"
                              ? SEASONALITY_PRESETS[preset].months
                              : stream.seasonalityMultipliers;
                            updateDriver(stream.id, {
                              seasonalityPreset:      preset,
                              seasonalityMultipliers: mults,
                            });
                          }}
                          className="text-[10px] border border-slate-200 rounded-lg px-2 py-1 text-slate-700 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/20"
                        >
                          {(Object.entries(SEASONALITY_PRESETS) as [SeasonalityPreset, { label: string }][]).map(([key, { label }]) => (
                            <option key={key} value={key}>{label}</option>
                          ))}
                        </select>
                      </div>

                      {/* Bar preview — always visible */}
                      <SeasonalityBarChart multipliers={stream.seasonalityMultipliers} height={160} />

                      {/* Description */}
                      {stream.seasonalityPreset !== "none" && (
                        <p className="text-[11px] text-slate-400 italic mt-1">
                          {SEASONALITY_PRESETS[stream.seasonalityPreset]?.desc}
                          {stream.seasonalityPreset === "custom" && " — set by the Revenue Engine"}
                        </p>
                      )}
                    </div>

                    {/* ── Expansion Events accordion ────────── */}
                    <Accordion
                      title="Expansion Events"
                      subtitle="Model a future capacity increase from a specific month"
                      open={isExpOpen}
                      onToggle={() => toggleSection(stream.id, "expansion")}
                    >
                      <div className="text-center py-6">
                        <Sparkles size={22} className="text-slate-200 mx-auto mb-2" />
                        <p className="text-xs text-slate-400 font-medium">No expansion events configured</p>
                        <p className="text-[11px] text-slate-300 mt-1">
                          e.g. new branch, new product category, new distributor — coming soon
                        </p>
                      </div>
                    </Accordion>

                    {/* ── Advanced Overrides accordion ──────── */}
                    {stream.items.length > 0 && (
                      <Accordion
                        title="Advanced Overrides"
                        subtitle={`Item & category-specific growth, pricing, and seasonality rules`}
                        open={isAovOpen}
                        onToggle={() => toggleSection(stream.id, "overrides")}
                      >
                        <div className="overflow-x-auto -mx-3 px-3">
                          <table className="min-w-[480px] w-full text-[11px] text-slate-600 border-collapse">
                            <thead>
                              <tr className="border-b border-slate-100">
                                <th className="text-left font-semibold text-slate-400 pb-2 pr-3">Item / Name</th>
                                <th className="text-left font-semibold text-slate-400 pb-2 pr-3">Category</th>
                                <th className="text-right font-semibold text-slate-400 pb-2 pr-3">Units/mo</th>
                                <th className="text-right font-semibold text-slate-400 pb-2 pr-3">Unit Price</th>
                                <th className="text-left font-semibold text-slate-400 pb-2 pr-3">Season</th>
                                <th className="text-right font-semibold text-slate-400 pb-2">Monthly Rev</th>
                              </tr>
                            </thead>
                            <tbody>
                              {stream.items.map((it) => {
                                // Read per-item seasonality from item_overrides (same source apply/page uses)
                                const itemOvr = stream.overrides.find(
                                  (o) => o.scope === "item" && (o.targetId === it.id || o.targetName === it.name)
                                );
                                const itemPreset = itemOvr?.seasonalityPreset ?? null;
                                const itemMults  = itemOvr?.seasonalityMultipliers ?? null;
                                const hasPreset  = !!itemPreset && itemPreset !== "none";
                                return (
                                <tr key={it.id} className="border-b border-slate-50 last:border-0">
                                  <td className="py-2 pr-3 font-medium text-slate-700 whitespace-nowrap">{it.name}</td>
                                  <td className="py-2 pr-3 text-slate-400">{(!it.category || it.category === "General") ? stream.name : it.category}</td>
                                  <td className="py-2 pr-3 text-right tabular-nums">{it.volume.toLocaleString()}</td>
                                  <td className="py-2 pr-3 text-right tabular-nums">{fmt(it.price)}</td>
                                  <td className="py-2 pr-3">
                                    <button
                                      onClick={() => openPicker(it.id, itemMults, itemPreset)}
                                      className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors whitespace-nowrap ${
                                        hasPreset
                                          ? "text-cyan-700 bg-cyan-50 border-cyan-200 hover:bg-cyan-100"
                                          : "text-slate-400 bg-slate-50 border-slate-200 hover:bg-slate-100"
                                      }`}
                                    >
                                      {hasPreset
                                        ? (itemPreset === "custom" ? "Custom ✦" : SEASONALITY_PRESETS[itemPreset]?.label ?? itemPreset)
                                        : "Stream ↓"}
                                    </button>
                                  </td>
                                  <td className="py-2 text-right font-semibold text-slate-700 tabular-nums">{fmt(it.volume * it.price)}</td>
                                </tr>
                                );
                              })}
                            </tbody>
                            {stream.items.length > 1 && (
                              <tfoot>
                                <tr className="border-t border-slate-200">
                                  <td colSpan={5} className="pt-2.5 text-[11px] font-bold text-slate-500">Stream Total</td>
                                  <td className="pt-2.5 text-right text-[11px] font-bold text-slate-800 tabular-nums">{fmt(streamTotal)}/mo</td>
                                </tr>
                              </tfoot>
                            )}
                          </table>
                        </div>
                      </Accordion>
                    )}

                  </div>
                </div>
              );
            })}

            {/* ── Save Drivers footer ───────────────────────────── */}
            <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-slate-700">
                  {streams.length} revenue stream{streams.length !== 1 ? "s" : ""} configured
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Changes save automatically. Click to lock in your custom drivers.
                </p>
              </div>
              <button
                onClick={saveDrivers}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white rounded-xl transition-colors shrink-0 disabled:opacity-70"
                style={{ background: saving ? "#64748b" : "linear-gradient(135deg,#0e7490,#0891b2)" }}
              >
                {saving
                  ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
                  : <><Check size={14} /> Save Drivers</>
                }
              </button>
            </div>

          </div>
        )}
      </main>

      {/* ── Item Seasonality Modal (centered) ── */}
      {openItemPicker && (() => {
        let activeItem: DbStreamItem | undefined;
        let activeStreamId = "";
        for (const s of streams) {
          const found = s.items.find((it) => it.id === openItemPicker);
          if (found) { activeItem = found; activeStreamId = s.id; break; }
        }
        if (!activeItem) return null;

        // Resolve preview multipliers from the PENDING selection
        const activeStream = streams.find((s) => s.id === activeStreamId);
        // Saved custom mults come from the item's current override (not stream_items column)
        const savedItemOvr = activeStream?.overrides.find(
          (o) => o.scope === "item" && (o.targetId === openItemPicker || o.targetName === activeItem.name)
        );
        const savedCustomMults = savedItemOvr?.seasonalityMultipliers ?? null;

        const previewMults: number[] | null =
          customMode === openItemPicker
            ? customMults
            : pendingPreset === "custom"
              ? (savedCustomMults ?? customMults)
              : pendingPreset === null
                ? (activeStream?.seasonalityMultipliers ?? null)
                : pendingPreset === "none"
                  ? Array(12).fill(1) as number[]
                  : SEASONALITY_PRESETS[pendingPreset]?.months ?? null;

        // Label for the right-panel header
        const pendingLabel =
          pendingPreset === null       ? "Stream default"
          : pendingPreset === "custom" ? "Custom"
          : SEASONALITY_PRESETS[pendingPreset]?.label ?? pendingPreset;

        // Whether the pending selection differs from the saved override preset
        const currentSaved = (savedItemOvr?.seasonalityPreset ?? null) as SeasonalityPreset | null;
        const hasChange = pendingPreset !== currentSaved;

        return (
          <>
            {/* Backdrop — above bottom tab bar (z-50) */}
            <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm" onClick={closePicker} />

            {/* Modal:
                Mobile  → bottom sheet (slides up from bottom, rounded top corners, full width)
                Desktop → centered dialog with max-width                                        */}
            <div className="fixed inset-x-0 bottom-0 sm:inset-0 z-[70] flex items-end sm:items-center sm:justify-center sm:p-6 pointer-events-none">
              <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border-t sm:border border-slate-200 w-full sm:max-w-3xl pointer-events-auto flex flex-col max-h-[92vh] sm:max-h-[85vh]">

                {/* Drag handle — mobile only */}
                <div className="sm:hidden flex justify-center pt-3 pb-1 shrink-0">
                  <div className="w-10 h-1 rounded-full bg-slate-200" />
                </div>

                {/* Header */}
                <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 shrink-0">
                  <div>
                    <p className="text-sm font-bold text-slate-800">{activeItem.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">Pick a pattern, then tap <strong>Done</strong></p>
                  </div>
                  <button
                    onClick={closePicker}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors text-xl leading-none"
                  >×</button>
                </div>

                {customMode !== openItemPicker ? (
                  /* ── Preset picker ──
                     Mobile:  preset list on top (scrollable, capped height) + chart + buttons below
                     Desktop: side-by-side two-column                                              */
                  <div className="flex flex-col sm:flex-row flex-1 min-h-0 overflow-hidden">

                    {/* Preset list */}
                    <div className="sm:w-64 sm:shrink-0 sm:border-r border-b sm:border-b-0 border-slate-100 overflow-y-auto py-2 sm:py-3 px-3 space-y-0.5 max-h-[36vh] sm:max-h-none">

                      {/* Stream default */}
                      <button
                        onClick={() => setPendingPreset(null)}
                        className={`w-full text-left px-3 py-2 sm:py-2.5 rounded-xl transition-colors flex items-start justify-between gap-2 ${
                          pendingPreset === null ? "bg-cyan-50 text-cyan-700" : "text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <span>
                          <span className="text-sm font-medium block">Stream default</span>
                          <span className="text-xs text-slate-400 font-normal">Inherit the stream&apos;s pattern</span>
                        </span>
                        {pendingPreset === null && <Check size={14} className="text-cyan-600 mt-0.5 shrink-0" />}
                      </button>

                      {/* Named presets */}
                      {(Object.keys(SEASONALITY_PRESETS) as SeasonalityPreset[])
                        .filter((p) => p !== "custom")
                        .map((p) => (
                          <button key={p}
                            onClick={() => setPendingPreset(p)}
                            className={`w-full text-left px-3 py-2 sm:py-2.5 rounded-xl transition-colors flex items-start justify-between gap-2 ${
                              pendingPreset === p ? "bg-cyan-50 text-cyan-700" : "text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            <span>
                              <span className="text-sm font-medium block">{SEASONALITY_PRESETS[p].label}</span>
                              <span className="text-xs text-slate-400 font-normal leading-tight hidden sm:block">{SEASONALITY_PRESETS[p].desc}</span>
                            </span>
                            {pendingPreset === p && <Check size={14} className="text-cyan-600 mt-0.5 shrink-0" />}
                          </button>
                        ))}

                      {/* Custom */}
                      <button
                        onClick={() => {
                          setCustomMults((activeItem.seasonality_multipliers as number[] | null) ?? Array(12).fill(1) as number[]);
                          setCustomMode(openItemPicker);
                        }}
                        className={`w-full text-left px-3 py-2 sm:py-2.5 rounded-xl transition-colors flex items-start justify-between gap-2 ${
                          pendingPreset === "custom" ? "bg-cyan-50 text-cyan-700" : "text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <span>
                          <span className="text-sm font-medium block">Custom ✦</span>
                          <span className="text-xs text-slate-400 font-normal hidden sm:block">Set your own monthly multipliers</span>
                        </span>
                        {pendingPreset === "custom" && <Check size={14} className="text-cyan-600 mt-0.5 shrink-0" />}
                      </button>
                    </div>

                    {/* Chart preview + Done/Cancel */}
                    <div className="flex-1 flex flex-col px-4 sm:px-8 py-3 sm:py-6 min-h-0">
                      {/* Chart — hidden on mobile when nothing selected yet to save space */}
                      <div className="flex-1 flex flex-col justify-center min-h-0">
                        {previewMults ? (
                          <>
                            <p className="text-sm font-semibold text-slate-700 mb-0.5">{pendingLabel}</p>
                            {pendingPreset && pendingPreset !== "none" && pendingPreset !== "custom" && (
                              <p className="text-xs text-slate-400 mb-2 sm:mb-4 hidden sm:block">{SEASONALITY_PRESETS[pendingPreset]?.desc}</p>
                            )}
                            {pendingPreset === null && (
                              <p className="text-xs text-slate-400 mb-2 sm:mb-4 hidden sm:block">Using the stream&apos;s seasonality pattern</p>
                            )}
                            <SeasonalityBarChart multipliers={previewMults} height={110} />
                          </>
                        ) : (
                          <div className="hidden sm:flex flex-col items-center justify-center h-full gap-3 text-center">
                            <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center">
                              <BarChart3 size={24} className="text-slate-200" />
                            </div>
                            <p className="text-sm text-slate-400">Select a preset on the left to preview its pattern</p>
                          </div>
                        )}
                      </div>

                      {/* Done / Cancel */}
                      <div className="flex gap-3 pt-3 sm:pt-5 border-t border-slate-100 mt-3 sm:mt-5 shrink-0">
                        <button
                          onClick={closePicker}
                          className="flex-1 text-sm font-medium py-3 sm:py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                        >Cancel</button>
                        <button
                          onClick={() => {
                            updateItemSeason(openItemPicker, activeItem.name, activeStreamId, pendingPreset, null);
                            closePicker();
                          }}
                          disabled={!hasChange}
                          className="flex-1 text-sm font-semibold py-3 sm:py-2.5 rounded-xl text-white transition-colors disabled:opacity-40"
                          style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}
                        >
                          {hasChange ? "Done — Apply" : "No changes"}
                        </button>
                      </div>
                    </div>
                  </div>

                ) : (
                  /* ── Custom editor ── */
                  <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5 space-y-4">
                    <p className="text-sm text-slate-500">Set a multiplier for each month — <strong>1.0</strong> = baseline, <strong>0</strong> = no revenue, <strong>5.0</strong> = 5× peak</p>
                    <SeasonalityBarChart multipliers={customMults} height={110} />
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 sm:gap-3 pt-1">
                      {MONTHS_SHORT.map((m, i) => (
                        <div key={m} className="flex flex-col items-center gap-1">
                          <span className="text-[11px] font-semibold text-slate-400">{m}</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={customInputStrings[i]}
                            onChange={(e) => {
                              const raw = e.target.value;
                              // Update display string immediately so the user can type freely
                              setCustomInputStrings((prev) => { const n = [...prev]; n[i] = raw; return n; });
                              // Also update the numeric state for the chart
                              const v = Math.max(0, Math.min(5, parseFloat(raw) || 0));
                              setCustomMults((prev) => { const n = [...prev]; n[i] = v; return n; });
                            }}
                            onBlur={(e) => {
                              // On blur normalise the display to 2 decimal places
                              const v = Math.max(0, Math.min(5, parseFloat(e.target.value) || 0));
                              setCustomMults((prev) => { const n = [...prev]; n[i] = v; return n; });
                              setCustomInputStrings((prev) => { const n = [...prev]; n[i] = v.toFixed(2); return n; });
                            }}
                            className="w-full text-center text-sm font-medium border border-slate-200 rounded-xl px-1 py-2.5 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-300/30"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-3 pt-3">
                      <button
                        onClick={() => setCustomMode(null)}
                        className="flex-1 text-sm font-medium py-3 sm:py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                      >← Presets</button>
                      <button
                        onClick={() => {
                          updateItemSeason(openItemPicker, activeItem.name, activeStreamId, "custom", customMults);
                          setPendingPreset("custom");
                          closePicker();
                        }}
                        className="flex-1 text-sm font-semibold py-3 sm:py-2.5 rounded-xl text-white transition-colors"
                        style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}
                      >Apply Custom</button>
                    </div>
                  </div>
                )}

              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
