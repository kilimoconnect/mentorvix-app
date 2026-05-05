"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { loadApplicationState } from "@/lib/supabase/revenue";
import type { DbRevenueStream, DbStreamItem, DbApplication, StreamType, Confidence } from "@/lib/supabase/revenue";

/* ─────────────────────────────── types ── */
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
  index: number; yearMonth: string; total: number;
  byStream: { id: string; rev: number }[];
}

/* ─────────────────────────────── constants ── */
const BRAND  = "#0e7490";
const BRAND2 = "#0891b2";
const DARK   = "#0c4a6e";
const COLORS = ["#0e7490","#7c3aed","#059669","#b45309","#e11d48","#6366f1",
                 "#0891b2","#8b5cf6","#0f766e","#dc2626","#d97706","#2563eb"];
const MO     = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

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

/* ─────────────────────────────── math ── */
function projectRevenue(streams: RevenueStream[], totalMonths: number, startDate: Date): ProjMonth[] {
  const subTotals: Record<string, number> = {};
  streams.forEach((s) => {
    if (s.type === "subscription")
      subTotals[s.id] = Math.max(1, s.items.reduce((a, it) => a + it.volume, 0));
  });
  return Array.from({ length: totalMonths }, (_, i) => {
    const d   = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
    const cal = (startDate.getMonth() + i) % 12;
    const getP = (s: RevenueStream, it: StreamItem) => {
      const ovrs = s.overrides ?? [];
      const iOvr = ovrs.find((o) => o.scope === "item" && (o.targetId === it.id || o.targetName === it.name));
      const cOvr = ovrs.find((o) => o.scope === "category" && (o.targetId || "General") === (it.category || "General"));
      const ovr  = iOvr ?? cOvr ?? null;
      const rp   = ovr?.seasonalityPreset ?? it.seasonalityPreset ?? null;
      const rm   = ovr?.seasonalityMultipliers ?? it.seasonalityMultipliers ?? null;
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
        s.items.forEach((it) => { const p = getP(s, it); if ((p.lm !== null && i < p.lm) || (p.em !== null && i > p.em)) return; rev += Math.round(it.volume * it.price * (subTotals[s.id] / init) * Math.pow(1 + p.pp / 1200, i) * (p.sm[cal] ?? 1) * xf); });
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
    return { index: i, yearMonth: `${MO[d.getMonth()]} ${d.getFullYear()}`, total: byStream.reduce((a, b) => a + b.rev, 0), byStream };
  });
}

function streamMRR(s: RevenueStream) {
  const occ = (s.rentalOccupancyPct ?? 100) / 100;
  return s.items.reduce((a, it) => s.type === "marketplace" ? a + it.volume * (it.price / 100) : s.type === "rental" ? a + it.volume * it.price * occ : a + it.volume * it.price, 0);
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
    seasonalityPreset:      (s.seasonality_preset ?? "none") as SeasonalityPreset,
    seasonalityMultipliers: (s.seasonality_multipliers as number[] | null) ?? SEA[(s.seasonality_preset ?? "none") as SeasonalityPreset]?.months ?? Array(12).fill(1),
    expansionMonth: null, expansionMultiplier: 1.5,
    overrides: (s.item_overrides as GrowthOverride[] | null) ?? [],
    items: items.map((it) => ({
      id: it.id, name: it.name, category: it.category ?? "General",
      volume: Number(it.volume), price: Number(it.price), unit: it.unit,
      seasonalityPreset:      (it.seasonality_preset as SeasonalityPreset | null) ?? undefined,
      seasonalityMultipliers: (it.seasonality_multipliers as number[] | null) ?? undefined,
    })),
  };
}

