"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { loadApplicationState } from "@/lib/supabase/revenue";
import type {
  DbRevenueStream, DbStreamItem, DbApplication,
  StreamType, Confidence,
} from "@/lib/supabase/revenue";

/* ══════════════════════════════════════ types ══ */
type SeasonalityPreset =
  | "none" | "q4_peak" | "q1_slow" | "summer_peak" | "end_of_year"
  | "construction" | "wet_season" | "harvest" | "school_term"
  | "tourism_high" | "ramadan" | "back_to_school" | "mid_year_slow"
  | "agri_planting" | "custom";

interface GrowthOverride {
  id: string; scope: "category" | "item"; targetId: string; targetName: string;
  volumeGrowthPct: number | null; annualPriceGrowthPct: number | null;
  seasonalityPreset: SeasonalityPreset | null; seasonalityMultipliers: number[] | null;
  launchMonth: number | null; sunsetMonth: number | null;
}
interface StreamItem {
  id: string; name: string; category: string; volume: number; price: number;
  unit: string; seasonalityPreset?: SeasonalityPreset; seasonalityMultipliers?: number[];
}
interface RevenueStream {
  id: string; name: string; type: StreamType; confidence: Confidence;
  volumeGrowthPct: number; annualPriceGrowthPct: number; monthlyGrowthPct: number;
  subNewPerMonth: number; subChurnPct: number; rentalOccupancyPct: number;
  seasonalityPreset: SeasonalityPreset; seasonalityMultipliers: number[];
  expansionMonth: number | null; expansionMultiplier: number;
  overrides: GrowthOverride[]; items: StreamItem[];
}
interface ProjMonth {
  index: number; year: number; monthLabel: string; yearMonth: string; total: number;
  byStream: { id: string; name: string; type: StreamType; rev: number }[];
}

/* ══════════════════════════════════════ seasonality presets ══ */
const SEA: Record<SeasonalityPreset, { label: string; months: number[] }> = {
  none:          { label: "Flat",           months: Array(12).fill(1) },
  q4_peak:       { label: "Q4 Retail",      months: [0.82,0.80,0.90,0.92,0.95,0.98,0.95,0.92,1.00,1.05,1.20,1.51] },
  q1_slow:       { label: "Q1 Slow",        months: [0.75,0.78,0.95,1.05,1.10,1.12,1.12,1.08,1.02,1.02,1.00,1.01] },
  summer_peak:   { label: "Summer Peak",    months: [0.80,0.82,0.90,1.00,1.08,1.20,1.28,1.22,1.10,0.98,0.90,0.72] },
  end_of_year:   { label: "Year-End Corp",  months: [0.88,0.88,0.92,0.95,1.00,1.00,0.92,0.95,1.05,1.10,1.18,1.17] },
  construction:  { label: "Dry Season",     months: [1.15,1.18,1.20,1.10,1.05,0.85,0.80,0.82,0.90,1.00,1.05,0.90] },
  wet_season:    { label: "Wet Season",     months: [1.10,1.05,1.00,0.90,0.75,0.65,0.60,0.65,0.80,1.00,1.10,1.15] },
  harvest:       { label: "Harvest",        months: [0.85,0.82,0.90,0.95,1.00,0.95,0.90,0.95,1.05,1.25,1.35,1.03] },
  school_term:   { label: "School Term",    months: [1.00,1.05,1.10,1.05,1.05,0.70,0.65,0.70,1.20,1.25,1.15,0.80] },
  tourism_high:  { label: "Tourism High",   months: [1.30,1.25,1.15,1.05,0.90,0.80,0.85,0.90,0.95,1.00,1.10,1.35] },
  ramadan:       { label: "Ramadan/Eid",    months: [0.95,0.95,1.50,1.60,1.20,0.90,0.85,0.88,0.90,0.92,0.95,1.40] },
  back_to_school:{ label: "Back-to-School", months: [1.10,1.05,0.95,0.92,0.90,0.80,0.80,1.45,1.35,1.10,0.92,0.72] },
  mid_year_slow: { label: "Mid-Year Slow",  months: [1.10,1.05,1.02,0.95,0.85,0.75,0.72,0.78,0.95,1.10,1.15,1.18] },
  agri_planting: { label: "Agri Planting",  months: [0.80,0.82,1.10,1.30,1.20,0.90,0.75,0.80,0.85,1.00,1.05,0.93] },
  custom:        { label: "Custom",         months: Array(12).fill(1) },
};

