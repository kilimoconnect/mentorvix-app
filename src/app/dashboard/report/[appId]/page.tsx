"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { loadApplicationState } from "@/lib/supabase/revenue";
import type { DbRevenueStream, DbStreamItem, DbApplication, StreamType, Confidence } from "@/lib/supabase/revenue";

/* ─── types ─── */
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
  byStream: { id: string; rev: number }[];
}

/* ─── constants ─── */
const BRAND   = "#0e7490";
const BRAND2  = "#0891b2";
const DARK    = "#0c4a6e";

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

const TYPE_LABEL: Record<StreamType, string> = {
  product:"Product Sales", service:"Services", subscription:"Subscriptions",
  rental:"Rental", marketplace:"Marketplace", contract:"Contracts", custom:"Custom",
};

const COLORS = ["#0e7490","#7c3aed","#059669","#b45309","#e11d48","#6366f1",
                 "#0891b2","#8b5cf6","#0f766e","#dc2626","#d97706","#2563eb"];

const MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* ─── math ─── */
function projectRevenue(streams: RevenueStream[], totalMonths: number, startDate: Date): ProjMonth[] {
  const subTotals: Record<string, number> = {};
  streams.forEach((s) => {
    if (s.type === "subscription")
      subTotals[s.id] = Math.max(1, s.items.reduce((a, it) => a + it.volume, 0));
  });
  return Array.from({ length: totalMonths }, (_, i) => {
    const d = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
    const cal = (startDate.getMonth() + i) % 12;
    const getP = (s: RevenueStream, it: StreamItem) => {
      const ovrs = s.overrides ?? [];
      const iOvr = ovrs.find((o) => o.scope === "item" && (o.targetId === it.id || o.targetName === it.name));
      const cOvr = ovrs.find((o) => o.scope === "category" && (o.targetId || "General") === (it.category || "General"));
      const ovr = iOvr ?? cOvr ?? null;
      const rp = ovr?.seasonalityPreset ?? it.seasonalityPreset ?? null;
      const rm = ovr?.seasonalityMultipliers ?? it.seasonalityMultipliers ?? null;
      const sm: number[] = rp
        ? (rp === "none" ? Array(12).fill(1) : rp === "custom" ? (rm ?? Array(12).fill(1)) : SEA[rp]?.months ?? Array(12).fill(1))
        : s.seasonalityMultipliers ?? Array(12).fill(1);
      return { vp: ovr?.volumeGrowthPct ?? s.volumeGrowthPct ?? 0, pp: ovr?.annualPriceGrowthPct ?? s.annualPriceGrowthPct ?? 0, sm, lm: ovr?.launchMonth ?? null, em: ovr?.sunsetMonth ?? null };
    };
    const byStream = streams.map((s) => {
      let rev = 0;
      const xf = s.expansionMonth !== null && s.expansionMonth !== undefined && i >= s.expansionMonth ? (s.expansionMultiplier ?? 1) : 1;
      if (s.type === "subscription") {
        if (i > 0) { const ch = Math.round(subTotals[s.id] * (s.subChurnPct ?? 0) / 100); subTotals[s.id] = Math.max(0, subTotals[s.id] + (s.subNewPerMonth ?? 0) - ch); }
        const init = Math.max(1, s.items.reduce((a, it) => a + it.volume, 0));
        const sf = subTotals[s.id] / init;
        s.items.forEach((it) => { const p = getP(s, it); if ((p.lm !== null && i < p.lm) || (p.em !== null && i > p.em)) return; rev += Math.round(it.volume * it.price * sf * Math.pow(1 + p.pp / 1200, i) * (p.sm[cal] ?? 1) * xf); });
      } else if (s.type === "rental") {
        const occ = (s.rentalOccupancyPct ?? 100) / 100;
        s.items.forEach((it) => { const p = getP(s, it); if ((p.lm !== null && i < p.lm) || (p.em !== null && i > p.em)) return; rev += Math.round(it.volume * Math.pow(1 + p.vp / 100, i) * it.price * Math.pow(1 + p.pp / 1200, i) * occ * (p.sm[cal] ?? 1) * xf); });
      } else if (s.type === "marketplace") {
        s.items.forEach((it) => { const p = getP(s, it); if ((p.lm !== null && i < p.lm) || (p.em !== null && i > p.em)) return; rev += Math.round(it.volume * Math.pow(1 + p.vp / 100, i) * (it.price / 100) * Math.pow(1 + p.pp / 1200, i) * (p.sm[cal] ?? 1) * xf); });
      } else {
        s.items.forEach((it) => { const p = getP(s, it); if ((p.lm !== null && i < p.lm) || (p.em !== null && i > p.em)) return; rev += Math.round(it.volume * Math.pow(1 + p.vp / 100, i) * it.price * Math.pow(1 + p.pp / 1200, i) * (p.sm[cal] ?? 1) * xf); });
      }
      return { id: s.id, rev };
    });
    return { index: i, year: d.getFullYear(), monthLabel: MO[d.getMonth()], yearMonth: `${MO[d.getMonth()]} ${d.getFullYear()}`, total: byStream.reduce((a, b) => a + b.rev, 0), byStream };
  });
}