/* ─────────────────────────────── SVG bar chart ── */
function SeasonBar({ mults, color }: { mults: number[]; color: string }) {
  const max = Math.max(...mults, 0.01);
  const W = 108, H = 20, bw = (W - 11) / 12, gap = 1;
  return (
    <svg width={W} height={H + 10} style={{ display: "block", flexShrink: 0 }}>
      {mults.map((v, i) => {
        const bh = Math.max(2, (v / max) * H);
        const x  = i * (bw + gap);
        return (
          <g key={i}>
            <rect x={x} y={H - bh} width={bw} height={bh} rx={1}
              fill={color} opacity={0.35 + 0.65 * (v / max)} />
            <text x={x + bw / 2} y={H + 8} textAnchor="middle"
              fontSize={5.5} fill="#94a3b8" fontFamily="system-ui,sans-serif">
              {MO[i][0]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ─────────────────────────────── shared style tokens ── */
// Sized for A4 page — padding tighter, fonts smaller for print readability
const c = {
  TH:  { padding: "7px 10px", fontSize: 9,  fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "#64748b", background: "#f8fafc", borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap" as const, textAlign: "left" as const },
  THR: { padding: "7px 10px", fontSize: 9,  fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "#64748b", background: "#f8fafc", borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap" as const, textAlign: "right" as const },
  // Name column: caps width so number columns always have room
  TD:  { padding: "6px 10px", fontSize: 11, borderBottom: "1px solid #f1f5f9", color: "#334155", verticalAlign: "middle" as const, maxWidth: 180, overflow: "hidden" as const, textOverflow: "ellipsis" as const, whiteSpace: "nowrap" as const },
  // Number column: nowrap so digits stay on one line; Scrollable handles overflow
  TDR: { padding: "6px 10px", fontSize: 11, borderBottom: "1px solid #f1f5f9", color: "#334155", textAlign: "right" as const, fontVariantNumeric: "tabular-nums" as const, verticalAlign: "middle" as const, whiteSpace: "nowrap" as const },
  TF:  { padding: "8px 10px", fontSize: 10, fontWeight: 700, color: "#1e293b", background: "#f0f9ff", borderTop: "2px solid #cbd5e1", whiteSpace: "nowrap" as const, overflow: "hidden" as const, textOverflow: "ellipsis" as const },
  TFR: { padding: "8px 10px", fontSize: 10, fontWeight: 700, color: "#1e293b", background: "#f0f9ff", borderTop: "2px solid #cbd5e1", textAlign: "right" as const, fontVariantNumeric: "tabular-nums" as const, whiteSpace: "nowrap" as const },
};

function SectionLabel({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
      <div style={{ width: 3, minHeight: 16, background: `linear-gradient(180deg,${BRAND},${BRAND2})`, borderRadius: 2, marginTop: 1, flexShrink: 0 }} />
      <div>
        <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#64748b", lineHeight: 1.4 }}>{title}</p>
        {sub && <p style={{ fontSize: 9, color: "#94a3b8", marginTop: 2 }}>{sub}</p>}
      </div>
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", pageBreakInside: "avoid", ...style }}>
      {children}
    </div>
  );
}

function Scrollable({ children }: { children: React.ReactNode }) {
  return (
    <div data-scroll style={{ overflowX: "auto", width: "100%", minWidth: 0 }}>
      {children}
    </div>
  );
}

/* ─────────────────────────────── inner component (uses useSearchParams) ── */
function ReportInner({ appId }: { appId: string }) {
  const searchParams = useSearchParams();
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

  /* ── loading ── */
  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 32, height: 32, border: `3px solid ${BRAND}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 10px" }} />
        <p style={{ color: "#64748b", fontSize: 13, fontFamily: "system-ui,sans-serif" }}>Preparing your report…</p>
      </div>
    </div>
  );

  if (error || !app) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#ef4444", fontFamily: "system-ui,sans-serif" }}>{error ?? "Application not found"}</p>
    </div>
  );

  /* ── derived data ── */
  const fmt       = makeFmt(app.currency ?? "USD");
  const startDate = new Date(startYearP, startMonthP, 1);
  const proj      = projectRevenue(streams, horizonYears * 12, startDate);
  const years     = Array.from({ length: horizonYears }, (_, y) => {
    const months = proj.slice(y * 12, y * 12 + 12);
    return { idx: y + 1, months, total: months.reduce((a, m) => a + m.total, 0) };
  });
  const baseMRR    = streams.reduce((a, s) => a + streamMRR(s), 0);
  const grandTotal = years.reduce((a, y) => a + y.total, 0);
  const lastMRR    = proj[proj.length - 1]?.total ?? 0;
  const cagr       = years.length > 1 && (years[0]?.total ?? 0) > 0
    ? (Math.pow(years[years.length - 1].total / years[0].total, 1 / (years.length - 1)) - 1) * 100 : null;
  const totalItems = streams.reduce((a, s) => a + s.items.length, 0);
  const genDate    = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const y1months   = years[0]?.months ?? [];
  const pct        = (n: number, d = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;
  const streamYrT  = (sid: string, yr: typeof years[0]) =>
    yr.months.reduce((a, m) => a + (m.byStream.find((b) => b.id === sid)?.rev ?? 0), 0);

  /* shared print-color-adjust style — must be on every coloured element */
  const colorAdjust = { WebkitPrintColorAdjust: "exact" as const, printColorAdjust: "exact" as const };

  return (
    <div style={{ background: "#f1f5f9", minHeight: "100vh", fontFamily: "'Geist', system-ui, -apple-system, Arial, sans-serif", ...colorAdjust }}>

      {/* ══ screen-only toolbar ══ */}
      <div id="toolbar" style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(255,255,255,0.96)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", borderBottom: "1px solid #e2e8f0", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, background: `linear-gradient(135deg,${DARK},${BRAND2})`, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, ...colorAdjust }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", lineHeight: 1 }}>Mentorvix</p>
            <p style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1, marginTop: 2 }}>Revenue Forecast Report</p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => window.close()}
            style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, color: "#64748b", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 7, cursor: "pointer", lineHeight: 1 }}>
            ✕ Close
          </button>
          <button onClick={() => window.print()}
            style={{ padding: "6px 16px", fontSize: 12, fontWeight: 700, color: "#fff", background: `linear-gradient(135deg,${DARK},${BRAND2})`, border: "none", borderRadius: 7, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, lineHeight: 1, ...colorAdjust }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6,9 6,2 18,2 18,9"/><path d="M6,18H4a2,2,0,0,1-2-2V11a2,2,0,0,1,2-2H20a2,2,0,0,1,2,2v5a2,2,0,0,1-2,2H18"/><rect x="6" y="14" width="12" height="8"/></svg>
            Print / Save PDF
          </button>
        </div>
      </div>

      {/* ══ A4 report body — max-width calibrated for A4 print area ══ */}
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "22px 14px 56px" }}>

        {/* ── COVER ── */}
        <div style={{ background: `linear-gradient(135deg,${DARK} 0%,${BRAND} 55%,${BRAND2} 100%)`, borderRadius: 12, padding: "28px 32px 24px", marginBottom: 20, pageBreakInside: "avoid", ...colorAdjust }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <div style={{ width: 34, height: 34, background: "rgba(255,255,255,0.15)", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", ...colorAdjust }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>
              </div>
              <span style={{ color: "rgba(255,255,255,0.88)", fontSize: 14, fontWeight: 800, letterSpacing: "0.06em" }}>MENTORVIX</span>
            </div>
            <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 9, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase" }}>Confidential</span>
          </div>

          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>Revenue Forecast Report</p>
          <h1 style={{ color: "#fff", fontSize: 26, fontWeight: 800, lineHeight: 1.2, marginBottom: 20, overflowWrap: "break-word", wordBreak: "break-word", maxWidth: "100%" }}>{app.name ?? "Revenue Model"}</h1>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 0, borderTop: "1px solid rgba(255,255,255,0.18)", paddingTop: 16 }}>
            {[
              { l: "Prepared",        v: genDate },
              { l: "Start Period",    v: startDate.toLocaleDateString("en-US", { month: "short", year: "numeric" }) },
              { l: "Horizon",         v: `${horizonYears} ${horizonYears === 1 ? "Year" : "Years"}` },
              { l: "Streams · Items", v: `${streams.length} · ${totalItems}` },
            ].map((m, i) => (
              <div key={i} style={{ paddingRight: 10 }}>
                <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 8, fontWeight: 700, letterSpacing: "0.11em", textTransform: "uppercase", marginBottom: 4 }}>{m.l}</p>
                <p style={{ color: "#fff", fontSize: 11, fontWeight: 600 }}>{m.v}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── KPI CARDS ── */}
        <div style={{ marginBottom: 20, pageBreakInside: "avoid" }}>
          <SectionLabel title="Executive Summary" sub={`Key metrics across the ${horizonYears}-year projection`} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10 }}>
            {[
              { label: "Baseline MRR",              value: fmt(baseMRR),              note: "Current monthly run rate",   accent: BRAND    },
              { label: "Year 1 Revenue",             value: fmt(years[0]?.total ?? 0), note: "12-month projected total",   accent: "#7c3aed" },
              { label: `${horizonYears}-Year Total`, value: fmt(grandTotal),            note: "Cumulative projection",      accent: "#059669" },
              { label: cagr !== null ? "Revenue CAGR" : "Final Month MRR",
                value: cagr !== null ? pct(cagr) : fmt(lastMRR),
                note:  cagr !== null ? "Year-on-year growth rate" : `Month ${horizonYears * 12} run rate`,
                accent: "#b45309" },
            ].map((k, i) => (
              <div key={i} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 18px 13px", ...colorAdjust }}>
                <div style={{ width: 28, height: 3, background: k.accent, borderRadius: 2, marginBottom: 10, ...colorAdjust }} />
                <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "#94a3b8", marginBottom: 5 }}>{k.label}</p>
                <p style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", fontVariantNumeric: "tabular-nums", lineHeight: 1.1, overflowWrap: "break-word", wordBreak: "break-all", minWidth: 0 }}>{k.value}</p>
                <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 7 }}>{k.note}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── STREAMS TABLE ── */}
        <div style={{ marginBottom: 20, pageBreakInside: "avoid" }}>
          <SectionLabel title="Revenue Streams" sub="Baseline MRR and growth assumptions per stream" />
          <Card>
            <Scrollable>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ ...colorAdjust }}>
                    <th style={c.TH}>Stream</th>
                    <th style={c.TH}>Type</th>
                    <th style={c.THR}>Baseline MRR</th>
                    <th style={c.THR}>Vol / Price Growth</th>
                    <th style={c.TH}>Seasonality</th>
                    <th style={{ ...c.TH, textAlign: "center" }}>Pattern</th>
                  </tr>
                </thead>
                <tbody>
                  {streams.map((s, si) => {
                    const mrr = streamMRR(s);
                    const col = COLORS[si % COLORS.length];
                    return (
                      <tr key={s.id} style={{ background: si % 2 === 0 ? "#fff" : "#f8fafc", ...colorAdjust }}>
                        <td style={c.TD}>
                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: col, flexShrink: 0, ...colorAdjust }} />
                            <div>
                              <p style={{ fontWeight: 600, color: "#0f172a", fontSize: 11 }}>{s.name}</p>
                              <p style={{ fontSize: 9, color: "#94a3b8", marginTop: 1 }}>{s.items.length} item{s.items.length !== 1 ? "s" : ""}</p>
                            </div>
                          </div>
                        </td>
                        <td style={c.TD}>
                          <span style={{ display: "inline-block", padding: "2px 7px", borderRadius: 20, fontSize: 9, fontWeight: 700, background: `${col}20`, color: col, border: `1px solid ${col}40`, whiteSpace: "nowrap", ...colorAdjust }}>
                            {TYPE_LABEL[s.type]}
                          </span>
                        </td>
                        <td style={{ ...c.TDR, fontWeight: 700, color: "#0f172a" }}>{fmt(mrr)}</td>
                        <td style={c.TDR}>
                          <span style={{ color: s.volumeGrowthPct > 0 ? "#059669" : "#94a3b8", fontWeight: 600 }}>
                            {s.volumeGrowthPct > 0 ? "+" : ""}{s.volumeGrowthPct}%/mo
                          </span>
                          <span style={{ color: "#cbd5e1", margin: "0 3px" }}>·</span>
                          <span style={{ color: s.annualPriceGrowthPct > 0 ? "#2563eb" : "#94a3b8", fontWeight: 600 }}>
                            {s.annualPriceGrowthPct > 0 ? "+" : ""}{s.annualPriceGrowthPct}%/yr
                          </span>
                        </td>
                        <td style={{ ...c.TD, fontSize: 10 }}>{SEA[s.seasonalityPreset]?.label ?? "Flat"}</td>
                        <td style={{ ...c.TD, textAlign: "center", padding: "5px 10px" }}>
                          <SeasonBar mults={s.seasonalityMultipliers} color={col} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ ...colorAdjust }}>
                    <td colSpan={2} style={{ ...c.TF, ...colorAdjust }}>TOTAL</td>
                    <td style={{ ...c.TFR, ...colorAdjust }}>{fmt(baseMRR)}</td>
                    <td colSpan={3} style={{ ...c.TF, color: "#64748b", fontWeight: 400, fontSize: 10, ...colorAdjust }}>Baseline monthly revenue across all streams</td>
                  </tr>
                </tfoot>
              </table>
            </Scrollable>
          </Card>
        </div>

        {/* ── ANNUAL FORECAST ── */}
        <div style={{ marginBottom: 20, pageBreakInside: "avoid" }}>
          <SectionLabel title="Annual Forecast" sub={`${horizonYears}-year revenue by stream with YoY growth`} />
          <Card>
            <Scrollable>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ ...colorAdjust }}>
                    <th style={c.TH}>Stream</th>
                    {years.map((y) => <th key={y.idx} style={c.THR}>Year {y.idx}</th>)}
                    <th style={c.THR}>{horizonYears}-Yr Total</th>
                  </tr>
                </thead>
                <tbody>
                  {streams.map((s, si) => {
                    const ytotals = years.map((y) => streamYrT(s.id, y));
                    return (
                      <tr key={s.id} style={{ background: si % 2 === 0 ? "#fff" : "#f8fafc", ...colorAdjust }}>
                        <td style={c.TD}>
                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <div style={{ width: 7, height: 7, borderRadius: "50%", background: COLORS[si % COLORS.length], flexShrink: 0, ...colorAdjust }} />
                            <span style={{ fontWeight: 600, color: "#334155", fontSize: 11 }}>{s.name}</span>
                          </div>
                        </td>
                        {ytotals.map((v, yi) => <td key={yi} style={c.TDR}>{fmt(v)}</td>)}
                        <td style={{ ...c.TDR, fontWeight: 700, color: "#0f172a" }}>{fmt(ytotals.reduce((a, v) => a + v, 0))}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ ...colorAdjust }}>
                    <td style={{ ...c.TF, ...colorAdjust }}>TOTAL REVENUE</td>
                    {years.map((y, yi) => {
                      const prev = yi > 0 ? years[yi - 1].total : null;
                      const g    = prev && prev > 0 ? ((y.total - prev) / prev) * 100 : null;
                      return (
                        <td key={y.idx} style={{ ...c.TFR, ...colorAdjust }}>
                          <p>{fmt(y.total)}</p>
                          {g !== null && <p style={{ fontSize: 9, color: g >= 0 ? "#059669" : "#ef4444", marginTop: 2 }}>{pct(g)} YoY</p>}
                        </td>
                      );
                    })}
                    <td style={{ ...c.TFR, ...colorAdjust }}>{fmt(grandTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </Scrollable>
          </Card>
        </div>

        {/* ── MONTHLY YEAR 1 ── */}
        {y1months.length > 0 && (
          <div style={{ marginBottom: 20, pageBreakInside: "avoid" }}>
            <SectionLabel title="Monthly Breakdown — Year 1" sub="Month-by-month revenue with MoM change" />
            <Card>
              <Scrollable>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ ...colorAdjust }}>
                      <th style={c.TH}>Month</th>
                      {streams.map((s, si) => (
                        <th key={s.id} style={{ ...c.THR, color: COLORS[si % COLORS.length] }}>
                          {s.name.length > 10 ? s.name.slice(0, 9) + "…" : s.name}
                        </th>
                      ))}
                      <th style={c.THR}>Total</th>
                      <th style={c.THR}>MoM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {y1months.map((m, mi) => {
                      const prev = mi > 0 ? y1months[mi - 1].total : null;
                      const mom  = prev && prev > 0 ? ((m.total - prev) / prev) * 100 : null;
                      return (
                        <tr key={m.index} style={{ background: mi % 2 === 0 ? "#fff" : "#f8fafc", ...colorAdjust }}>
                          <td style={{ ...c.TD, fontWeight: 600, color: "#334155" }}>{m.yearMonth}</td>
                          {streams.map((s) => <td key={s.id} style={c.TDR}>{fmt(m.byStream.find((b) => b.id === s.id)?.rev ?? 0)}</td>)}
                          <td style={{ ...c.TDR, fontWeight: 700, color: "#0f172a" }}>{fmt(m.total)}</td>
                          <td style={{ ...c.TDR, fontSize: 10, fontWeight: 600, color: mom === null ? "#cbd5e1" : mom >= 0 ? "#059669" : "#ef4444" }}>
                            {mom !== null ? pct(mom) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ ...colorAdjust }}>
                      <td style={{ ...c.TF, ...colorAdjust }}>YEAR 1 TOTAL</td>
                      {streams.map((s) => {
                        const t = y1months.reduce((a, m) => a + (m.byStream.find((b) => b.id === s.id)?.rev ?? 0), 0);
                        return <td key={s.id} style={{ ...c.TFR, ...colorAdjust }}>{fmt(t)}</td>;
                      })}
                      <td style={{ ...c.TFR, ...colorAdjust }}>{fmt(years[0]?.total ?? 0)}</td>
                      <td style={{ ...c.TFR, ...colorAdjust }}>—</td>
                    </tr>
                  </tfoot>
                </table>
              </Scrollable>
            </Card>
          </div>
        )}

        {/* ── STREAM DETAIL CARDS ── */}
        <div style={{ marginBottom: 20 }}>
          <SectionLabel title="Stream Detail" sub="Line items, pricing and seasonality per stream" />
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {streams.map((s, si) => {
              const mrr = streamMRR(s);
              const col = COLORS[si % COLORS.length];
              return (
                <Card key={s.id}>
                  {/* stream header */}
                  <div style={{ padding: "13px 16px 11px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, borderBottom: "1px solid #f1f5f9", background: `${col}0c`, ...colorAdjust }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: col, flexShrink: 0, marginTop: 2, ...colorAdjust }} />
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontWeight: 700, fontSize: 13, color: "#0f172a", lineHeight: 1.3, overflowWrap: "break-word", wordBreak: "break-word" }}>{s.name}</p>
                        <p style={{ fontSize: 10, color: "#94a3b8", marginTop: 3 }}>
                          {TYPE_LABEL[s.type]} · {s.items.length} item{s.items.length !== 1 ? "s" : ""}
                          {s.seasonalityPreset !== "none" && ` · ${SEA[s.seasonalityPreset]?.label} pattern`}
                        </p>
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <p style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", fontVariantNumeric: "tabular-nums", lineHeight: 1.1, overflowWrap: "break-word", wordBreak: "break-all", minWidth: 0, maxWidth: 220 }}>
                        {fmt(mrr)}<span style={{ fontSize: 10, fontWeight: 400, color: "#94a3b8" }}>/mo</span>
                      </p>
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
                        <span style={{ fontSize: 9, fontWeight: 600, color: "#059669" }}>{s.volumeGrowthPct > 0 ? "+" : ""}{s.volumeGrowthPct}%/mo vol</span>
                        <span style={{ fontSize: 9, fontWeight: 600, color: "#2563eb" }}>{s.annualPriceGrowthPct > 0 ? "+" : ""}{s.annualPriceGrowthPct}%/yr price</span>
                      </div>
                    </div>
                  </div>
                  {/* items */}
                  {s.items.length > 0 && (
                    <Scrollable>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ ...colorAdjust }}>
                            <th style={c.TH}>Item</th>
                            <th style={c.TH}>Category</th>
                            <th style={c.THR}>Volume</th>
                            <th style={c.THR}>Unit Price</th>
                            <th style={c.THR}>Monthly Rev</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.items.map((it, ii) => {
                            const rev = s.type === "marketplace" ? it.volume * (it.price / 100) : it.volume * it.price;
                            return (
                              <tr key={it.id} style={{ background: ii % 2 === 0 ? "#fff" : "#f8fafc", ...colorAdjust }}>
                                <td style={{ ...c.TD, fontWeight: 500 }}>{it.name}</td>
                                <td style={{ ...c.TD, color: "#64748b" }}>{it.category || "General"}</td>
                                <td style={c.TDR}>{it.volume.toLocaleString()}</td>
                                <td style={c.TDR}>{fmt(it.price)}</td>
                                <td style={{ ...c.TDR, fontWeight: 700, color: "#0f172a" }}>{fmt(rev)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{ ...colorAdjust }}>
                            <td colSpan={4} style={{ ...c.TF, ...colorAdjust }}>Stream Monthly Total</td>
                            <td style={{ ...c.TFR, ...colorAdjust }}>{fmt(mrr)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </Scrollable>
                  )}
                  {/* seasonality */}
                  {s.seasonalityPreset !== "none" && (
                    <div style={{ padding: "10px 16px 12px", borderTop: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                      <div>
                        <p style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.11em", textTransform: "uppercase" as const, color: "#94a3b8", marginBottom: 3 }}>Seasonality</p>
                        <p style={{ fontSize: 11, color: "#334155", fontWeight: 500 }}>{SEA[s.seasonalityPreset]?.label}</p>
                      </div>
                      <SeasonBar mults={s.seasonalityMultipliers} color={col} />
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>

        {/* ── FOOTER ── */}
        <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <div style={{ width: 18, height: 18, background: BRAND, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", ...colorAdjust }}>
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

      </div>{/* /A4 body */}
    </div>
  );
}

/* ─────────────────────────────── root export — Suspense required for useSearchParams ── */
export default function ReportPage() {
  const params = useParams();
  const appId  = params.appId as string;

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }

        /* A4: 210mm × 297mm. Margins 12mm × 15mm → usable ≈ 180mm × 273mm ≈ 680px × 1032px at 96dpi */
        @page { size: A4 portrait; margin: 12mm 15mm; }

        @media print {
          #toolbar { display: none !important; }

          /* Force all background colours to render in print */
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }

          /* Shrink table text further in print so large numbers never push columns off-page */
          table { font-size: 9px !important; }
          th, td { padding: 4px 7px !important; font-size: 9px !important; white-space: nowrap !important; }

          /* Allow scrollable wrappers to expand fully in print (no clipping) */
          [data-scroll] { overflow: visible !important; }

          /* Prevent awkward mid-card page breaks */
          .avoid-break { page-break-inside: avoid !important; }

          /* Remove outer page padding for print — let @page margins handle it */
          body { margin: 0 !important; background: #f1f5f9 !important; }
        }
      `}</style>
      <Suspense fallback={
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
          <p style={{ color: "#64748b", fontFamily: "system-ui,sans-serif", fontSize: 13 }}>Loading…</p>
        </div>
      }>
        <ReportInner appId={appId} />
      </Suspense>
    </>
  );
}
