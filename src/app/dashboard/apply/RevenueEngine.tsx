"use client";

import {
  useState, useEffect, useRef, useCallback,
} from "react";
import { createClient } from "@/lib/supabase/client";
import {
  saveStreams, saveStreamItems,
  saveIntakeConversation, saveDriverConversation,
  updateApplicationFlags,
} from "@/lib/supabase/revenue";

/* ─────────────────────────────────── types ── */

type StreamType = "product" | "service" | "subscription" | "rental" | "marketplace" | "contract" | "custom";
type Confidence = "high" | "medium" | "low";
type ChatMsg = { role: "user" | "assistant"; content: string };

interface DetectedStream { name: string; type: StreamType; confidence: Confidence; }

interface ParsedItem {
  id: string; name: string; category: string;
  volume: number; price: number; costPrice?: number; unit: string; note?: string;
}

interface GrowthProfile {
  trend: "growing" | "stable" | "fluctuating";
  monthlyVolumePct: number;
  annualPricePct: number;
}

type SeasonalityPreset = "none" | "q4_peak" | "q1_slow" | "summer_peak" | "end_of_year" | "construction";

interface SeasonalityProfile {
  variation: "none" | "mild" | "strong";
  preset: SeasonalityPreset;
  multipliers: number[];
}

interface WorkingStream {
  id: string;
  name: string;
  type: StreamType;
  confidence: Confidence;
  items: ParsedItem[];
  growth: GrowthProfile | null;
  seasonality: SeasonalityProfile | null;
  status: "pending" | "in_progress" | "completed";
}

type StreamPhase =
  | "intro" | "complexity" | "collect_chat" | "collect_paste"
  | "confirm_items" | "growth" | "confirm_growth"
  | "seasonality" | "confirm_seasonality" | "stream_summary";

type EnginePhase =
  | "detecting"
  | "confirm_streams"
  | { kind: "stream"; idx: number; phase: StreamPhase }
  | "confirm_model"
  | "done";

type CardData =
  | { type: "confirm_streams"; streams: DetectedStream[] }
  | { type: "complexity" }
  | { type: "paste_data"; streamName: string }
  | { type: "confirm_items"; items: ParsedItem[] }
  | { type: "growth" }
  | { type: "confirm_growth"; profile: GrowthProfile }
  | { type: "seasonality"; streamType: StreamType }
  | { type: "confirm_seasonality"; profile: SeasonalityProfile }
  | { type: "stream_summary"; stream: WorkingStream }
  | { type: "confirm_model"; streams: WorkingStream[] };

type FeedItemInput =
  | { kind: "ai"; text: string }
  | { kind: "user"; text: string }
  | { kind: "typing" }
  | { kind: "divider"; text: string; color: "slate" | "cyan" | "emerald" | "violet" }
  | { kind: "card"; resolved: boolean; resolvedLabel?: string; card: CardData };

type FeedItem = FeedItemInput & { id: number };

/* ─────────────────────────────────── props ── */

interface RevenueEngineProps {
  situation:         string | null;
  appId:             string | null;
  userId:            string | null;
  onStreamsDetected:  (streams: WorkingStream[]) => void;
  onItemsSaved:      (streamId: string, items: ParsedItem[]) => void;
  onForecastYears:   (y: number) => void;
  onForecastStart:   (year: number, month: number) => void;
  onComplete:        () => void;
}

/* ─────────────────────────────────── constants ── */

const SEASONALITY_PRESETS: Record<SeasonalityPreset, { label: string; multipliers: number[] }> = {
  none:         { label: "No seasonal variation",   multipliers: Array(12).fill(1) },
  q4_peak:      { label: "Q4 Retail Peak",          multipliers: [0.82,0.80,0.90,0.92,0.95,0.98,0.95,0.92,1.00,1.05,1.20,1.51] },
  q1_slow:      { label: "Q1 Slow Start",           multipliers: [0.75,0.78,0.95,1.05,1.10,1.12,1.12,1.08,1.02,1.02,1.00,1.01] },
  summer_peak:  { label: "Summer Peak",             multipliers: [0.80,0.82,0.90,1.00,1.08,1.20,1.28,1.22,1.10,0.98,0.90,0.72] },
  end_of_year:  { label: "Year-End Corporate",      multipliers: [0.88,0.88,0.92,0.95,1.00,1.00,0.92,0.95,1.05,1.10,1.18,1.17] },
  construction: { label: "Dry Season Peak",         multipliers: [1.15,1.18,1.20,1.10,1.05,0.85,0.80,0.82,0.90,1.00,1.05,0.90] },
};

const STREAM_META: Record<StreamType, { label: string; color: string; bg: string }> = {
  product:      { label: "Product Sales",            color: "#0e7490", bg: "#f0f9ff" },
  service:      { label: "Service / Project",        color: "#7c3aed", bg: "#faf5ff" },
  subscription: { label: "Subscription / MRR",       color: "#059669", bg: "#f0fdf4" },
  rental:       { label: "Rental / Lease",           color: "#b45309", bg: "#fffbeb" },
  marketplace:  { label: "Marketplace / Commission", color: "#e11d48", bg: "#fff1f2" },
  contract:     { label: "Contract / B2B Deal",      color: "#0f766e", bg: "#f0fdfa" },
  custom:       { label: "Custom / Processing",      color: "#6366f1", bg: "#eef2ff" },
};

/* ─────────────────────────────────── parse helpers ── */

function parseStreams(text: string): DetectedStream[] | null {
  const idx = text.indexOf("[STREAMS_DETECTED]");
  if (idx === -1) return null;
  try {
    const jsonStr = text.slice(idx + "[STREAMS_DETECTED]".length).trim();
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) return parsed as DetectedStream[];
  } catch { /* fall through */ }
  return null;
}

function parseItems(text: string): ParsedItem[] | null {
  const idx = text.indexOf("[ITEMS_DETECTED]");
  if (idx === -1) return null;
  try {
    let jsonStr = text.slice(idx + "[ITEMS_DETECTED]".length).trim();
    // Strip trailing detection tags so JSON.parse doesn't choke
    const nextTag = jsonStr.search(/\[FORECAST_YEARS\]|\[FORECAST_START\]/);
    if (nextTag !== -1) jsonStr = jsonStr.slice(0, nextTag).trim();
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      return (parsed as ParsedItem[]).map((it, i) => ({
        ...it,
        id: it.id ?? `item-${i}-${Date.now()}`,
      }));
    }
  } catch { /* fall through */ }
  return null;
}