const STREAM_TYPE_LABELS: Record<StreamType, string> = {
  product: "Product Sales", service: "Services", subscription: "Subscriptions",
  rental: "Rental", marketplace: "Marketplace", contract: "Contracts", custom: "Custom",
};
const MIX_COLORS = ["#0e7490","#7c3aed","#059669","#b45309","#e11d48","#6366f1",
  "#0891b2","#8b5cf6","#0f766e","#dc2626","#d97706","#2563eb"];

/* ══════════════════════════════════════ projection ══ */
function projectRevenue(streams: RevenueStream[], totalMonths: number, startDate: Date): ProjMonth[] {
  const subTotals: Record<string, number> = {};
  streams.forEach((s) => {
    if (s.type === "subscription")
      subTotals[s.id] = Math.max(1, s.items.reduce((a, it) => a + it.volume, 0));
  });

  return Array.from({ length: totalMonths }, (_, i) => {
    const d = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
    const calMonth = (startDate.getMonth() + i) % 12;

    const getItemParams = (s: RevenueStream, it: StreamItem) => {
      const ovrs = s.overrides ?? [];
      const itemOvr = ovrs.find((o) => o.scope === "item" && (o.targetId === it.id || o.targetName === it.name));
      const normCat = it.category || "General";
      const catOvr  = ovrs.find((o) => o.scope === "category" && (o.targetId || "General") === normCat);
      const ovr = itemOvr ?? catOvr ?? null;
      const resolvedPreset = ovr?.seasonalityPreset ?? it.seasonalityPreset ?? null;
      const resolvedMults  = ovr?.seasonalityMultipliers ?? it.seasonalityMultipliers ?? null;
      const itemSeasonMults: number[] | null = resolvedPreset
        ? (resolvedPreset === "none" ? Array(12).fill(1) as number[]
          : resolvedPreset === "custom" ? (resolvedMults ?? Array(12).fill(1) as number[])
          : SEA[resolvedPreset]?.months ?? null)
        : null;
      return {
        volPct:      ovr?.volumeGrowthPct      ?? s.volumeGrowthPct      ?? 0,
        pricePct:    ovr?.annualPriceGrowthPct ?? s.annualPriceGrowthPct ?? 0,
        seasonMults: itemSeasonMults ?? s.seasonalityMultipliers ?? (Array(12).fill(1) as number[]),
        launchMonth: ovr?.launchMonth ?? null,
        sunsetMonth: ovr?.sunsetMonth ?? null,
      };
    };

    const byStream = streams.map((s) => {
      let rev = 0;
      const expF = (s.expansionMonth !== null && s.expansionMonth !== undefined && i >= s.expansionMonth)
        ? (s.expansionMultiplier ?? 1) : 1;

      if (s.type === "subscription") {
        if (i > 0) {
          const churn = Math.round(subTotals[s.id] * (s.subChurnPct ?? 0) / 100);
          subTotals[s.id] = Math.max(0, subTotals[s.id] + (s.subNewPerMonth ?? 0) - churn);
        }
        const initial = Math.max(1, s.items.reduce((a, it) => a + it.volume, 0));
        const subF = subTotals[s.id] / initial;
        s.items.forEach((it) => {
          const p = getItemParams(s, it);
          if (p.launchMonth !== null && i < p.launchMonth) return;
          if (p.sunsetMonth !== null && i > p.sunsetMonth) return;
          rev += Math.round(it.volume * it.price * subF * Math.pow(1 + p.pricePct / 1200, i) * (p.seasonMults[calMonth] ?? 1) * expF);
        });
      } else if (s.type === "rental") {
        const occ = (s.rentalOccupancyPct ?? 100) / 100;
        s.items.forEach((it) => {
          const p = getItemParams(s, it);
          if (p.launchMonth !== null && i < p.launchMonth) return;
          if (p.sunsetMonth !== null && i > p.sunsetMonth) return;
          rev += Math.round(it.volume * Math.pow(1 + p.volPct / 100, i) * it.price * Math.pow(1 + p.pricePct / 1200, i) * occ * (p.seasonMults[calMonth] ?? 1) * expF);
        });
      } else if (s.type === "marketplace") {
        s.items.forEach((it) => {
          const p = getItemParams(s, it);
          if (p.launchMonth !== null && i < p.launchMonth) return;
          if (p.sunsetMonth !== null && i > p.sunsetMonth) return;
          rev += Math.round(it.volume * Math.pow(1 + p.volPct / 100, i) * (it.price / 100) * Math.pow(1 + p.pricePct / 1200, i) * (p.seasonMults[calMonth] ?? 1) * expF);
        });
      } else {
        s.items.forEach((it) => {
          const p = getItemParams(s, it);
          if (p.launchMonth !== null && i < p.launchMonth) return;
          if (p.sunsetMonth !== null && i > p.sunsetMonth) return;
          rev += Math.round(it.volume * Math.pow(1 + p.volPct / 100, i) * it.price * Math.pow(1 + p.pricePct / 1200, i) * (p.seasonMults[calMonth] ?? 1) * expF);
        });
      }

      return { id: s.id, name: s.name, type: s.type, rev };
    });

    return {
      index: i, year: d.getFullYear(),
      monthLabel: d.toLocaleDateString("en-US", { month: "short" }),
      yearMonth:  d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      total: byStream.reduce((a, b) => a + b.rev, 0),
      byStream,
    };
  });
}

