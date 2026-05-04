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
import { makeFmt } from "@/lib/utils/currency";
import {
  ArrowLeft, Check, Loader2, BarChart3, AlertCircle,
  TrendingUp, TrendingDown, Minus, ChevronRight,
  ShoppingBag, Briefcase, Repeat, Landmark, TrendingUp as TrendUp,
  ScrollText, Zap,
} from "lucide-react";

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
  conservative: { label: "Conservative", volPct: 0.5, pricePct: 2.0, activeCls: "bg-amber-500 text-white shadow-sm",   inactiveCls: "text-amber-600 hover:bg-amber-50" },
  base:         { label: "Base",         volPct: 0,   pricePct: 0,   activeCls: "bg-cyan-600 text-white shadow-sm",    inactiveCls: "text-cyan-700  hover:bg-cyan-50"  },
  growth:       { label: "Growth Case",  volPct: 3.0, pricePct: 8.0, activeCls: "bg-emerald-500 text-white shadow-sm", inactiveCls: "text-emerald-600 hover:bg-emerald-50" },
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

const MONTHS_SHORT = ["J","F","M","A","M","J","J","A","S","O","N","D"];

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

/* ── Local state per stream ───────────────────────────────────── */
interface StreamDriver {
  id:                   string;
  name:                 string;
  type:                 string;
  baseRevMonthly:       number;
  volumeGrowthPct:      number;
  annualPriceGrowthPct: number;
  seasonalityPreset:    SeasonalityPreset;
  seasonalityMultipliers: number[];
  saveState: "idle" | "saving" | "saved" | "error";
}