function parseForecastYears(text: string): number | null {
  const match = text.match(/\[FORECAST_YEARS:(\d+)\]/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return isNaN(n) ? null : n;
}

function parseForecastStart(text: string): { year: number; month: number } | null {
  const match = text.match(/\[FORECAST_START:(\d{4})-(\d{1,2})\]/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  if (isNaN(year) || isNaN(month)) return null;
  return { year, month };
}

/* ─────────────────────────────────── uid helper ── */
let _uid = 0;
function uid() { return ++_uid; }

/* ─────────────────────────────────── sub-components (cards) ── */

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3 bg-slate-50 rounded-2xl w-fit max-w-[85%]">
      {[0,1,2].map(i => (
        <span
          key={i}
          className="w-2 h-2 rounded-full bg-slate-400 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

interface ResolvedChipProps { label: string; }
function ResolvedChip({ label }: ResolvedChipProps) {
  return (
    <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-sm font-medium">
      <span>✓</span> {label}
    </span>
  );
}

/* ── ConfirmStreamsCard ── */
interface ConfirmStreamsCardProps {
  streams: DetectedStream[];
  onConfirm: (streams: DetectedStream[]) => void;
  onEdit: () => void;
}
function ConfirmStreamsCard({ streams, onConfirm, onEdit }: ConfirmStreamsCardProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 border-l-4 border-l-red-400">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-base">🔴</span>
        <h3 className="font-semibold text-slate-800">Confirm Revenue Streams</h3>
      </div>
      <ul className="space-y-2 mb-5">
        {streams.map((s, i) => {
          const meta = STREAM_META[s.type];
          return (
            <li key={i} className="flex items-center gap-3">
              <span
                className="px-2 py-0.5 rounded text-xs font-medium"
                style={{ color: meta.color, background: meta.bg }}
              >
                {meta.label}
              </span>
              <span className="text-slate-700 text-sm font-medium">{s.name}</span>
              <span className={`ml-auto text-xs px-1.5 py-0.5 rounded font-medium ${
                s.confidence === "high" ? "bg-emerald-50 text-emerald-700" :
                s.confidence === "medium" ? "bg-amber-50 text-amber-700" :
                "bg-rose-50 text-rose-700"
              }`}>
                {s.confidence}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex gap-3">
        <button
          onClick={() => onConfirm(streams)}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          Confirm
        </button>
        <button
          onClick={onEdit}
          className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
        >
          Edit
        </button>
      </div>
    </div>
  );
}

/* ── ComplexityCard ── */
interface ComplexityCardProps {
  onSelect: (choice: "under20" | "20to100" | "more100") => void;
}
function ComplexityCard({ onSelect }: ComplexityCardProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <p className="text-slate-700 text-sm font-medium mb-4">How many products/items are in this stream?</p>
      <div className="flex flex-wrap gap-3">
        {(["under20","20to100","more100"] as const).map(v => (
          <button
            key={v}
            onClick={() => onSelect(v)}
            className="px-4 py-2 border border-cyan-300 text-cyan-700 rounded-full text-sm font-medium hover:bg-cyan-50 transition-colors"
          >
            {v === "under20" ? "Under 20" : v === "20to100" ? "20–100" : "More than 100"}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── PasteDataCard ── */
interface PasteDataCardProps {
  streamName: string;
  onExtract: (text: string) => void;
}
function PasteDataCard({ streamName, onExtract }: PasteDataCardProps) {
  const [text, setText] = useState("");
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <h3 className="font-semibold text-slate-800 mb-1">Import Product Data</h3>
      <p className="text-xs text-slate-500 mb-3">{streamName}</p>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={6}
        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-300 resize-none"
        placeholder="Paste your data here — Name | Monthly Volume | Price (one item per line)"
      />
      <button
        onClick={() => { if (text.trim()) onExtract(text.trim()); }}
        disabled={!text.trim()}
        className="mt-3 px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-medium hover:bg-cyan-700 transition-colors disabled:opacity-40"
      >
        Extract Data
      </button>
    </div>
  );
}

/* ── ConfirmItemsCard ── */
interface ConfirmItemsCardProps {
  items: ParsedItem[];
  onConfirm: () => void;
  onEdit: () => void;
}
function ConfirmItemsCard({ items, onConfirm, onEdit }: ConfirmItemsCardProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 border-l-4 border-l-red-400">
      <div className="flex items-center gap-2 mb-4">
        <span>🔴</span>
        <h3 className="font-semibold text-slate-800">Confirm Items ({items.length} detected)</h3>
      </div>
      <div className="overflow-x-auto mb-5">
        <table className="w-full text-xs text-slate-600">
          <thead>
            <tr className="border-b border-slate-100">
              {["Name","Volume","Unit","Price","Cost Price"].map(h => (
                <th key={h} className="text-left py-1.5 px-2 font-medium text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="py-1.5 px-2 font-medium">{it.name}</td>
                <td className="py-1.5 px-2">{it.volume}</td>
                <td className="py-1.5 px-2">{it.unit}</td>
                <td className="py-1.5 px-2">{it.price}</td>
                <td className="py-1.5 px-2">{it.costPrice ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-3">
        <button
          onClick={onConfirm}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          Confirm &amp; Save
        </button>
        <button
          onClick={onEdit}
          className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
        >
          Edit
        </button>
      </div>
    </div>
  );
}

/* ── GrowthCard ── */
interface GrowthCardProps {
  onConfirm: (profile: GrowthProfile) => void;
}
function GrowthCard({ onConfirm }: GrowthCardProps) {
  const [trend, setTrend] = useState<GrowthProfile["trend"] | null>(null);
  const [monthlyVol, setMonthlyVol] = useState("");
  const [annualPrice, setAnnualPrice] = useState("");

  function handleTrend(t: GrowthProfile["trend"]) {
    setTrend(t);
    if (t === "growing")    { setMonthlyVol("2.0"); setAnnualPrice("5.0"); }
    if (t === "stable")     { setMonthlyVol("0");   setAnnualPrice("0"); }
    if (t === "fluctuating"){ setMonthlyVol("1.0"); setAnnualPrice("3.0"); }
  }

  function handleConfirm() {
    if (!trend) return;
    onConfirm({
      trend,
      monthlyVolumePct: parseFloat(monthlyVol) || 0,
      annualPricePct:   parseFloat(annualPrice) || 0,
    });
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <p className="text-slate-700 text-sm font-medium mb-4">How are sales performing for this stream?</p>
      <div className="flex flex-wrap gap-3 mb-5">
        {([
          { v: "growing" as const,     label: "📈 Growing" },
          { v: "stable" as const,      label: "➡ Stable" },
          { v: "fluctuating" as const, label: "〜 Fluctuating" },
        ]).map(opt => (
          <button
            key={opt.v}
            onClick={() => handleTrend(opt.v)}
            className={`px-4 py-2 border rounded-full text-sm font-medium transition-colors ${
              trend === opt.v
                ? "bg-cyan-600 border-cyan-600 text-white"
                : "border-cyan-300 text-cyan-700 hover:bg-cyan-50"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {trend && trend !== "stable" && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Monthly volume growth %</label>
            <input
              type="number"
              value={monthlyVol}
              onChange={e => setMonthlyVol(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-300"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Annual price growth %</label>
            <input
              type="number"
              value={annualPrice}
              onChange={e => setAnnualPrice(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-300"
            />
          </div>
        </div>
      )}
      {trend && (
        <button
          onClick={handleConfirm}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          Confirm Growth
        </button>
      )}
    </div>
  );
}

/* ── ConfirmGrowthCard ── */
interface ConfirmGrowthCardProps {
  profile: GrowthProfile;
  onConfirm: () => void;
  onAdjust: () => void;
}
function ConfirmGrowthCard({ profile, onConfirm, onAdjust }: ConfirmGrowthCardProps) {
  const effectiveCombined = ((1 + profile.monthlyVolumePct / 100) ** 12 - 1) * 100 + profile.annualPricePct;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 border-l-4 border-l-red-400">
      <h3 className="font-semibold text-slate-800 mb-4">Growth Profile</h3>
      <dl className="grid grid-cols-2 gap-y-2 text-sm mb-5">
        <dt className="text-slate-500">Trend</dt>
        <dd className="text-slate-800 font-medium capitalize">{profile.trend}</dd>
        <dt className="text-slate-500">Monthly volume growth</dt>
        <dd className="text-slate-800 font-medium">{profile.monthlyVolumePct}%</dd>
        <dt className="text-slate-500">Annual price growth</dt>
        <dd className="text-slate-800 font-medium">{profile.annualPricePct}%</dd>
        <dt className="text-slate-500">Effective combined rate</dt>
        <dd className="text-slate-800 font-medium">{effectiveCombined.toFixed(1)}% / yr</dd>
      </dl>
      <div className="flex gap-3">
        <button onClick={onConfirm} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors">Confirm</button>
        <button onClick={onAdjust} className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">Adjust</button>
      </div>
    </div>
  );
}

/* ── SeasonalityCard ── */
interface SeasonalityCardProps {
  streamType: StreamType;
  onConfirm: (profile: SeasonalityProfile) => void;
}
function SeasonalityCard({ onConfirm }: SeasonalityCardProps) {
  const [variation, setVariation] = useState<SeasonalityProfile["variation"] | null>(null);
  const [preset, setPreset] = useState<SeasonalityPreset>("none");

  const presetOptions: Array<{ value: SeasonalityPreset; label: string }> = [
    { value: "q4_peak",      label: "Q4 Retail Peak" },
    { value: "q1_slow",      label: "Q1 Slow Start" },
    { value: "summer_peak",  label: "Summer Peak" },
    { value: "end_of_year",  label: "Year-End Corporate" },
    { value: "construction", label: "Dry Season Peak" },
  ];

  function handleConfirm() {
    if (!variation) return;
    const effectivePreset: SeasonalityPreset = variation === "none" ? "none" : preset;
    onConfirm({
      variation,
      preset: effectivePreset,
      multipliers: SEASONALITY_PRESETS[effectivePreset].multipliers,
    });
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <p className="text-slate-700 text-sm font-medium mb-4">Do sales for this stream vary by month?</p>
      <div className="flex flex-wrap gap-3 mb-5">
        {([
          { v: "none" as const,   label: "No variation" },
          { v: "mild" as const,   label: "Mild variation" },
          { v: "strong" as const, label: "Strong variation" },
        ]).map(opt => (
          <button
            key={opt.v}
            onClick={() => setVariation(opt.v)}
            className={`px-4 py-2 border rounded-full text-sm font-medium transition-colors ${
              variation === opt.v
                ? "bg-cyan-600 border-cyan-600 text-white"
                : "border-cyan-300 text-cyan-700 hover:bg-cyan-50"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {variation && variation !== "none" && (
        <div className="mb-4">
          <label className="block text-xs text-slate-500 mb-1">Seasonality pattern</label>
          <select
            value={preset}
            onChange={e => setPreset(e.target.value as SeasonalityPreset)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-300"
          >
            {presetOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      )}
      {variation && (
        <button
          onClick={handleConfirm}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          Confirm Seasonality
        </button>
      )}
    </div>
  );
}

/* ── ConfirmSeasonalityCard ── */
interface ConfirmSeasonalityCardProps {
  profile: SeasonalityProfile;
  onConfirm: () => void;
  onEdit: () => void;
}
function ConfirmSeasonalityCard({ profile, onConfirm, onEdit }: ConfirmSeasonalityCardProps) {
  const presetLabel = SEASONALITY_PRESETS[profile.preset]?.label ?? profile.preset;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 border-l-4 border-l-red-400">
      <h3 className="font-semibold text-slate-800 mb-4">Seasonality Profile</h3>
      <dl className="grid grid-cols-2 gap-y-2 text-sm mb-5">
        <dt className="text-slate-500">Variation</dt>
        <dd className="text-slate-800 font-medium capitalize">{profile.variation}</dd>
        <dt className="text-slate-500">Pattern</dt>
        <dd className="text-slate-800 font-medium">{presetLabel}</dd>
      </dl>
      <div className="flex gap-3">
        <button onClick={onConfirm} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors">Confirm</button>
        <button onClick={onEdit} className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">Edit</button>
      </div>
    </div>
  );
}

/* ── StreamSummaryCard ── */
interface StreamSummaryCardProps {
  stream: WorkingStream;
  onConfirm: () => void;
  onEdit: () => void;
}
function StreamSummaryCard({ stream, onConfirm, onEdit }: StreamSummaryCardProps) {
  const monthlyRevenue = stream.items.reduce((sum, it) => sum + it.volume * it.price, 0);
  const seasonPreset = stream.seasonality ? SEASONALITY_PRESETS[stream.seasonality.preset]?.label : "None";
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 border-l-4 border-l-emerald-400">
      <div className="flex items-center gap-2 mb-4">
        <span>✓</span>
        <h3 className="font-semibold text-slate-800">Stream Complete: {stream.name}</h3>
      </div>
      <dl className="grid grid-cols-2 gap-y-2 text-sm mb-5">
        <dt className="text-slate-500">Items</dt>
        <dd className="text-slate-800 font-medium">{stream.items.length}</dd>
        <dt className="text-slate-500">Monthly Revenue</dt>
        <dd className="text-slate-800 font-medium">${monthlyRevenue.toLocaleString()}</dd>
        <dt className="text-slate-500">Growth</dt>
        <dd className="text-slate-800 font-medium capitalize">{stream.growth?.trend ?? "—"}</dd>
        <dt className="text-slate-500">Seasonality</dt>
        <dd className="text-slate-800 font-medium">{seasonPreset}</dd>
      </dl>
      <div className="flex gap-3">
        <button onClick={onConfirm} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors">Confirm Stream</button>
        <button onClick={onEdit} className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">Edit</button>
      </div>
    </div>
  );
}

/* ── ConfirmModelCard ── */
interface ConfirmModelCardProps {
  streams: WorkingStream[];
  onConfirm: () => void;
  onEdit: () => void;
}
function ConfirmModelCard({ streams, onConfirm, onEdit }: ConfirmModelCardProps) {
  const totalRevenue = streams.reduce(
    (sum, s) => sum + s.items.reduce((ss, it) => ss + it.volume * it.price, 0), 0
  );
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 border-l-4 border-l-blue-400">
      <div className="flex items-center gap-2 mb-4">
        <span>🔴</span>
        <h3 className="font-semibold text-slate-800">Revenue Model Ready</h3>
      </div>
      <div className="overflow-x-auto mb-5">
        <table className="w-full text-xs text-slate-600">
          <thead>
            <tr className="border-b border-slate-100">
              {["Stream","Items","Monthly Revenue"].map(h => (
                <th key={h} className="text-left py-1.5 px-2 font-medium text-slate-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {streams.map(s => {
              const rev = s.items.reduce((sum, it) => sum + it.volume * it.price, 0);
              return (
                <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-1.5 px-2 font-medium">{s.name}</td>
                  <td className="py-1.5 px-2">{s.items.length}</td>
                  <td className="py-1.5 px-2">${rev.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200">
              <td className="py-2 px-2 font-semibold text-slate-700" colSpan={2}>Total Monthly Revenue</td>
              <td className="py-2 px-2 font-semibold text-slate-800">${totalRevenue.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex gap-3">
        <button onClick={onConfirm} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors">
          Confirm &amp; View Forecast
        </button>
        <button onClick={onEdit} className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">Edit Model</button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────── progress panel ── */
interface ProgressPanelProps { streams: WorkingStream[]; }
function ProgressPanel({ streams }: ProgressPanelProps) {
  const completed = streams.filter(s => s.status === "completed").length;
  const pct = streams.length > 0 ? Math.round((completed / streams.length) * 100) : 0;
  return (
    <div className="w-56 flex-shrink-0">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sticky top-4">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">Revenue Streams</h4>
        <ul className="space-y-3 mb-5">
          {streams.length === 0 && (
            <li className="text-xs text-slate-400 italic">Detecting streams…</li>
          )}
          {streams.map(s => (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              <span className={
                s.status === "completed" ? "text-emerald-600 font-bold" :
                s.status === "in_progress" ? "text-cyan-600" :
                "text-slate-300"
              }>
                {s.status === "completed" ? "✓" : s.status === "in_progress" ? "⏳" : "○"}
              </span>
              <span className={`truncate ${
                s.status === "completed" ? "text-slate-600" :
                s.status === "in_progress" ? "text-slate-800 font-medium" :
                "text-slate-400"
              }`}>
                {s.name}
              </span>
            </li>
          ))}
        </ul>
        {streams.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-500">Progress</span>
              <span className="text-xs font-medium text-slate-700">{pct}%</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-1.5">
              <div
                className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────── feed renderer ── */
interface FeedRendererProps {
  feed: FeedItem[];
  onCardAction: (id: number, action: string, payload?: unknown) => void;
}
function FeedRenderer({ feed, onCardAction }: FeedRendererProps) {
  return (
    <>
      {feed.map(item => {
        if (item.kind === "ai") {
          return (
            <div key={item.id} className="flex justify-start">
              <div className="max-w-[85%] bg-slate-50 rounded-2xl px-4 py-3 text-sm text-slate-700 leading-relaxed">
                {item.text}
              </div>
            </div>
          );
        }
        if (item.kind === "user") {
          return (
            <div key={item.id} className="flex justify-end">
              <div className="max-w-[75%] bg-cyan-600 text-white rounded-2xl px-4 py-3 text-sm leading-relaxed">
                {item.text}
              </div>
            </div>
          );
        }
        if (item.kind === "typing") {
          return (
            <div key={item.id} className="flex justify-start">
              <TypingDots />
            </div>
          );
        }
        if (item.kind === "divider") {
          const colors: Record<typeof item.color, string> = {
            slate:   "bg-slate-100 text-slate-600 border-slate-200",
            cyan:    "bg-cyan-50 text-cyan-700 border-cyan-200",
            emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
            violet:  "bg-violet-50 text-violet-700 border-violet-200",
          };
          return (
            <div key={item.id} className={`flex items-center gap-3 px-4 py-2 rounded-xl border text-xs font-semibold uppercase tracking-wide ${colors[item.color]}`}>
              <span className="flex-1 h-px bg-current opacity-20" />
              {item.text}
              <span className="flex-1 h-px bg-current opacity-20" />
            </div>
          );
        }
        if (item.kind === "card") {
          if (item.resolved) {
            return (
              <div key={item.id} className="flex justify-start">
                <ResolvedChip label={item.resolvedLabel ?? "Confirmed"} />
              </div>
            );
          }
          const { card } = item;
          if (card.type === "confirm_streams") {
            return (
              <div key={item.id} className="max-w-[90%]">
                <ConfirmStreamsCard
                  streams={card.streams}
                  onConfirm={s => onCardAction(item.id, "confirm_streams", s)}
                  onEdit={() => onCardAction(item.id, "edit_streams")}
                />
              </div>
            );
          }
          if (card.type === "complexity") {
            return (
              <div key={item.id} className="max-w-[90%]">
                <ComplexityCard onSelect={choice => onCardAction(item.id, "complexity", choice)} />
              </div>
            );
          }
          if (card.type === "paste_data") {
            return (
              <div key={item.id} className="max-w-[90%]">
                <PasteDataCard
                  streamName={card.streamName}
                  onExtract={text => onCardAction(item.id, "paste_extract", text)}
                />
              </div>
            );
          }
          if (card.type === "confirm_items") {
            return (
              <div key={item.id} className="max-w-[90%]">
                <ConfirmItemsCard
                  items={card.items}
                  onConfirm={() => onCardAction(item.id, "confirm_items")}
                  onEdit={() => onCardAction(item.id, "edit_items")}
                />
              </div>
            );
          }
          if (card.type === "growth") {
            return (
              <div key={item.id} className="max-w-[90%]">
                <GrowthCard onConfirm={profile => onCardAction(item.id, "confirm_growth_profile", profile)} />
              </div>
            );
          }
          if (card.type === "confirm_growth") {
            return (
              <div key={item.id} className="max-w-[90%]">
                <ConfirmGrowthCard
                  profile={card.profile}
                  onConfirm={() => onCardAction(item.id, "confirm_growth")}
                  onAdjust={() => onCardAction(item.id, "adjust_growth")}
                />
              </div>
            );
          }
          if (card.type === "seasonality") {
            return (
              <div key={item.id} className="max-w-[90%]">
                <SeasonalityCard
                  streamType={card.streamType}
                  onConfirm={profile => onCardAction(item.id, "confirm_seasonality_profile", profile)}
                />
              </div>
            );
          }
          if (card.type === "confirm_seasonality") {
            return (
              <div key={item.id} className="max-w-[90%]">
                <ConfirmSeasonalityCard
                  profile={card.profile}
                  onConfirm={() => onCardAction(item.id, "confirm_seasonality")}
                  onEdit={() => onCardAction(item.id, "edit_seasonality")}
                />
              </div>
            );
          }
          if (card.type === "stream_summary") {
            return (
              <div key={item.id} className="max-w-[90%]">
                <StreamSummaryCard
                  stream={card.stream}
                  onConfirm={() => onCardAction(item.id, "confirm_stream_summary")}
                  onEdit={() => onCardAction(item.id, "edit_stream_summary")}
                />
              </div>
            );
          }
          if (card.type === "confirm_model") {
            return (
              <div key={item.id} className="max-w-[90%]">
                <ConfirmModelCard
                  streams={card.streams}
                  onConfirm={() => onCardAction(item.id, "confirm_model")}
                  onEdit={() => onCardAction(item.id, "edit_model")}
                />
              </div>
            );
          }
        }
        return null;
      })}
    </>
  );
}

/* ─────────────────────────────────── main engine ── */

export function RevenueEngine({
  situation,
  appId,
  userId,
  onStreamsDetected,
  onItemsSaved,
  onForecastYears,
  onForecastStart,
  onComplete,
}: RevenueEngineProps) {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [streams, setStreams] = useState<WorkingStream[]>([]);
  const [inputVal, setInputVal] = useState("");
  const [inputLocked, setInputLocked] = useState(false);

  /* refs to avoid stale closures */
  const phaseRef     = useRef<EnginePhase>("detecting");
  const streamsRef   = useRef<WorkingStream[]>([]);
  const intakeMsgsRef  = useRef<ChatMsg[]>([]);
  const driverMsgsRef  = useRef<ChatMsg[]>([]);
  const intakeCtxRef   = useRef<string>("");
  /* pending item buffer for current stream */
  const pendingItemsRef = useRef<ParsedItem[]>([]);
  /* pending growth buffer */
  const pendingGrowthRef = useRef<GrowthProfile | null>(null);
  /* pending seasonality buffer */
  const pendingSeasonalityRef = useRef<SeasonalityProfile | null>(null);

  const feedEndRef = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);
  const sb = createClient();

  /* ── helpers ── */
  const addFeedItem = useCallback((item: FeedItemInput) => {
    const id = uid();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setFeed(prev => [...prev, { ...item, id } as any]);
    return id;
  }, []);

  const resolveCard = useCallback((id: number, label: string) => {
    setFeed(prev => prev.map(item =>
      item.id === id && item.kind === "card"
        ? { ...item, resolved: true, resolvedLabel: label }
        : item
    ));
  }, []);

  const removeTyping = useCallback((id: number) => {
    setFeed(prev => prev.filter(item => item.id !== id));
  }, []);

  /* sync streamsRef and notify parent */
  function setStreamsSync(updater: (prev: WorkingStream[]) => WorkingStream[]) {
    setStreams(prev => {
      const next = updater(prev);
      streamsRef.current = next;
      return next;
    });
  }

  /* auto scroll */
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed]);

  /* ── phase helpers ── */
  function currentStreamIdx(): number | null {
    const p = phaseRef.current;
    if (typeof p === "object" && p.kind === "stream") return p.idx;
    return null;
  }

  function currentStreamPhase(): StreamPhase | null {
    const p = phaseRef.current;
    if (typeof p === "object" && p.kind === "stream") return p.phase;
    return null;
  }

  function setPhase(phase: EnginePhase) {
    phaseRef.current = phase;
  }

  /* ── input active check ── */
  function isInputActive(): boolean {
    const p = phaseRef.current;
    if (p === "detecting") return true;
    if (typeof p === "object" && p.kind === "stream" && p.phase === "collect_chat") return true;
    return false;
  }

  /* ── API: intake ── */
  async function callIntake(msgs: ChatMsg[]): Promise<string> {
    const res = await fetch("/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: msgs, situation }),
    });
    if (!res.ok) throw new Error(`Intake API error ${res.status}`);
    const data = await res.json() as { text?: string; error?: string };
    if (data.error) throw new Error(data.error);
    return data.text ?? "";
  }

  /* ── API: drivers ── */
  async function callDrivers(msgs: ChatMsg[], streamIdx: number): Promise<string> {
    const s = streamsRef.current[streamIdx];
    const res = await fetch("/api/drivers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: msgs,
        stream: { name: s.name, type: s.type },
        situation,
        isFirstStream: streamIdx === 0,
        intakeContext: intakeCtxRef.current,
      }),
    });
    if (!res.ok) throw new Error(`Drivers API error ${res.status}`);
    const data = await res.json() as { text?: string; error?: string };
    if (data.error) throw new Error(data.error);
    return data.text ?? "";
  }

  /* ── save streams to DB ── */
  async function dbSaveStreams(detected: DetectedStream[]): Promise<void> {
    if (!appId || !userId) return;
    try {
      const rows = detected.map((d, i) => ({
        name: d.name, type: d.type, confidence: d.confidence,
        monthly_growth_pct: 0, sub_new_per_month: 0, sub_churn_pct: 0,
        rental_occupancy_pct: 0, driver_done: false, position: i,
      }));
      const saved = await saveStreams(sb, appId, userId, rows);
      /* map real UUIDs back */
      setStreamsSync(prev => prev.map((ws, i) => ({
        ...ws,
        id: saved[i]?.id ?? ws.id,
      })));
    } catch (e) {
      console.error("saveStreams error", e);
    }
  }

  /* ── save items to DB ── */
  async function dbSaveItems(streamId: string, items: ParsedItem[]): Promise<void> {
    if (!userId) return;
    try {
      await saveStreamItems(sb, streamId, userId, items.map(it => ({
        name: it.name, category: it.category, volume: it.volume,
        price: it.price, costPrice: it.costPrice, unit: it.unit, note: it.note,
      })));
      onItemsSaved(streamId, items);
    } catch (e) {
      console.error("saveStreamItems error", e);
    }
  }

  /* ── stream phase advancement ── */
  async function advanceStreamPhase(idx: number, phase: StreamPhase) {
    setPhase({ kind: "stream", idx, phase });
    const s = streamsRef.current[idx];

    if (phase === "intro") {
      addFeedItem({ kind: "divider", text: s.name, color: "violet" });
      addFeedItem({ kind: "ai", text: `Let's work on: ${s.name}` });
      /* brief pause then go to complexity */
      await new Promise(r => setTimeout(r, 400));
      advanceStreamPhase(idx, "complexity");
    }

    else if (phase === "complexity") {
      const cardId = addFeedItem({ kind: "card", resolved: false, card: { type: "complexity" } });
      setInputLocked(true);
      /* stored for card action handler — nothing async needed here */
      void cardId;
    }

    else if (phase === "collect_chat") {
      setInputLocked(false);
      setInputVal("");
      addFeedItem({ kind: "ai", text: `For ${s.name}, describe your items — what you sell, monthly volumes, and prices.` });
      driverMsgsRef.current = [];
    }

    else if (phase === "collect_paste") {
      setInputLocked(true);
      const cardId = addFeedItem({
        kind: "card", resolved: false,
        card: { type: "paste_data", streamName: s.name },
      });
      void cardId;
    }

    else if (phase === "confirm_items") {
      setInputLocked(true);
      const items = pendingItemsRef.current;
      addFeedItem({
        kind: "card", resolved: false,
        card: { type: "confirm_items", items },
      });
    }

    else if (phase === "growth") {
      setInputLocked(true);
      addFeedItem({ kind: "card", resolved: false, card: { type: "growth" } });
    }

    else if (phase === "confirm_growth") {
      const profile = pendingGrowthRef.current!;
      addFeedItem({ kind: "card", resolved: false, card: { type: "confirm_growth", profile } });
    }

    else if (phase === "seasonality") {
      addFeedItem({ kind: "card", resolved: false, card: { type: "seasonality", streamType: s.type } });
    }

    else if (phase === "confirm_seasonality") {
      const profile = pendingSeasonalityRef.current!;
      addFeedItem({ kind: "card", resolved: false, card: { type: "confirm_seasonality", profile } });
    }

    else if (phase === "stream_summary") {
      /* update stream with accumulated data */
      const updated = {
        ...s,
        items: pendingItemsRef.current,
        growth: pendingGrowthRef.current,
        seasonality: pendingSeasonalityRef.current,
        status: "completed" as const,
      };
      setStreamsSync(prev => prev.map((ws, i) => i === idx ? updated : ws));
      addFeedItem({
        kind: "card", resolved: false,
        card: { type: "stream_summary", stream: updated },
      });
    }
  }

  /* ── card action handler ── */
  const handleCardAction = useCallback(async (
    cardId: number,
    action: string,
    payload?: unknown,
  ) => {
    const idx = currentStreamIdx();
    const streamPhase = currentStreamPhase();

    /* ── confirm_streams ── */
    if (action === "confirm_streams") {
      const detected = payload as DetectedStream[];
      resolveCard(cardId, `${detected.length} streams confirmed`);
      const ws: WorkingStream[] = detected.map((d, i) => ({
        id: `local-${i}-${Date.now()}`,
        name: d.name, type: d.type, confidence: d.confidence,
        items: [], growth: null, seasonality: null, status: "pending",
      }));
      setStreamsSync(() => ws);
      onStreamsDetected(ws);
      await dbSaveStreams(detected);
      /* save intake conversation */
      if (appId && userId) {
        saveIntakeConversation(sb, appId, userId, intakeMsgsRef.current, null, true).catch(console.error);
        updateApplicationFlags(sb, appId, { intake_done: true }).catch(console.error);
      }
      /* start first stream */
      setPhase({ kind: "stream", idx: 0, phase: "intro" });
      setStreamsSync(prev => prev.map((s, i) => i === 0 ? { ...s, status: "in_progress" } : s));
      await advanceStreamPhase(0, "intro");
      return;
    }

    if (action === "edit_streams") {
      resolveCard(cardId, "Editing…");
      addFeedItem({ kind: "ai", text: "Sure — which streams would you like to add, remove, or rename? Just tell me." });
      setPhase("detecting");
      setInputLocked(false);
      return;
    }

    /* ── complexity ── */
    if (action === "complexity") {
      const choice = payload as "under20" | "20to100" | "more100";
      const label = choice === "under20" ? "Under 20" : choice === "20to100" ? "20–100" : "More than 100";
      resolveCard(cardId, label);
      if (choice === "under20") {
        await advanceStreamPhase(idx!, "collect_chat");
      } else {
        await advanceStreamPhase(idx!, "collect_paste");
      }
      return;
    }

    /* ── paste_extract ── */
    if (action === "paste_extract" && idx !== null) {
      const pastedText = payload as string;
      resolveCard(cardId, "Data pasted");
      addFeedItem({ kind: "user", text: pastedText.substring(0, 80) + (pastedText.length > 80 ? "…" : "") });
      const typingId = addFeedItem({ kind: "typing" });
      setInputLocked(true);
      try {
        const msgs: ChatMsg[] = [
          ...driverMsgsRef.current,
          { role: "user", content: pastedText },
        ];
        driverMsgsRef.current = msgs;
        const reply = await callDrivers(msgs, idx);
        removeTyping(typingId);
        driverMsgsRef.current = [...msgs, { role: "assistant", content: reply }];
        const pasteCleanIdx = reply.indexOf("[ITEMS_DETECTED]");
        const pasteClean = (pasteCleanIdx !== -1 ? reply.slice(0, pasteCleanIdx) : reply).trim();
        if (pasteClean) addFeedItem({ kind: "ai", text: pasteClean });

        const items = parseItems(reply);
        if (items && items.length > 0) {
          pendingItemsRef.current = items;
          await advanceStreamPhase(idx, "confirm_items");
        } else {
          addFeedItem({ kind: "ai", text: "I couldn't detect items from that data. Please try again or rephrase." });
          await advanceStreamPhase(idx, "collect_paste");
        }
      } catch (e) {
        removeTyping(typingId);
        console.error(e);
        addFeedItem({ kind: "ai", text: "Something went wrong extracting your data. Please try again." });
      }
      return;
    }

    /* ── confirm_items ── */
    if (action === "confirm_items" && idx !== null) {
      const items = pendingItemsRef.current;
      const s = streamsRef.current[idx];
      resolveCard(cardId, `${items.length} items confirmed`);
      await dbSaveItems(s.id, items);
      if (appId && userId) {
        saveDriverConversation(sb, appId, userId, s.id, driverMsgsRef.current, null, false).catch(console.error);
      }
      await advanceStreamPhase(idx, "growth");
      return;
    }

    if (action === "edit_items" && idx !== null) {
      resolveCard(cardId, "Editing…");
      pendingItemsRef.current = [];
      await advanceStreamPhase(idx, "collect_chat");
      return;
    }

    /* ── growth profile selected from GrowthCard ── */
    if (action === "confirm_growth_profile") {
      const profile = payload as GrowthProfile;
      pendingGrowthRef.current = profile;
      resolveCard(cardId, profile.trend);
      await advanceStreamPhase(idx!, "confirm_growth");
      return;
    }

    /* ── confirm_growth (ConfirmGrowthCard confirmed) ── */
    if (action === "confirm_growth") {
      resolveCard(cardId, "Growth confirmed");
      await advanceStreamPhase(idx!, "seasonality");
      return;
    }

    if (action === "adjust_growth") {
      resolveCard(cardId, "Adjusting…");
      pendingGrowthRef.current = null;
      await advanceStreamPhase(idx!, "growth");
      return;
    }

    /* ── seasonality profile selected from SeasonalityCard ── */
    if (action === "confirm_seasonality_profile") {
      const profile = payload as SeasonalityProfile;
      pendingSeasonalityRef.current = profile;
      resolveCard(cardId, profile.variation);
      await advanceStreamPhase(idx!, "confirm_seasonality");
      return;
    }

    /* ── confirm_seasonality ── */
    if (action === "confirm_seasonality") {
      resolveCard(cardId, "Seasonality confirmed");
      await advanceStreamPhase(idx!, "stream_summary");
      return;
    }

    if (action === "edit_seasonality") {
      resolveCard(cardId, "Editing…");
      pendingSeasonalityRef.current = null;
      await advanceStreamPhase(idx!, "seasonality");
      return;
    }

    /* ── stream_summary confirmed ── */
    if (action === "confirm_stream_summary" && idx !== null) {
      const s = streamsRef.current[idx];
      resolveCard(cardId, `${s.name} done`);
      addFeedItem({ kind: "divider", text: `${s.name} complete`, color: "emerald" });

      const nextIdx = idx + 1;
      if (nextIdx < streamsRef.current.length) {
        /* start next stream */
        setStreamsSync(prev => prev.map((ws, i) => i === nextIdx ? { ...ws, status: "in_progress" } : ws));
        driverMsgsRef.current = [];
        pendingItemsRef.current = [];
        pendingGrowthRef.current = null;
        pendingSeasonalityRef.current = null;
        await advanceStreamPhase(nextIdx, "intro");
      } else {
        /* all streams done → confirm model */
        setPhase("confirm_model");
        setInputLocked(true);
        addFeedItem({ kind: "divider", text: "Finalising revenue model…", color: "cyan" });
        addFeedItem({ kind: "card", resolved: false, card: { type: "confirm_model", streams: streamsRef.current } });
      }
      return;
    }

    if (action === "edit_stream_summary" && idx !== null) {
      resolveCard(cardId, "Editing…");
      addFeedItem({ kind: "ai", text: "Let's revisit this stream. Which part would you like to change?" });
      await advanceStreamPhase(idx, "intro");
      return;
    }

    /* ── confirm_model ── */
    if (action === "confirm_model") {
      resolveCard(cardId, "Model confirmed");
      if (appId && userId) {
        updateApplicationFlags(sb, appId, { drivers_done: true }).catch(console.error);
      }
      setPhase("done");
      onComplete();
      return;
    }

    if (action === "edit_model") {
      resolveCard(cardId, "Editing…");
      addFeedItem({ kind: "ai", text: "Which stream would you like to edit?" });
      /* allow user to specify stream — go back to confirm_streams concept */
      setPhase("confirm_model");
      return;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── send chat message ── */
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || inputLocked) return;
    addFeedItem({ kind: "user", text });
    setInputVal("");
    setInputLocked(true);

    const p = phaseRef.current;

    /* ── detecting phase ── */
    if (p === "detecting") {
      const msgs: ChatMsg[] = [...intakeMsgsRef.current, { role: "user", content: text }];
      intakeMsgsRef.current = msgs;
      const typingId = addFeedItem({ kind: "typing" });
      try {
        const reply = await callIntake(msgs);
        removeTyping(typingId);
        intakeMsgsRef.current = [...msgs, { role: "assistant", content: reply }];
        intakeCtxRef.current = reply;

        const detected = parseStreams(reply);
        const fy = parseForecastYears(reply);
        const fs = parseForecastStart(reply);
        if (fy) onForecastYears(fy);
        if (fs) onForecastStart(fs.year, fs.month);

        const tagIdx = reply.indexOf("[STREAMS_DETECTED]");
        const clean = (tagIdx !== -1 ? reply.slice(0, tagIdx) : reply).trim();
        if (clean) addFeedItem({ kind: "ai", text: clean });

        if (detected && detected.length > 0) {
          addFeedItem({
            kind: "card", resolved: false,
            card: { type: "confirm_streams", streams: detected },
          });
          setInputLocked(true);
        } else {
          setInputLocked(false);
        }
      } catch (e) {
        removeTyping(typingId);
        console.error(e);
        addFeedItem({ kind: "ai", text: "I had trouble processing that. Could you try again?" });
        setInputLocked(false);
      }
      return;
    }

    /* ── collect_chat phase ── */
    if (typeof p === "object" && p.kind === "stream" && p.phase === "collect_chat") {
      const idx = p.idx;
      const msgs: ChatMsg[] = [...driverMsgsRef.current, { role: "user", content: text }];
      driverMsgsRef.current = msgs;
      const typingId = addFeedItem({ kind: "typing" });
      try {
        const reply = await callDrivers(msgs, idx);
        removeTyping(typingId);
        driverMsgsRef.current = [...msgs, { role: "assistant", content: reply }];

        const fy = parseForecastYears(reply);
        const fs = parseForecastStart(reply);
        if (fy) onForecastYears(fy);
        if (fs) onForecastStart(fs.year, fs.month);

        const chatCleanIdx = reply.indexOf("[ITEMS_DETECTED]");
        const chatClean = (chatCleanIdx !== -1 ? reply.slice(0, chatCleanIdx) : reply).trim();
        if (chatClean) addFeedItem({ kind: "ai", text: chatClean });

        const items = parseItems(reply);
        if (items && items.length > 0) {
          pendingItemsRef.current = items;
          await advanceStreamPhase(idx, "confirm_items");
        } else {
          setInputLocked(false);
        }
      } catch (e) {
        removeTyping(typingId);
        console.error(e);
        addFeedItem({ kind: "ai", text: "Something went wrong. Please try again." });
        setInputLocked(false);
      }
      return;
    }

    setInputLocked(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputLocked]);

  /* ── start intake on mount ── */
  async function startIntake() {
    setPhase("detecting");
    setInputLocked(true);
    const typingId = addFeedItem({ kind: "typing" });
    try {
      // Send empty messages — the API uses the situation context to generate the correct opening
      const reply = await callIntake([]);
      removeTyping(typingId);
      intakeMsgsRef.current = [{ role: "assistant", content: reply }];
      intakeCtxRef.current = reply;
      const streams = parseStreams(reply);
      if (streams && streams.length > 0) {
        // Rare: AI detected streams immediately
        const clean = reply.slice(0, reply.indexOf("[STREAMS_DETECTED]")).trim();
        if (clean) addFeedItem({ kind: "ai", text: clean });
        addFeedItem({ kind: "card", resolved: false, card: { type: "confirm_streams", streams } });
        setInputLocked(true);
      } else {
        addFeedItem({ kind: "ai", text: reply });
        setInputLocked(false);
      }
    } catch (e) {
      removeTyping(typingId);
      console.error("[RevenueEngine] startIntake:", e);
      addFeedItem({ kind: "ai", text: "Welcome! Tell me about your business and how it generates revenue." });
      setInputLocked(false);
    }
  }

  useEffect(() => {
    startIntake();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── key handler ── */
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputVal);
    }
  }

  const active = isInputActive() && !inputLocked;

  /* ── render ── */
  return (
    <div className="flex gap-6 h-full">
      {/* left: feed */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* feed scroll area */}
        <div
          className="flex-1 overflow-y-auto space-y-3 pb-4 pr-1"
          style={{ height: "calc(100vh - 280px)" }}
        >
          <FeedRenderer feed={feed} onCardAction={handleCardAction} />
          <div ref={feedEndRef} />
        </div>

        {/* input */}
        <div className={`mt-4 flex gap-2 transition-opacity ${active ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
          <input
            ref={inputRef}
            type="text"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your answer..."
            disabled={!active}
            className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-300 bg-white"
          />
          <button
            onClick={() => sendMessage(inputVal)}
            disabled={!active || !inputVal.trim()}
            className="px-4 py-2.5 bg-cyan-600 text-white rounded-xl text-sm font-medium hover:bg-cyan-700 transition-colors disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>

      {/* right: progress panel */}
      <ProgressPanel streams={streams} />
    </div>
  );
}