/* ══════════════════════════════════════ helpers ══ */
function streamMRR(s: RevenueStream): number {
  const occ = (s.rentalOccupancyPct ?? 100) / 100;
  return s.items.reduce((a, it) => {
    if (s.type === "marketplace") return a + it.volume * (it.price / 100);
    if (s.type === "rental")      return a + it.volume * it.price * occ;
    return a + it.volume * it.price;
  }, 0);
}

function makeFmt(currency: string | null) {
  const code = currency ?? "USD";
  return (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency", currency: code,
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(n);
}

function fmtPct(n: number, digits = 1) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function dbToStream(s: DbRevenueStream, items: DbStreamItem[]): RevenueStream {
  return {
    id: s.id,
    name: s.name,
    type: s.type as StreamType,
    confidence: s.confidence as Confidence,
    volumeGrowthPct:      s.volume_growth_pct       != null ? Number(s.volume_growth_pct)       : Number(s.monthly_growth_pct),
    annualPriceGrowthPct: s.annual_price_growth_pct != null ? Number(s.annual_price_growth_pct) : 0,
    monthlyGrowthPct:     Number(s.monthly_growth_pct),
    subNewPerMonth:      Number(s.sub_new_per_month),
    subChurnPct:         Number(s.sub_churn_pct),
    rentalOccupancyPct:  Number(s.rental_occupancy_pct),
    seasonalityPreset:      (s.seasonality_preset ?? "none") as SeasonalityPreset,
    seasonalityMultipliers: (s.seasonality_multipliers as number[] | null)
      ?? SEA[(s.seasonality_preset ?? "none") as SeasonalityPreset]?.months
      ?? Array(12).fill(1) as number[],
    expansionMonth:      null,
    expansionMultiplier: 1.5,
    overrides:           (s.item_overrides as GrowthOverride[] | null) ?? [],
    items: items.map((it) => ({
      id:       it.id,
      name:     it.name,
      category: it.category ?? "General",
      volume:   Number(it.volume),
      price:    Number(it.price),
      unit:     it.unit,
      seasonalityPreset:      (it.seasonality_preset as SeasonalityPreset | null) ?? undefined,
      seasonalityMultipliers: (it.seasonality_multipliers as number[] | null) ?? undefined,
    })),
  };
}

/* ══════════════════════════════════════ mini bar chart ══ */
function SeasonBar({ mults }: { mults: number[] }) {
  const max = Math.max(...mults, 1);
  const months = ["J","F","M","A","M","J","J","A","S","O","N","D"];
  return (
    <div className="flex items-end gap-[2px] h-8">
      {mults.map((v, i) => (
        <div key={i} className="flex flex-col items-center gap-px flex-1">
          <div
            className="w-full rounded-sm"
            style={{ height: `${Math.round((v / max) * 24)}px`, background: "#0e7490", opacity: 0.7 + 0.3 * (v / max) }}
          />
          <span className="text-[7px] text-slate-400 leading-none">{months[i]}</span>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════ section header ══ */
function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-baseline gap-3 mb-4">
      <div className="w-1 h-5 rounded-full shrink-0" style={{ background: "linear-gradient(180deg,#0e7490,#0891b2)" }} />
      <div>
        <h2 className="text-[11px] font-bold tracking-[0.12em] uppercase text-slate-500">{title}</h2>
        {subtitle && <p className="text-[10px] text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════ main report ══ */
export default function ReportPage() {
  const params      = useParams();
  const searchParams = useSearchParams();
  const appId       = params.appId as string;

  const horizonYears = parseInt(searchParams.get("horizon") ?? "3", 10);
  const startYearP   = parseInt(searchParams.get("year")    ?? String(new Date().getFullYear()), 10);
  const startMonthP  = parseInt(searchParams.get("month")   ?? String(new Date().getMonth()), 10);

  const [app,     setApp]     = useState<DbApplication | null>(null);
  const [streams, setStreams] = useState<RevenueStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const sb = createClient();

  const load = useCallback(async () => {
    try {
      const state = await loadApplicationState(sb, appId);
      setApp(state.application);
      const restored = state.streams.map((s) =>
        dbToStream(s, state.itemsByStream[s.id] ?? [])
      );
      setStreams(restored);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [appId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center space-y-3">
        <div className="w-10 h-10 border-2 border-cyan-600 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-slate-500">Preparing report…</p>
      </div>
    </div>
  );

  if (error || !app) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center space-y-2">
        <p className="text-slate-700 font-semibold">Could not load report</p>
        <p className="text-sm text-slate-400">{error ?? "Application not found"}</p>
      </div>
    </div>
  );

  /* ── derived data ── */
  const currency   = app.currency ?? "USD";
  const fmt        = makeFmt(currency);
  const startDate  = new Date(startYearP, startMonthP, 1);
  const totalMths  = horizonYears * 12;
  const projection = projectRevenue(streams, totalMths, startDate);

  // Group into years
  const years: { year: number; months: ProjMonth[]; total: number }[] = [];
  for (let y = 0; y < horizonYears; y++) {
    const months = projection.slice(y * 12, y * 12 + 12);
    years.push({ year: y + 1, months, total: months.reduce((a, m) => a + m.total, 0) });
  }

  const baseMRR    = streams.reduce((a, s) => a + streamMRR(s), 0);
  const year1Total = years[0]?.total ?? 0;
  const grandTotal = years.reduce((a, y) => a + y.total, 0);
  const lastMRR    = projection[projection.length - 1]?.total ?? 0;
  const cagr       = years.length > 1 && (years[0]?.total ?? 0) > 0
    ? ((Math.pow(years[years.length - 1].total / years[0].total, 1 / (years.length - 1)) - 1) * 100)
    : null;

  const totalItems  = streams.reduce((a, s) => a + s.items.length, 0);
  const generatedAt = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const year1Months = years[0]?.months ?? [];

  return (
    <>
      {/* ── Print CSS ── */}
      <style>{`
        @page { size: A4; margin: 14mm 18mm 14mm 18mm; }
        @media print {
          .no-print { display: none !important; }
          .page-break { break-before: page; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        body { background: #f8fafc; }
      `}</style>

      {/* ── Floating action bar (screen only) ── */}
      <div className="no-print fixed top-0 inset-x-0 z-50 bg-white/80 backdrop-blur border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          </div>
          <span className="text-sm font-semibold text-slate-800">{app.name ?? "Revenue Forecast"}</span>
          <span className="hidden sm:block text-xs text-slate-400">· Mentorvix Report</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => window.close()} className="no-print hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 rounded-lg hover:bg-slate-100 transition-colors">
            ✕ Close
          </button>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold text-white rounded-lg shadow transition-opacity hover:opacity-90"
            style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6,9 6,2 18,2 18,9"/><path d="M6,18H4a2,2,0,0,1-2-2V11a2,2,0,0,1,2-2H20a2,2,0,0,1,2,2v5a2,2,0,0,1-2,2H18"/><rect x="6" y="14" width="12" height="8"/></svg>
            Print / Save PDF
          </button>
        </div>
      </div>

      {/* ── Report body ── */}
      <div className="pt-14 pb-16 no-print-pt">
        <div className="max-w-[820px] mx-auto px-4 sm:px-6 space-y-8 print:space-y-6 print:px-0 print:pt-0">

          {/* ════════════════════════════ COVER ════ */}
          <div
            className="rounded-2xl print:rounded-none overflow-hidden shadow-lg print:shadow-none"
            style={{ background: "linear-gradient(135deg,#0c4a6e 0%,#0e7490 50%,#0891b2 100%)" }}
          >
            <div className="px-8 pt-8 pb-6 sm:px-10 sm:pt-10 sm:pb-8">
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>
                  </div>
                  <span className="text-white/80 text-sm font-bold tracking-wide">MENTORVIX</span>
                </div>
                <span className="text-white/50 text-xs font-medium tracking-wider uppercase">Confidential</span>
              </div>

              <h1 className="text-white text-2xl sm:text-3xl font-bold leading-tight mb-1">
                Revenue Forecast Report
              </h1>
              <p className="text-white/70 text-sm sm:text-base mt-1">{app.name ?? "Business Revenue Model"}</p>

              <div className="mt-6 pt-5 border-t border-white/20 grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-white/50 text-[10px] uppercase tracking-wider mb-0.5">Prepared</p>
                  <p className="text-white text-xs font-semibold">{generatedAt}</p>
                </div>
                <div>
                  <p className="text-white/50 text-[10px] uppercase tracking-wider mb-0.5">Horizon</p>
                  <p className="text-white text-xs font-semibold">{horizonYears} {horizonYears === 1 ? "Year" : "Years"}</p>
                </div>
                <div>
                  <p className="text-white/50 text-[10px] uppercase tracking-wider mb-0.5">Start Period</p>
                  <p className="text-white text-xs font-semibold">
                    {startDate.toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                  </p>
                </div>
                <div>
                  <p className="text-white/50 text-[10px] uppercase tracking-wider mb-0.5">Revenue Streams</p>
                  <p className="text-white text-xs font-semibold">{streams.length} streams · {totalItems} items</p>
                </div>
              </div>
            </div>
          </div>

          {/* ════════════════════════════ KPI SUMMARY ════ */}
          <div>
            <SectionHeader title="Executive Summary" subtitle="Key performance indicators for the projection period" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Baseline MRR",    value: fmt(baseMRR),    sub: "Current monthly run rate",  color: "#0e7490" },
                { label: "Year 1 Revenue",  value: fmt(year1Total), sub: "12-month projected total",   color: "#7c3aed" },
                { label: `${horizonYears}-Year Total`, value: fmt(grandTotal), sub: "Cumulative projection",  color: "#059669" },
                { label: cagr !== null ? `CAGR ${fmtPct(cagr, 1)}` : "Run Rate MRR",
                  value: fmt(lastMRR),
                  sub:   cagr !== null ? "Year-on-year growth" : `Month ${totalMths} revenue`,
                  color: "#b45309" },
              ].map((kpi, i) => (
                <div key={i} className="bg-white rounded-2xl print:rounded-xl border border-slate-100 p-4 shadow-sm">
                  <div className="w-7 h-1 rounded-full mb-3" style={{ background: kpi.color }} />
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">{kpi.label}</p>
                  <p className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums leading-none">{kpi.value}</p>
                  <p className="text-[10px] text-slate-400 mt-1.5">{kpi.sub}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ════════════════════════════ REVENUE STREAMS ════ */}
          <div>
            <SectionHeader title="Revenue Streams" subtitle="Baseline configuration and growth assumptions" />
            <div className="bg-white rounded-2xl print:rounded-xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background: "linear-gradient(90deg,#f0f9ff,#f8fafc)" }}>
                      <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Stream</th>
                      <th className="text-left px-3 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Type</th>
                      <th className="text-right px-3 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Baseline MRR</th>
                      <th className="text-right px-3 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Vol Growth</th>
                      <th className="text-right px-3 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Price Growth</th>
                      <th className="text-left px-3 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider hidden sm:table-cell">Seasonality</th>
                      <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider hidden sm:table-cell">Pattern</th>
                    </tr>
                  </thead>
                  <tbody>
                    {streams.map((s, i) => {
                      const mrr = streamMRR(s);
                      const totalMRR = streams.reduce((a, x) => a + streamMRR(x), 0);
                      const pct = totalMRR > 0 ? (mrr / totalMRR) * 100 : 0;
                      return (
                        <tr key={s.id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/60"}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: MIX_COLORS[i % MIX_COLORS.length] }} />
                              <div>
                                <p className="font-semibold text-slate-800">{s.name}</p>
                                <p className="text-[10px] text-slate-400">{s.items.length} item{s.items.length !== 1 ? "s" : ""} · {pct.toFixed(0)}% of MRR</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-50 text-cyan-700 border border-cyan-100">
                              {STREAM_TYPE_LABELS[s.type]}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <p className="font-bold text-slate-800 tabular-nums">{fmt(mrr)}</p>
                            <p className="text-[10px] text-slate-400">per month</p>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span className={`font-semibold tabular-nums ${s.volumeGrowthPct > 0 ? "text-emerald-600" : "text-slate-400"}`}>
                              {s.volumeGrowthPct > 0 ? "+" : ""}{s.volumeGrowthPct}%/mo
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span className={`font-semibold tabular-nums ${s.annualPriceGrowthPct > 0 ? "text-blue-600" : "text-slate-400"}`}>
                              {s.annualPriceGrowthPct > 0 ? "+" : ""}{s.annualPriceGrowthPct}%/yr
                            </span>
                          </td>
                          <td className="px-3 py-3 hidden sm:table-cell">
                            <span className="text-slate-600 text-[11px]">{SEA[s.seasonalityPreset]?.label ?? "Flat"}</span>
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            <SeasonBar mults={s.seasonalityMultipliers} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200" style={{ background: "linear-gradient(90deg,#f0f9ff,#f8fafc)" }}>
                      <td colSpan={2} className="px-4 py-3 font-bold text-slate-700 text-[11px]">TOTAL</td>
                      <td className="px-3 py-3 text-right font-bold text-slate-900 tabular-nums">{fmt(baseMRR)}</td>
                      <td colSpan={4} className="px-3 py-3 text-[10px] text-slate-400">Baseline monthly revenue</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>

          {/* ════════════════════════════ ANNUAL FORECAST ════ */}
          <div className="page-break">
            <SectionHeader title="Annual Forecast" subtitle={`${horizonYears}-year revenue projection by stream`} />
            <div className="bg-white rounded-2xl print:rounded-xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background: "linear-gradient(90deg,#f0f9ff,#f8fafc)" }}>
                      <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Revenue Stream</th>
                      {years.map((y) => (
                        <th key={y.year} className="text-right px-3 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                          Year {y.year}
                        </th>
                      ))}
                      <th className="text-right px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">{horizonYears}-Yr Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {streams.map((s, si) => {
                      const streamYearTotals = years.map((y) =>
                        y.months.reduce((a, m) => a + (m.byStream.find((b) => b.id === s.id)?.rev ?? 0), 0)
                      );
                      const streamTotal = streamYearTotals.reduce((a, v) => a + v, 0);
                      return (
                        <tr key={s.id} className={si % 2 === 0 ? "bg-white" : "bg-slate-50/60"}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: MIX_COLORS[si % MIX_COLORS.length] }} />
                              <span className="font-semibold text-slate-700">{s.name}</span>
                            </div>
                          </td>
                          {streamYearTotals.map((v, yi) => (
                            <td key={yi} className="px-3 py-3 text-right tabular-nums text-slate-700">{fmt(v)}</td>
                          ))}
                          <td className="px-4 py-3 text-right font-bold text-slate-800 tabular-nums">{fmt(streamTotal)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200" style={{ background: "linear-gradient(90deg,#f0f9ff,#f8fafc)" }}>
                      <td className="px-4 py-3 font-bold text-slate-800 text-[11px]">TOTAL REVENUE</td>
                      {years.map((y, yi) => {
                        const prev = yi > 0 ? years[yi - 1].total : null;
                        const growth = prev && prev > 0 ? ((y.total - prev) / prev) * 100 : null;
                        return (
                          <td key={y.year} className="px-3 py-3 text-right">
                            <p className="font-bold text-slate-900 tabular-nums">{fmt(y.total)}</p>
                            {growth !== null && (
                              <p className={`text-[10px] font-semibold tabular-nums ${growth >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                                {fmtPct(growth)} YoY
                              </p>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-right font-bold text-slate-900 tabular-nums">{fmt(grandTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>

          {/* ════════════════════════════ MONTHLY YEAR 1 ════ */}
          {year1Months.length > 0 && (
            <div className="page-break">
              <SectionHeader title="Monthly Breakdown — Year 1" subtitle="Month-by-month revenue by stream" />
              <div className="bg-white rounded-2xl print:rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: "linear-gradient(90deg,#f0f9ff,#f8fafc)" }}>
                        <th className="text-left px-4 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider sticky left-0 bg-inherit whitespace-nowrap">Month</th>
                        {streams.map((s, si) => (
                          <th key={s.id} className="text-right px-3 py-2.5 text-[10px] font-bold whitespace-nowrap" style={{ color: MIX_COLORS[si % MIX_COLORS.length] }}>
                            {s.name.length > 14 ? s.name.slice(0, 13) + "…" : s.name}
                          </th>
                        ))}
                        <th className="text-right px-4 py-2.5 text-[10px] font-bold text-slate-700 uppercase tracking-wider whitespace-nowrap">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {year1Months.map((m, mi) => {
                        const prev = mi > 0 ? year1Months[mi - 1].total : null;
                        const mom = prev && prev > 0 ? ((m.total - prev) / prev) * 100 : null;
                        return (
                          <tr key={m.index} className={mi % 2 === 0 ? "bg-white" : "bg-slate-50/60"}>
                            <td className="px-4 py-2 font-semibold text-slate-700 whitespace-nowrap">{m.yearMonth}</td>
                            {streams.map((s) => (
                              <td key={s.id} className="px-3 py-2 text-right tabular-nums text-slate-600">
                                {fmt(m.byStream.find((b) => b.id === s.id)?.rev ?? 0)}
                              </td>
                            ))}
                            <td className="px-4 py-2 text-right">
                              <p className="font-bold text-slate-800 tabular-nums">{fmt(m.total)}</p>
                              {mom !== null && (
                                <p className={`text-[9px] font-semibold ${mom >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                                  {fmtPct(mom, 1)} MoM
                                </p>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-200" style={{ background: "linear-gradient(90deg,#f0f9ff,#f8fafc)" }}>
                        <td className="px-4 py-2.5 font-bold text-slate-800 text-[11px]">YEAR 1 TOTAL</td>
                        {streams.map((s) => {
                          const total = year1Months.reduce((a, m) => a + (m.byStream.find((b) => b.id === s.id)?.rev ?? 0), 0);
                          return <td key={s.id} className="px-3 py-2.5 text-right font-semibold text-slate-700 tabular-nums">{fmt(total)}</td>;
                        })}
                        <td className="px-4 py-2.5 text-right font-bold text-slate-900 tabular-nums">{fmt(years[0]?.total ?? 0)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ════════════════════════════ STREAM DETAIL CARDS ════ */}
          <div className="page-break">
            <SectionHeader title="Stream Detail" subtitle="Line items, growth drivers, and seasonality per stream" />
            <div className="space-y-4">
              {streams.map((s, si) => {
                const mrr = streamMRR(s);
                return (
                  <div key={s.id} className="bg-white rounded-2xl print:rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                    {/* Stream header */}
                    <div className="px-5 py-4 flex items-start justify-between gap-4 border-b border-slate-100"
                      style={{ background: `linear-gradient(90deg,${MIX_COLORS[si % MIX_COLORS.length]}0d,transparent)` }}>
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ background: MIX_COLORS[si % MIX_COLORS.length] }} />
                        <div>
                          <h3 className="font-bold text-slate-900">{s.name}</h3>
                          <p className="text-[10px] text-slate-400">{STREAM_TYPE_LABELS[s.type]} · {s.items.length} item{s.items.length !== 1 ? "s" : ""}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg font-bold text-slate-900 tabular-nums">{fmt(mrr)}<span className="text-[11px] font-normal text-slate-400">/mo</span></p>
                        <div className="flex items-center gap-2 justify-end mt-0.5">
                          <span className="text-[10px] text-emerald-600 font-semibold">{s.volumeGrowthPct > 0 ? "+" : ""}{s.volumeGrowthPct}%/mo vol</span>
                          <span className="text-[10px] text-blue-600 font-semibold">{s.annualPriceGrowthPct > 0 ? "+" : ""}{s.annualPriceGrowthPct}%/yr price</span>
                        </div>
                      </div>
                    </div>

                    {/* Items table */}
                    {s.items.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-100 bg-slate-50/60">
                              <th className="text-left px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Item</th>
                              <th className="text-left px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider hidden sm:table-cell">Category</th>
                              <th className="text-right px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Volume</th>
                              <th className="text-right px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Unit Price</th>
                              <th className="text-right px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Monthly Rev</th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.items.map((it, ii) => {
                              const rev = s.type === "marketplace"
                                ? it.volume * (it.price / 100)
                                : it.volume * it.price;
                              return (
                                <tr key={it.id} className={ii % 2 === 0 ? "bg-white" : "bg-slate-50/40"}>
                                  <td className="px-4 py-2 font-medium text-slate-700">{it.name}</td>
                                  <td className="px-3 py-2 text-slate-400 hidden sm:table-cell">{it.category || "General"}</td>
                                  <td className="px-3 py-2 text-right text-slate-600 tabular-nums">{it.volume.toLocaleString()}</td>
                                  <td className="px-3 py-2 text-right text-slate-600 tabular-nums">{fmt(it.price)}</td>
                                  <td className="px-4 py-2 text-right font-semibold text-slate-800 tabular-nums">{fmt(rev)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="border-t border-slate-200 bg-slate-50">
                              <td colSpan={4} className="px-4 py-2 text-[10px] font-bold text-slate-500 uppercase">Stream Total</td>
                              <td className="px-4 py-2 text-right font-bold text-slate-900 tabular-nums">{fmt(mrr)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}

                    {/* Seasonality bar */}
                    {s.seasonalityPreset !== "none" && (
                      <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-4">
                        <div>
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Seasonality Pattern</p>
                          <p className="text-[10px] text-slate-600">{SEA[s.seasonalityPreset]?.label}</p>
                        </div>
                        <div className="flex-1 max-w-[200px]">
                          <SeasonBar mults={s.seasonalityMultipliers} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ════════════════════════════ FOOTER ════ */}
          <div className="border-t border-slate-200 pt-6 pb-2 flex items-center justify-between text-[10px] text-slate-400">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded flex items-center justify-center" style={{ background: "#0e7490" }}>
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>
              </div>
              <span className="font-semibold text-slate-500">Mentorvix</span>
              <span>· AI-Powered Finance Intelligence</span>
            </div>
            <div className="text-right">
              <p>Generated {generatedAt}</p>
              <p className="mt-0.5">This report is confidential and intended for authorised recipients only.</p>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