/* ── Mini seasonality bar chart ───────────────────────────────── */
function SeasonalityChart({ multipliers }: { multipliers: number[] }) {
  const maxV = Math.max(...multipliers);
  const minV = Math.min(...multipliers);
  return (
    <div className="flex items-end gap-px h-12 w-full">
      {multipliers.map((v, i) => {
        const heightPct = maxV === minV ? 50 : 20 + ((v - minV) / (maxV - minV)) * 75;
        const isHigh = v > 1.06;
        const isLow  = v < 0.94;
        return (
          <div key={i} className="flex-1 flex flex-col justify-end">
            <div
              className={`w-full rounded-t-sm transition-all ${
                isHigh ? "bg-emerald-400" : isLow ? "bg-amber-400" : "bg-cyan-300"
              }`}
              style={{ height: `${heightPct}%` }}
              title={`${MONTHS_SHORT[i]}: ${Math.round(v * 100)}%`}
            />
          </div>
        );
      })}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════ */
export default function DriversPage() {
  const router = useRouter();
  const sb = useRef(createClient()).current;
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const streamsRef  = useRef<StreamDriver[]>([]);

  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [streams,  setStreams]  = useState<StreamDriver[]>([]);
  const [currency, setCurrency] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Always keep ref in sync for stale-closure–safe saves
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
            baseRevMonthly,
            volumeGrowthPct:      volPct,
            annualPriceGrowthPct: pricePct,
            seasonalityPreset:    preset,
            seasonalityMultipliers:
              (s.seasonality_multipliers as number[] | null)
              ?? SEASONALITY_PRESETS[preset]?.months
              ?? (Array(12).fill(1) as number[]),
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

  /* ── Persist (called after debounce) ──────────────────────── */
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

      // Reset to idle after 2.5 s
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

  /* ── Optimistic update + schedule save ────────────────────── */
  const updateDriver = useCallback((streamId: string, patch: Partial<StreamDriver>) => {
    setStreams((prev) => prev.map((s) => s.id === streamId ? { ...s, ...patch } : s));
    if (saveTimers.current[streamId]) clearTimeout(saveTimers.current[streamId]);
    saveTimers.current[streamId] = setTimeout(() => persistStream(streamId), 700);
  }, [persistStream]);

  /* ── Loading ───────────────────────────────────────────────── */
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

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <DashboardSidebar />
      <main className="flex-1 overflow-y-auto">

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-lg font-bold text-slate-900">Revenue Drivers</h1>
              <p className="text-xs text-slate-500">Growth rates &amp; seasonality — auto-saved per stream</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastSaved && (
              <span className="text-[11px] text-slate-400 hidden sm:block">
                Last saved {lastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <Link
              href="/dashboard/apply"
              className="flex items-center gap-1.5 text-xs font-semibold text-cyan-700 bg-cyan-50 hover:bg-cyan-100 px-3 py-1.5 rounded-lg transition-colors"
            >
              <BarChart3 size={13} />
              View Forecast
              <ChevronRight size={12} />
            </Link>
          </div>
        </div>

        {/* ── Empty state ─────────────────────────────────────── */}
        {streams.length === 0 && (
          <div className="flex flex-col items-center justify-center py-28 text-center px-6">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <BarChart3 className="w-7 h-7 text-slate-300" />
            </div>
            <p className="text-slate-700 font-semibold mb-1">No revenue streams yet</p>
            <p className="text-sm text-slate-400 mb-5">
              Run the Revenue Engine first — it extracts your streams and sets the initial driver rates.
            </p>
            <Link
              href="/dashboard/apply"
              className="px-5 py-2.5 bg-cyan-600 text-white text-sm font-semibold rounded-xl hover:bg-cyan-700 transition-colors"
            >
              Open Revenue Engine
            </Link>
          </div>
        )}

        {/* ── Stream cards ────────────────────────────────────── */}
        {streams.length > 0 && (
          <div className="max-w-2xl mx-auto px-6 py-6 space-y-5">

            {streams.map((stream) => {
              const scenario     = classifyScenario(stream.volumeGrowthPct, stream.annualPriceGrowthPct);
              const effectiveRate = effectiveMonthlyGrowth(stream.volumeGrowthPct, stream.annualPriceGrowthPct);
              const color        = STREAM_COLORS[stream.type] ?? "#6366f1";
              const StreamIcon   = STREAM_ICONS[stream.type] ?? Zap;

              return (
                <div key={stream.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">

                  {/* ── Card header ─── */}
                  <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100"
                       style={{ borderLeftColor: color, borderLeftWidth: 4 }}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                           style={{ background: `${color}18` }}>
                        <StreamIcon size={15} style={{ color }} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-800 leading-tight">{stream.name}</p>
                        <p className="text-[11px] text-slate-400">{STREAM_TYPE_LABELS[stream.type] ?? stream.type}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {stream.baseRevMonthly > 0 && (
                        <span className="text-[11px] text-slate-500 hidden md:block">
                          {fmt(stream.baseRevMonthly)}<span className="text-slate-400">/mo</span>
                        </span>
                      )}
                      {/* Save status */}
                      {stream.saveState === "saving" && (
                        <span className="flex items-center gap-1 text-[11px] text-slate-400">
                          <Loader2 size={11} className="animate-spin" /> Saving…
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

                  <div className="px-5 py-5 space-y-6">

                    {/* ── Growth drivers ─── */}
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Growth Drivers</p>

                      {/* Quick preset buttons */}
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
                            Custom
                          </span>
                        )}
                      </div>

                      {/* Sliders + inputs */}
                      <div className="space-y-3">
                        {/* Volume growth */}
                        <div className="flex items-center gap-3">
                          <label className="text-xs text-slate-500 w-32 shrink-0">Volume / month</label>
                          <input
                            type="range"
                            min={0} max={10} step={0.25}
                            value={stream.volumeGrowthPct}
                            onChange={(e) => updateDriver(stream.id, { volumeGrowthPct: parseFloat(e.target.value) })}
                            className="flex-1 h-1.5 accent-cyan-600 cursor-pointer"
                          />
                          <div className="flex items-center gap-1.5 shrink-0">
                            <input
                              type="number"
                              min={0} max={30} step={0.25}
                              value={stream.volumeGrowthPct}
                              onChange={(e) => {
                                const v = Math.max(0, Math.min(30, parseFloat(e.target.value) || 0));
                                updateDriver(stream.id, { volumeGrowthPct: v });
                              }}
                              className="w-14 text-xs font-bold text-slate-800 border border-slate-200 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-300/30"
                            />
                            <span className="text-[11px] text-slate-400 w-8">%/mo</span>
                          </div>
                        </div>

                        {/* Annual price increase */}
                        <div className="flex items-center gap-3">
                          <label className="text-xs text-slate-500 w-32 shrink-0">Price / year</label>
                          <input
                            type="range"
                            min={0} max={30} step={0.5}
                            value={stream.annualPriceGrowthPct}
                            onChange={(e) => updateDriver(stream.id, { annualPriceGrowthPct: parseFloat(e.target.value) })}
                            className="flex-1 h-1.5 accent-cyan-600 cursor-pointer"
                          />
                          <div className="flex items-center gap-1.5 shrink-0">
                            <input
                              type="number"
                              min={0} max={50} step={0.5}
                              value={stream.annualPriceGrowthPct}
                              onChange={(e) => {
                                const v = Math.max(0, Math.min(50, parseFloat(e.target.value) || 0));
                                updateDriver(stream.id, { annualPriceGrowthPct: v });
                              }}
                              className="w-14 text-xs font-bold text-slate-800 border border-slate-200 rounded-lg px-2 py-1.5 text-center focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-300/30"
                            />
                            <span className="text-[11px] text-slate-400 w-8">%/yr</span>
                          </div>
                        </div>
                      </div>

                      {/* Effective rate + scenario chip */}
                      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          {effectiveRate > 0
                            ? <TrendingUp   size={13} className="text-emerald-500" />
                            : effectiveRate < 0
                              ? <TrendingDown size={13} className="text-red-400" />
                              : <Minus        size={13} className="text-slate-300" />
                          }
                          <span className="text-[11px] text-slate-400">Effective rate</span>
                          <span className={`text-[12px] font-bold ${
                            effectiveRate > 0 ? "text-emerald-600"
                            : effectiveRate < 0 ? "text-red-500" : "text-slate-500"
                          }`}>
                            {effectiveRate > 0 ? "+" : ""}{effectiveRate.toFixed(2)}%/mo
                          </span>
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          scenario === "growth"       ? "bg-emerald-100 text-emerald-700"
                          : scenario === "conservative" ? "bg-amber-100 text-amber-700"
                          : scenario === "custom"       ? "bg-violet-100 text-violet-700"
                          : "bg-cyan-100 text-cyan-700"
                        }`}>
                          {scenario === "custom" ? "Custom" : GROWTH_PRESETS[scenario].label}
                        </span>
                      </div>
                    </div>

                    {/* ── Seasonality ─── */}
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Seasonality</p>
                      <div className="space-y-3">
                        {/* Preset selector */}
                        <select
                          value={stream.seasonalityPreset}
                          onChange={(e) => {
                            const preset = e.target.value as SeasonalityPreset;
                            const mults  = preset !== "custom"
                              ? SEASONALITY_PRESETS[preset].months
                              : stream.seasonalityMultipliers; // preserve existing custom
                            updateDriver(stream.id, {
                              seasonalityPreset:      preset,
                              seasonalityMultipliers: mults,
                            });
                          }}
                          className="w-full text-sm font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-300/40 focus:border-cyan-400 cursor-pointer appearance-none"
                          style={{
                            backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%236b7280' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")",
                            backgroundRepeat: "no-repeat",
                            backgroundPosition: "right 12px center",
                            paddingRight: "36px",
                          }}
                        >
                          {(Object.entries(SEASONALITY_PRESETS) as [SeasonalityPreset, { label: string }][]).map(([key, { label }]) => (
                            <option key={key} value={key}>{label}</option>
                          ))}
                        </select>

                        {/* Seasonality description */}
                        {stream.seasonalityPreset !== "none" && (
                          <p className="text-[11px] text-slate-400 italic">
                            {SEASONALITY_PRESETS[stream.seasonalityPreset]?.desc}
                            {stream.seasonalityPreset === "custom" && " — set by the Revenue Engine"}
                          </p>
                        )}

                        {/* Mini bar chart */}
                        {stream.seasonalityPreset !== "none" && (
                          <div className="space-y-1">
                            <SeasonalityChart multipliers={stream.seasonalityMultipliers} />
                            <div className="flex">
                              {MONTHS_SHORT.map((m, i) => (
                                <span key={i} className="text-[9px] text-slate-300 flex-1 text-center">{m}</span>
                              ))}
                            </div>
                            <div className="flex items-center gap-3 pt-1">
                              <span className="flex items-center gap-1 text-[10px] text-emerald-600">
                                <span className="w-2 h-2 rounded-sm bg-emerald-400 inline-block" /> Peak
                              </span>
                              <span className="flex items-center gap-1 text-[10px] text-amber-600">
                                <span className="w-2 h-2 rounded-sm bg-amber-400 inline-block" /> Trough
                              </span>
                              <span className="flex items-center gap-1 text-[10px] text-slate-400">
                                <span className="w-2 h-2 rounded-sm bg-cyan-300 inline-block" /> Neutral
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                  </div>
                </div>
              );
            })}

            {/* Summary footer */}
            <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-slate-700">{streams.length} revenue stream{streams.length !== 1 ? "s" : ""} configured</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Changes save automatically. Open the forecast to see updated projections.</p>
              </div>
              <Link
                href="/dashboard/apply"
                className="flex items-center gap-2 px-4 py-2 bg-cyan-600 text-white text-xs font-semibold rounded-xl hover:bg-cyan-700 transition-colors shrink-0"
              >
                <BarChart3 size={13} />
                View Forecast
              </Link>
            </div>

          </div>
        )}
      </main>
    </div>
  );
}