function streamMRR(s: RevenueStream) {
  const occ = (s.rentalOccupancyPct ?? 100) / 100;
  return s.items.reduce((a, it) => {
    if (s.type === "marketplace") return a + it.volume * (it.price / 100);
    if (s.type === "rental")      return a + it.volume * it.price * occ;
    return a + it.volume * it.price;
  }, 0);
}

function makeFmt(currency: string | null) {
  const code = currency ?? "USD";
  return (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: code, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

function dbToStream(s: DbRevenueStream, items: DbStreamItem[]): RevenueStream {
  return {
    id: s.id, name: s.name, type: s.type as StreamType, confidence: s.confidence as Confidence,
    volumeGrowthPct:      s.volume_growth_pct != null ? Number(s.volume_growth_pct) : Number(s.monthly_growth_pct),
    annualPriceGrowthPct: s.annual_price_growth_pct != null ? Number(s.annual_price_growth_pct) : 0,
    monthlyGrowthPct:     Number(s.monthly_growth_pct),
    subNewPerMonth: Number(s.sub_new_per_month), subChurnPct: Number(s.sub_churn_pct),
    rentalOccupancyPct: Number(s.rental_occupancy_pct),
    seasonalityPreset: (s.seasonality_preset ?? "none") as SeasonalityPreset,
    seasonalityMultipliers: (s.seasonality_multipliers as number[] | null) ?? SEA[(s.seasonality_preset ?? "none") as SeasonalityPreset]?.months ?? Array(12).fill(1),
    expansionMonth: null, expansionMultiplier: 1.5,
    overrides: (s.item_overrides as GrowthOverride[] | null) ?? [],
    items: items.map((it) => ({
      id: it.id, name: it.name, category: it.category ?? "General",
      volume: Number(it.volume), price: Number(it.price), unit: it.unit,
      seasonalityPreset: (it.seasonality_preset as SeasonalityPreset | null) ?? undefined,
      seasonalityMultipliers: (it.seasonality_multipliers as number[] | null) ?? undefined,
    })),
  };
}

/* ─── mini bar chart (SVG, prints perfectly) ─── */
function MiniBar({ mults, color }: { mults: number[]; color: string }) {
  const max = Math.max(...mults, 1);
  const W = 120, H = 28, gap = 1;
  const bw = (W - gap * 11) / 12;
  return (
    <svg width={W} height={H + 10} style={{ display: "block" }}>
      {mults.map((v, i) => {
        const bh = Math.max(2, (v / max) * H);
        const x  = i * (bw + gap);
        return (
          <g key={i}>
            <rect x={x} y={H - bh} width={bw} height={bh} fill={color} opacity={0.55 + 0.45 * (v / max)} rx={1} />
            <text x={x + bw / 2} y={H + 9} textAnchor="middle" fontSize={5.5} fill="#94a3b8">{MO[i][0]}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ─── styles (all inline-style-based, print-safe) ─── */
const S = {
  page:     { fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif", background: "#f8fafc", minHeight: "100vh", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" } as React.CSSProperties,
  wrap:     { maxWidth: 820, margin: "0 auto", padding: "0 24px 48px" } as React.CSSProperties,
  // tables
  tbl:      { width: "100%", borderCollapse: "collapse" as const, fontSize: 11 },
  th:       { padding: "8px 12px", textAlign: "left" as const, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "#64748b", background: "#f0f9ff", borderBottom: "1px solid #e2e8f0" },
  thr:      { padding: "8px 12px", textAlign: "right" as const, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "#64748b", background: "#f0f9ff", borderBottom: "1px solid #e2e8f0" },
  td:       { padding: "7px 12px", borderBottom: "1px solid #f1f5f9", color: "#334155", verticalAlign: "middle" as const },
  tdr:      { padding: "7px 12px", borderBottom: "1px solid #f1f5f9", color: "#334155", textAlign: "right" as const, fontVariantNumeric: "tabular-nums", verticalAlign: "middle" as const },
  tfoot:    { padding: "8px 12px", background: "#f0f9ff", fontWeight: 700, color: "#0f172a", borderTop: "2px solid #cbd5e1" },
  tfootr:   { padding: "8px 12px", background: "#f0f9ff", fontWeight: 700, color: "#0f172a", textAlign: "right" as const, fontVariantNumeric: "tabular-nums", borderTop: "2px solid #cbd5e1" },
  // section
  section:  { background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", marginBottom: 20 } as React.CSSProperties,
  secHead:  { padding: "10px 20px 8px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 8 } as React.CSSProperties,
  secTitle: { fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "#64748b" },
  secSub:   { fontSize: 9, color: "#94a3b8", marginTop: 1 },
};

/* ─── main page ─── */
export default function ReportPage() {
  const params       = useParams();
  const searchParams = useSearchParams();
  const appId        = params.appId as string;
  const horizonYears = Math.max(1, parseInt(searchParams.get("horizon") ?? "3", 10));
  const startYearP   = parseInt(searchParams.get("year")  ?? String(new Date().getFullYear()), 10);
  const startMonthP  = parseInt(searchParams.get("month") ?? String(new Date().getMonth()), 10);

  const [app,     setApp]     = useState<DbApplication | null>(null);
  const [streams, setStreams] = useState<RevenueStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const sb = createClient();

  const load = useCallback(async () => {
    try {
      const state = await loadApplicationState(sb, appId);
      setApp(state.application);
      setStreams(state.streams.map((s) => dbToStream(s, state.itemsByStream[s.id] ?? [])));
    } catch (e) { setError(String(e)); }
    finally     { setLoading(false); }
  }, [appId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  /* ── loading / error ── */
  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 36, height: 36, border: `3px solid ${BRAND}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <p style={{ color: "#64748b", fontSize: 13 }}>Preparing report…</p>
      </div>
    </div>
  );
  if (error || !app) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#ef4444" }}>{error ?? "Application not found"}</p>
    </div>
  );

  /* ── derived ── */
  const fmt       = makeFmt(app.currency ?? "USD");
  const startDate = new Date(startYearP, startMonthP, 1);
  const totalMths = horizonYears * 12;
  const proj      = projectRevenue(streams, totalMths, startDate);

  const years = Array.from({ length: horizonYears }, (_, y) => {
    const months = proj.slice(y * 12, y * 12 + 12);
    return { idx: y + 1, months, total: months.reduce((a, m) => a + m.total, 0) };
  });

  const baseMRR    = streams.reduce((a, s) => a + streamMRR(s), 0);
  const year1Total = years[0]?.total ?? 0;
  const grandTotal = years.reduce((a, y) => a + y.total, 0);
  const lastMRR    = proj[proj.length - 1]?.total ?? 0;
  const cagr       = years.length > 1 && (years[0]?.total ?? 0) > 0
    ? (Math.pow(years[years.length - 1].total / years[0].total, 1 / (years.length - 1)) - 1) * 100
    : null;
  const totalItems = streams.reduce((a, s) => a + s.items.length, 0);
  const genDate    = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const y1months   = years[0]?.months ?? [];

  const pct = (n: number, d = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;
  const streamYrTotal = (sid: string, yr: typeof years[0]) =>
    yr.months.reduce((a, m) => a + (m.byStream.find((b) => b.id === sid)?.rev ?? 0), 0);

  return (
    <div style={S.page}>

      {/* ════ Global print CSS ════ */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @page { size: A4; margin: 16mm 18mm; }
        @media print {
          .no-print { display: none !important; }
          .page-break { break-before: page; }
          body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      {/* ════ Screen-only toolbar ════ */}
      <div className="no-print" style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(255,255,255,0.95)", backdropFilter: "blur(8px)", borderBottom: "1px solid #e2e8f0", padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, background: `linear-gradient(135deg,${DARK},${BRAND2})`, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>
          </div>
          <span style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>Mentorvix</span>
          <span style={{ color: "#94a3b8", fontSize: 12 }}>· Revenue Forecast Report</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => window.close()} style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, color: "#64748b", background: "#f1f5f9", border: "none", borderRadius: 8, cursor: "pointer" }}>Close</button>
          <button
            onClick={() => window.print()}
            style={{ padding: "6px 18px", fontSize: 12, fontWeight: 700, color: "#fff", background: `linear-gradient(135deg,${DARK},${BRAND2})`, border: "none", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6,9 6,2 18,2 18,9"/><path d="M6,18H4a2,2,0,0,1-2-2V11a2,2,0,0,1,2-2H20a2,2,0,0,1,2,2v5a2,2,0,0,1-2,2H18"/><rect x="6" y="14" width="12" height="8"/></svg>
            Print / Save PDF
          </button>
        </div>
      </div>

      {/* ════ Report body ════ */}
      <div style={S.wrap}>

        {/* ── COVER ── */}
        <div style={{ background: `linear-gradient(135deg,${DARK} 0%,${BRAND} 55%,${BRAND2} 100%)`, borderRadius: 14, overflow: "hidden", marginTop: 24, marginBottom: 24, WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" } as React.CSSProperties}>
          <div style={{ padding: "36px 40px 28px" }}>
            {/* Logo row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 36, height: 36, background: "rgba(255,255,255,0.18)", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>
                </div>
                <span style={{ color: "rgba(255,255,255,0.9)", fontSize: 15, fontWeight: 800, letterSpacing: "0.06em" }}>MENTORVIX</span>
              </div>
              <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" }}>Confidential</span>
            </div>

            {/* Title */}
            <div style={{ marginBottom: 28 }}>
              <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>Revenue Forecast Report</p>
              <h1 style={{ color: "#ffffff", fontSize: 28, fontWeight: 800, lineHeight: 1.2, marginBottom: 4 }}>{app.name ?? "Revenue Model"}</h1>
            </div>

            {/* Meta grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 0, borderTop: "1px solid rgba(255,255,255,0.2)", paddingTop: 20 }}>
              {[
                { label: "Prepared",         value: genDate },
                { label: "Projection Start", value: startDate.toLocaleDateString("en-US", { month: "long", year: "numeric" }) },
                { label: "Horizon",          value: `${horizonYears} ${horizonYears === 1 ? "Year" : "Years"}` },
                { label: "Revenue Streams",  value: `${streams.length} streams · ${totalItems} items` },
              ].map((m, i) => (
                <div key={i} style={{ paddingRight: 16 }}>
                  <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>{m.label}</p>
                  <p style={{ color: "#ffffff", fontSize: 11, fontWeight: 600 }}>{m.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── KPI CARDS ── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{ width: 3, height: 18, background: `linear-gradient(${BRAND},${BRAND2})`, borderRadius: 2 }} />
            <div>
              <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "#64748b" }}>Executive Summary</p>
              <p style={{ fontSize: 9, color: "#94a3b8", marginTop: 1 }}>Key metrics for the {horizonYears}-year projection period</p>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
            {[
              { label: "Baseline MRR",       value: fmt(baseMRR),    note: "Current run rate",          accent: BRAND   },
              { label: "Year 1 Revenue",      value: fmt(year1Total), note: "12-month total",            accent: "#7c3aed" },
              { label: `${horizonYears}-Year Total`, value: fmt(grandTotal), note: "Cumulative projection", accent: "#059669" },
              { label: cagr !== null ? `CAGR ${pct(cagr)}` : "End Run Rate",
                value: fmt(lastMRR), note: cagr !== null ? "Year-on-year growth" : `Month ${totalMths}`,  accent: "#b45309" },
            ].map((k, i) => (
              <div key={i} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "16px 16px 14px", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" } as React.CSSProperties}>
                <div style={{ width: 28, height: 3, background: k.accent, borderRadius: 2, marginBottom: 10 }} />
                <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "#94a3b8", marginBottom: 4 }}>{k.label}</p>
                <p style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{k.value}</p>
                <p style={{ fontSize: 9, color: "#94a3b8", marginTop: 6 }}>{k.note}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── REVENUE STREAMS TABLE ── */}
        <div style={S.section}>
          <div style={S.secHead}>
            <div style={{ width: 3, height: 16, background: `linear-gradient(${BRAND},${BRAND2})`, borderRadius: 2 }} />
            <div>
              <p style={S.secTitle}>Revenue Streams</p>
              <p style={S.secSub}>Baseline MRR and growth assumptions per stream</p>
            </div>
          </div>
          <table style={S.tbl}>
            <thead>
              <tr>
                <th style={S.th}>Stream</th>
                <th style={S.th}>Type</th>
                <th style={S.thr}>Baseline MRR</th>
                <th style={S.thr}>% of Total</th>
                <th style={S.thr}>Vol Growth</th>
                <th style={S.thr}>Price Growth</th>
                <th style={S.th}>Seasonality</th>
                <th style={{ ...S.th, textAlign: "center" }}>Pattern</th>
              </tr>
            </thead>
            <tbody>
              {streams.map((s, si) => {
                const mrr = streamMRR(s);
                const share = baseMRR > 0 ? (mrr / baseMRR) * 100 : 0;
                const color = COLORS[si % COLORS.length];
                return (
                  <tr key={s.id} style={{ background: si % 2 === 0 ? "#fff" : "#f8fafc" }}>
                    <td style={S.td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
                        <div>
                          <p style={{ fontWeight: 600, color: "#0f172a", fontSize: 12 }}>{s.name}</p>
                          <p style={{ fontSize: 9, color: "#94a3b8" }}>{s.items.length} item{s.items.length !== 1 ? "s" : ""}</p>
                        </div>
                      </div>
                    </td>
                    <td style={S.td}>
                      <span style={{ display: "inline-block", padding: "2px 7px", borderRadius: 20, fontSize: 9, fontWeight: 700, background: `${color}18`, color, border: `1px solid ${color}30` }}>{TYPE_LABEL[s.type]}</span>
                    </td>
                    <td style={{ ...S.tdr, fontWeight: 700, color: "#0f172a" }}>{fmt(mrr)}</td>
                    <td style={S.tdr}>{share.toFixed(1)}%</td>
                    <td style={{ ...S.tdr, color: s.volumeGrowthPct > 0 ? "#059669" : "#94a3b8", fontWeight: 600 }}>
                      {s.volumeGrowthPct > 0 ? "+" : ""}{s.volumeGrowthPct}%/mo
                    </td>
                    <td style={{ ...S.tdr, color: s.annualPriceGrowthPct > 0 ? "#2563eb" : "#94a3b8", fontWeight: 600 }}>
                      {s.annualPriceGrowthPct > 0 ? "+" : ""}{s.annualPriceGrowthPct}%/yr
                    </td>
                    <td style={{ ...S.td, fontSize: 10 }}>{SEA[s.seasonalityPreset]?.label ?? "Flat"}</td>
                    <td style={{ ...S.td, textAlign: "center" }}>
                      <MiniBar mults={s.seasonalityMultipliers} color={color} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} style={S.tfoot}>TOTAL</td>
                <td style={S.tfootr}>{fmt(baseMRR)}</td>
                <td style={S.tfootr}>100%</td>
                <td colSpan={4} style={{ ...S.tfoot, color: "#64748b", fontSize: 9 }}>Baseline monthly revenue across all streams</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ── ANNUAL FORECAST ── */}
        <div style={{ ...S.section, breakBefore: "page" } as React.CSSProperties}>
          <div style={S.secHead}>
            <div style={{ width: 3, height: 16, background: `linear-gradient(${BRAND},${BRAND2})`, borderRadius: 2 }} />
            <div>
              <p style={S.secTitle}>Annual Forecast</p>
              <p style={S.secSub}>{horizonYears}-year revenue projection by stream</p>
            </div>
          </div>
          <table style={S.tbl}>
            <thead>
              <tr>
                <th style={S.th}>Stream</th>
                {years.map((y) => <th key={y.idx} style={S.thr}>Year {y.idx}</th>)}
                <th style={S.thr}>{horizonYears}-Yr Total</th>
              </tr>
            </thead>
            <tbody>
              {streams.map((s, si) => {
                const ytotals = years.map((y) => streamYrTotal(s.id, y));
                const stotal  = ytotals.reduce((a, v) => a + v, 0);
                return (
                  <tr key={s.id} style={{ background: si % 2 === 0 ? "#fff" : "#f8fafc" }}>
                    <td style={S.td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS[si % COLORS.length], flexShrink: 0 }} />
                        <span style={{ fontWeight: 600, fontSize: 12 }}>{s.name}</span>
                      </div>
                    </td>
                    {ytotals.map((v, yi) => <td key={yi} style={S.tdr}>{fmt(v)}</td>)}
                    <td style={{ ...S.tdr, fontWeight: 700, color: "#0f172a" }}>{fmt(stotal)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td style={S.tfoot}>TOTAL REVENUE</td>
                {years.map((y, yi) => {
                  const prev   = yi > 0 ? years[yi - 1].total : null;
                  const growth = prev && prev > 0 ? ((y.total - prev) / prev) * 100 : null;
                  return (
                    <td key={y.idx} style={S.tfootr}>
                      <p>{fmt(y.total)}</p>
                      {growth !== null && (
                        <p style={{ fontSize: 9, fontWeight: 600, color: growth >= 0 ? "#059669" : "#ef4444", marginTop: 2 }}>{pct(growth)} YoY</p>
                      )}
                    </td>
                  );
                })}
                <td style={S.tfootr}>{fmt(grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ── MONTHLY YEAR 1 ── */}
        {y1months.length > 0 && (
          <div style={S.section}>
            <div style={S.secHead}>
              <div style={{ width: 3, height: 16, background: `linear-gradient(${BRAND},${BRAND2})`, borderRadius: 2 }} />
              <div>
                <p style={S.secTitle}>Monthly Breakdown — Year 1</p>
                <p style={S.secSub}>Month-by-month revenue by stream with MoM growth</p>
              </div>
            </div>
            <table style={S.tbl}>
              <thead>
                <tr>
                  <th style={S.th}>Month</th>
                  {streams.map((s, si) => (
                    <th key={s.id} style={{ ...S.thr, color: COLORS[si % COLORS.length] }}>
                      {s.name.length > 12 ? s.name.slice(0, 11) + "…" : s.name}
                    </th>
                  ))}
                  <th style={{ ...S.thr, color: "#0f172a" }}>Total</th>
                  <th style={{ ...S.thr, color: "#64748b" }}>MoM</th>
                </tr>
              </thead>
              <tbody>
                {y1months.map((m, mi) => {
                  const prev = mi > 0 ? y1months[mi - 1].total : null;
                  const mom  = prev && prev > 0 ? ((m.total - prev) / prev) * 100 : null;
                  return (
                    <tr key={m.index} style={{ background: mi % 2 === 0 ? "#fff" : "#f8fafc" }}>
                      <td style={{ ...S.td, fontWeight: 600, color: "#334155" }}>{m.yearMonth}</td>
                      {streams.map((s) => <td key={s.id} style={S.tdr}>{fmt(m.byStream.find((b) => b.id === s.id)?.rev ?? 0)}</td>)}
                      <td style={{ ...S.tdr, fontWeight: 700, color: "#0f172a" }}>{fmt(m.total)}</td>
                      <td style={{ ...S.tdr, fontSize: 10, fontWeight: 600, color: mom === null ? "#cbd5e1" : mom >= 0 ? "#059669" : "#ef4444" }}>
                        {mom !== null ? pct(mom, 1) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td style={S.tfoot}>YEAR 1 TOTAL</td>
                  {streams.map((s) => {
                    const t = y1months.reduce((a, m) => a + (m.byStream.find((b) => b.id === s.id)?.rev ?? 0), 0);
                    return <td key={s.id} style={S.tfootr}>{fmt(t)}</td>;
                  })}
                  <td style={S.tfootr}>{fmt(years[0]?.total ?? 0)}</td>
                  <td style={S.tfootr}>—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* ── STREAM DETAIL CARDS ── */}
        <div style={{ breakBefore: "page" } as React.CSSProperties}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{ width: 3, height: 18, background: `linear-gradient(${BRAND},${BRAND2})`, borderRadius: 2 }} />
            <div>
              <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "#64748b" }}>Stream Detail</p>
              <p style={{ fontSize: 9, color: "#94a3b8", marginTop: 1 }}>Line items, pricing and seasonality per stream</p>
            </div>
          </div>
          {streams.map((s, si) => {
            const mrr   = streamMRR(s);
            const color = COLORS[si % COLORS.length];
            return (
              <div key={s.id} style={{ ...S.section, marginBottom: 14 }}>
                {/* stream header */}
                <div style={{ padding: "14px 20px 12px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", borderBottom: "1px solid #f1f5f9", background: `${color}0a`, WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" } as React.CSSProperties}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: color, flexShrink: 0 }} />
                    <div>
                      <p style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>{s.name}</p>
                      <p style={{ fontSize: 9, color: "#94a3b8", marginTop: 2 }}>
                        {TYPE_LABEL[s.type]} · {s.items.length} item{s.items.length !== 1 ? "s" : ""}
                        {s.seasonalityPreset !== "none" && ` · ${SEA[s.seasonalityPreset]?.label} seasonality`}
                      </p>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{fmt(mrr)}<span style={{ fontSize: 10, fontWeight: 400, color: "#94a3b8" }}>/mo</span></p>
                    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
                      <span style={{ fontSize: 9, fontWeight: 600, color: "#059669" }}>{s.volumeGrowthPct > 0 ? "+" : ""}{s.volumeGrowthPct}%/mo vol</span>
                      <span style={{ fontSize: 9, fontWeight: 600, color: "#2563eb" }}>{s.annualPriceGrowthPct > 0 ? "+" : ""}{s.annualPriceGrowthPct}%/yr price</span>
                    </div>
                  </div>
                </div>

                {/* items */}
                {s.items.length > 0 && (
                  <table style={S.tbl}>
                    <thead>
                      <tr>
                        <th style={S.th}>Item</th>
                        <th style={S.th}>Category</th>
                        <th style={S.thr}>Volume</th>
                        <th style={S.thr}>Unit Price</th>
                        <th style={S.thr}>Monthly Rev</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.items.map((it, ii) => {
                        const rev = s.type === "marketplace" ? it.volume * (it.price / 100) : it.volume * it.price;
                        return (
                          <tr key={it.id} style={{ background: ii % 2 === 0 ? "#fff" : "#f8fafc" }}>
                            <td style={{ ...S.td, fontWeight: 500 }}>{it.name}</td>
                            <td style={{ ...S.td, color: "#64748b" }}>{it.category || "General"}</td>
                            <td style={S.tdr}>{it.volume.toLocaleString()}</td>
                            <td style={S.tdr}>{fmt(it.price)}</td>
                            <td style={{ ...S.tdr, fontWeight: 700, color: "#0f172a" }}>{fmt(rev)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4} style={S.tfoot}>Stream Monthly Total</td>
                        <td style={S.tfootr}>{fmt(mrr)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}

                {/* seasonality bar */}
                {s.seasonalityPreset !== "none" && (
                  <div style={{ padding: "10px 20px 12px", borderTop: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 20 }}>
                    <div>
                      <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "#94a3b8", marginBottom: 3 }}>Seasonality Pattern</p>
                      <p style={{ fontSize: 10, color: "#334155" }}>{SEA[s.seasonalityPreset]?.label}</p>
                    </div>
                    <MiniBar mults={s.seasonalityMultipliers} color={color} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── FOOTER ── */}
        <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 20, marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 18, height: 18, background: BRAND, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>
            </div>
            <span style={{ fontWeight: 700, fontSize: 11, color: "#334155" }}>Mentorvix</span>
            <span style={{ color: "#94a3b8", fontSize: 10 }}>· AI-Powered Finance Intelligence · mentorvix.com</span>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: 9, color: "#94a3b8" }}>Generated {genDate}</p>
            <p style={{ fontSize: 9, color: "#cbd5e1", marginTop: 2 }}>Confidential — for authorised recipients only</p>
          </div>
        </div>

      </div>{/* /wrap */}
    </div>
  );
}
