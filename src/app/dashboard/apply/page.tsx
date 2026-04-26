"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Plus, Trash2, Edit3, Check, X,
  BrainCircuit, BarChart3, TrendingUp, ShoppingBag, Briefcase,
  Repeat, Landmark, Zap, CheckCircle2, RefreshCw, Send,
  ChevronDown, ChevronUp, Info, ClipboardList, Upload, Pencil,
  Calendar, ChevronRight,
} from "lucide-react";

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

/* ─────────────────────────── types ── */
type StreamType = "product" | "service" | "subscription" | "rental" | "marketplace" | "custom";
type Confidence  = "high" | "medium" | "low";
type Provider    = "openai" | "gemini";
type DriverMode  = "chat" | "import" | "manual";

interface ChatMessage  { role: "user" | "assistant"; content: string; }
interface StreamItem   { id: string; name: string; category: string; volume: number; price: number; unit: string; note?: string; }
interface RevenueStream {
  id: string; name: string; type: StreamType; confidence: Confidence;
  items: StreamItem[];
  monthlyGrowthPct: number;
  driverMessages: ChatMessage[];
  driverDone: boolean;
}

/* ─────────────────────────── stream metadata ── */
const STREAM_META: Record<StreamType, {
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string; bg: string;
}> = {
  product:      { label: "Product Sales",            icon: ShoppingBag, color: "#0e7490", bg: "#f0f9ff" },
  service:      { label: "Service / Project",        icon: Briefcase,   color: "#7c3aed", bg: "#faf5ff" },
  subscription: { label: "Subscription / MRR",       icon: Repeat,      color: "#059669", bg: "#f0fdf4" },
  rental:       { label: "Rental / Lease",            icon: Landmark,    color: "#b45309", bg: "#fffbeb" },
  marketplace:  { label: "Marketplace / Commission", icon: TrendingUp,  color: "#e11d48", bg: "#fff1f2" },
  custom:       { label: "Custom Stream",             icon: Zap,         color: "#6366f1", bg: "#eef2ff" },
};

const CONF_STYLE: Record<Confidence, string> = {
  high:   "bg-emerald-50 text-emerald-700 border-emerald-100",
  medium: "bg-amber-50   text-amber-700   border-amber-100",
  low:    "bg-red-50     text-red-600     border-red-100",
};

/* ─────────────────────────── helpers ── */
let _id = 0;
const uid = () => `i${++_id}`;

function makeStream(name: string, type: StreamType, confidence: Confidence): RevenueStream {
  return { id: uid(), name, type, confidence, items: [], monthlyGrowthPct: 2, driverMessages: [], driverDone: false };
}

function streamMRR(s: RevenueStream): number {
  return s.items.reduce((sum, it) => sum + it.volume * it.price, 0);
}

interface ProjMonth {
  index: number; year: number; monthLabel: string; yearMonth: string; total: number;
  byStream: { name: string; rev: number; byCategory: Record<string, { rev: number; items: { name: string; rev: number }[] }> }[];
}

function projectRevenue(streams: RevenueStream[], totalMonths: number, startDate: Date): ProjMonth[] {
  return Array.from({ length: totalMonths }, (_, i) => {
    const d = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
    const byStream = streams.map((s) => {
      const factor = Math.pow(1 + s.monthlyGrowthPct / 100, i);
      const byCategory: Record<string, { rev: number; items: { name: string; rev: number }[] }> = {};
      s.items.forEach((it) => {
        const rev = Math.round(it.volume * it.price * factor);
        const cat = it.category || "Other";
        if (!byCategory[cat]) byCategory[cat] = { rev: 0, items: [] };
        byCategory[cat].rev += rev;
        byCategory[cat].items.push({ name: it.name, rev });
      });
      return { name: s.name, rev: Object.values(byCategory).reduce((a, b) => a + b.rev, 0), byCategory };
    });
    return {
      index: i, year: d.getFullYear(),
      monthLabel: d.toLocaleDateString("en-US", { month: "short" }),
      yearMonth:  d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      total: byStream.reduce((a, b) => a + b.rev, 0), byStream,
    };
  });
}

function groupByYear(months: ProjMonth[]) {
  const map = new Map<number, ProjMonth[]>();
  months.forEach((m) => { if (!map.has(m.year)) map.set(m.year, []); map.get(m.year)!.push(m); });
  return Array.from(map.entries()).map(([year, ms]) => ({
    year, months: ms, total: ms.reduce((a, b) => a + b.total, 0),
  }));
}

const HORIZONS = [
  { label: "1 yr",   years: 1  },
  { label: "3 yrs",  years: 3  },
  { label: "5 yrs",  years: 5  },
  { label: "10 yrs", years: 10 },
  { label: "30 yrs", years: 30 },
];

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n/1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

function parseItems(text: string): StreamItem[] | null {
  const idx = text.indexOf("[ITEMS_DETECTED]");
  if (idx === -1) return null;
  try {
    const arr = JSON.parse(text.slice(idx + "[ITEMS_DETECTED]".length).trim()) as
      { name: string; category?: string; volume?: number; price?: number; unit?: string; note?: string }[];
    return arr.map((a) => ({ id: uid(), name: a.name, category: a.category ?? "General", volume: a.volume ?? 0, price: a.price ?? 0, unit: a.unit ?? "unit", note: a.note }));
  } catch { return null; }
}

function parseStreams(text: string): RevenueStream[] | null {
  const idx = text.indexOf("[STREAMS_DETECTED]");
  if (idx === -1) return null;
  try {
    const arr = JSON.parse(text.slice(idx + "[STREAMS_DETECTED]".length).trim()) as
      { name: string; type: StreamType; confidence: Confidence }[];
    return arr.map((s) => makeStream(s.name, s.type ?? "custom", s.confidence ?? "medium"));
  } catch { return null; }
}

/* ─────────────────────────── EditableName ── */
function EditableName({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const commit = () => { onChange(draft); setEditing(false); };
  return editing ? (
    <div className="flex items-center gap-1">
      <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key==="Enter") commit(); if (e.key==="Escape") setEditing(false); }}
        className="text-sm font-semibold border-b border-cyan-500 outline-none bg-transparent text-slate-800 w-48" />
      <button onClick={commit}><Check className="w-3.5 h-3.5 text-emerald-500" /></button>
      <button onClick={() => setEditing(false)}><X className="w-3.5 h-3.5 text-slate-400" /></button>
    </div>
  ) : (
    <div className="flex items-center gap-1.5 group cursor-pointer" onClick={() => { setDraft(value); setEditing(true); }}>
      <span className="text-sm font-semibold text-slate-800">{value}</span>
      <Edit3 className="w-3 h-3 text-slate-300 group-hover:text-slate-500 transition-colors" />
    </div>
  );
}

/* ─────────────────────────── ItemRow (inline-editable) ── */
function ItemRow({ item, onChange, onDelete }: { item: StreamItem; onChange: (i: StreamItem) => void; onDelete: () => void }) {
  const upN = (k: keyof StreamItem, v: string | number) => onChange({ ...item, [k]: v });
  return (
    <tr className="group border-t border-slate-100 hover:bg-slate-50 transition-colors">
      <td className="px-3 py-2">
        <input value={item.name} onChange={(e) => upN("name", e.target.value)}
          className="w-full text-xs text-slate-800 bg-transparent border-b border-transparent group-hover:border-slate-200 focus:border-cyan-400 outline-none" />
      </td>
      <td className="px-3 py-2">
        <input value={item.category} onChange={(e) => upN("category", e.target.value)}
          className="w-full text-xs text-slate-500 bg-transparent border-b border-transparent group-hover:border-slate-200 focus:border-cyan-400 outline-none" />
      </td>
      <td className="px-3 py-2">
        <input type="number" value={item.volume || ""} placeholder="0" onChange={(e) => upN("volume", Number(e.target.value))}
          className="w-20 text-xs text-right text-slate-700 bg-transparent border-b border-transparent group-hover:border-slate-200 focus:border-cyan-400 outline-none" />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-0.5">
          <span className="text-xs text-slate-400">$</span>
          <input type="number" value={item.price || ""} placeholder="0" onChange={(e) => upN("price", Number(e.target.value))}
            className="w-20 text-xs text-right text-slate-700 bg-transparent border-b border-transparent group-hover:border-slate-200 focus:border-cyan-400 outline-none" />
        </div>
      </td>
      <td className="px-3 py-2 text-right">
        <span className="text-xs font-semibold" style={{ color: "#0e7490" }}>{fmt(item.volume * item.price)}</span>
      </td>
      <td className="px-2 py-2 text-right opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onDelete} className="text-slate-300 hover:text-red-400 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </td>
    </tr>
  );
}

/* ─────────────────────────── ItemTable ── */
function ItemTable({ stream, onUpdate }: { stream: RevenueStream; onUpdate: (s: RevenueStream) => void }) {
  const addItem = () => {
    const item: StreamItem = { id: uid(), name: "New item", category: "General", volume: 0, price: 0, unit: "unit" };
    onUpdate({ ...stream, items: [...stream.items, item] });
  };
  const updateItem = (updated: StreamItem) =>
    onUpdate({ ...stream, items: stream.items.map((i) => i.id === updated.id ? updated : i) });
  const deleteItem = (id: string) =>
    onUpdate({ ...stream, items: stream.items.filter((i) => i.id !== id) });

  const total = streamMRR(stream);
  const cats  = [...new Set(stream.items.map((i) => i.category))];

  return (
    <div className="space-y-3">
      {/* Growth slider */}
      <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
        <span className="text-xs font-medium text-slate-500 flex-shrink-0">Monthly growth</span>
        <input type="range" min={0} max={20} step={0.5} value={stream.monthlyGrowthPct}
          onChange={(e) => onUpdate({ ...stream, monthlyGrowthPct: Number(e.target.value) })}
          className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer" style={{ accentColor: "#0e7490" }} />
        <span className="text-xs font-bold w-10 text-right flex-shrink-0" style={{ color: "#0e7490" }}>+{stream.monthlyGrowthPct}%</span>
      </div>

      {/* Table */}
      {stream.items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 text-left">
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500">Item</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500">Category</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-right">Vol/mo</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-right">Price</th>
                <th className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-right">Monthly Rev</th>
                <th className="px-2 py-2.5 w-6" />
              </tr>
            </thead>
            <tbody>
              {cats.map((cat) => {
                const catItems = stream.items.filter((i) => i.category === cat);
                const catRev   = catItems.reduce((a, i) => a + i.volume * i.price, 0);
                return (
                  <>
                    <tr key={`cat-${cat}`} className="bg-slate-50/60">
                      <td colSpan={4} className="px-3 py-1.5">
                        <span className="text-xs font-bold text-slate-600">{cat}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <span className="text-xs font-bold text-slate-600">{fmt(catRev)}</span>
                      </td>
                      <td />
                    </tr>
                    {catItems.map((item) => (
                      <ItemRow key={item.id} item={item} onChange={updateItem} onDelete={() => deleteItem(item.id)} />
                    ))}
                  </>
                );
              })}
              <tr className="bg-slate-50 border-t-2 border-slate-200">
                <td colSpan={4} className="px-3 py-2.5 text-xs font-bold text-slate-700">Stream Total</td>
                <td className="px-3 py-2.5 text-right text-sm font-bold" style={{ color: "#0e7490" }}>{fmt(total)}/mo</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <button onClick={addItem}
        className="flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-cyan-600 transition-colors">
        <Plus className="w-3.5 h-3.5" /> Add item manually
      </button>
    </div>
  );
}

/* ─────────────────────────── DriverChat ── */
function DriverChat({ stream, onUpdate }: { stream: RevenueStream; onUpdate: (s: RevenueStream) => void }) {
  const [input,    setInput]    = useState("");
  const [typing,   setTyping]   = useState(false);
  const [error,    setError]    = useState("");
  const [provider, setProvider] = useState<Provider | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [stream.driverMessages, typing]);

  useEffect(() => {
    if (stream.driverMessages.length === 0 && !typing) callDriver([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const callDriver = async (history: ChatMessage[]) => {
    setTyping(true); setError("");
    try {
      const res  = await fetch("/api/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, stream: { name: stream.name, type: stream.type } }),
      });
      const data = await res.json() as { text?: string; provider?: Provider; error?: string };
      if (data.error) throw new Error(data.error);
      setProvider(data.provider ?? null);
      const text = data.text ?? "";

      const items = parseItems(text);
      if (items) {
        const cleanText = text.slice(0, text.indexOf("[ITEMS_DETECTED]")).trim() ||
          "I've collected all the item data for this stream. Review the table below.";
        const newMsgs = [...history, { role: "assistant" as const, content: cleanText }];
        onUpdate({ ...stream, driverMessages: newMsgs, items: [...stream.items, ...items], driverDone: true });
      } else {
        onUpdate({ ...stream, driverMessages: [...history, { role: "assistant" as const, content: text }] });
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setTyping(false); }
  };

  const send = () => {
    const text = input.trim();
    if (!text || typing) return;
    const updated = [...stream.driverMessages, { role: "user" as const, content: text }];
    onUpdate({ ...stream, driverMessages: updated });
    setInput("");
    callDriver(updated);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Chat window */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-3 overflow-y-auto" style={{ maxHeight: 280 }}>
        {stream.driverMessages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && (
              <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 mr-2 mt-0.5"
                style={{ background: "linear-gradient(135deg,#042f3d,#0e7490)" }}>
                <BrainCircuit className="w-3 h-3 text-white" />
              </div>
            )}
            <div className={`max-w-[85%] px-3 py-2 rounded-xl text-sm leading-relaxed ${
              m.role === "user"
                ? "text-white rounded-tr-sm"
                : "bg-slate-50 border border-slate-100 text-slate-800 rounded-tl-sm"
            }`} style={m.role === "user" ? { background: "linear-gradient(135deg,#0e7490,#0891b2)" } : {}}>
              {m.content}
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg,#042f3d,#0e7490)" }}>
              <BrainCircuit className="w-3 h-3 text-white" />
            </div>
            <div className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
              <div className="flex gap-1">
                {[0,1,2].map((i) => (
                  <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-slate-300"
                    animate={{ y: [0,-3,0] }} transition={{ duration:0.5, repeat:Infinity, delay:i*0.12 }} />
                ))}
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2 flex items-center gap-2">
            <span>⚠ {error}</span>
            <button onClick={() => callDriver(stream.driverMessages)} className="ml-auto font-semibold underline">Retry</button>
          </div>
        )}
        {provider && !typing && (
          <p className="text-xs text-slate-300 text-center">via {provider}</p>
        )}
        <div ref={endRef} />
      </div>
      {/* Input */}
      {!stream.driverDone && (
        <div className="flex items-end gap-2">
          <textarea rows={2} value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key==="Enter"&&!e.shiftKey) { e.preventDefault(); send(); } }}
            disabled={typing}
            placeholder="Answer the AI's question… (Enter to send)"
            className="flex-1 resize-none px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-white focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all placeholder:text-slate-300 disabled:opacity-60" />
          <motion.button whileTap={{ scale:0.95 }} onClick={send} disabled={!input.trim()||typing}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white disabled:opacity-40"
            style={{ background:"linear-gradient(135deg,#0e7490,#0891b2)" }}>
            <Send className="w-4 h-4" />
          </motion.button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── ImportPane ── */
function ImportPane({ stream, onUpdate }: { stream: RevenueStream; onUpdate: (s: RevenueStream) => void }) {
  const [raw,      setRaw]      = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");

  const processImport = async () => {
    if (!raw.trim()) return;
    setLoading(true); setError("");
    const prompt = `Here is my raw product/price/sales data for the "${stream.name}" stream. Please extract items from it:\n\n${raw}`;
    const msgs: ChatMessage[] = [{ role: "user", content: prompt }];
    try {
      const res  = await fetch("/api/drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs, stream: { name: stream.name, type: stream.type } }),
      });
      const data = await res.json() as { text?: string; error?: string };
      if (data.error) throw new Error(data.error);
      const text  = data.text ?? "";
      const items = parseItems(text);
      if (items) {
        onUpdate({ ...stream, items: [...stream.items, ...items], driverDone: true, driverMessages: msgs });
      } else {
        setError("AI could not detect items. Try formatting your data more clearly.");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-3">
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
        <p className="text-xs font-semibold text-blue-700 mb-1">Paste any of these:</p>
        <div className="flex flex-wrap gap-1.5">
          {["Product list CSV","Price list","Invoice lines","POS export","Excel rows","M-Pesa statement","WhatsApp orders"].map((t) => (
            <span key={t} className="text-xs bg-white border border-blue-100 text-blue-600 px-2 py-0.5 rounded-full">{t}</span>
          ))}
        </div>
      </div>
      <textarea rows={6} value={raw} onChange={(e) => setRaw(e.target.value)}
        placeholder={`Paste raw data here. Examples:\n\nInterior Wall Paint, 50 cans/month, $25 each\nPrimer, 20 units, $15\nBrush set, 80/month, $6\n\nOr paste CSV rows, invoice lines, product lists…`}
        className="w-full resize-none px-4 py-3 border border-slate-200 rounded-xl text-sm text-slate-700 bg-white focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all placeholder:text-slate-300 font-mono" />
      {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>}
      <button onClick={processImport} disabled={!raw.trim()||loading}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
        style={{ background:"linear-gradient(135deg,#0e7490,#0891b2)" }}>
        {loading ? (
          <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> AI is extracting items…</>
        ) : (
          <><BrainCircuit className="w-4 h-4" /> Extract Items with AI</>
        )}
      </button>
    </div>
  );
}

/* ─────────────────────────── ForecastView ── */
function ForecastView({ streams }: { streams: RevenueStream[] }) {
  const now = new Date();
  const [startYear,    setStartYear]    = useState(now.getFullYear());
  const [startMonth,   setStartMonth]   = useState(now.getMonth());
  const [horizonYears, setHorizonYears] = useState(3);
  const [expandedYear, setExpandedYear] = useState<number | null>(now.getFullYear());
  const [expandedStream, setExpandedStream] = useState<string | null>(null);

  const startDate  = new Date(startYear, startMonth, 1);
  const totalMths  = horizonYears * 12;
  const projection = projectRevenue(streams, totalMths, startDate);
  const years      = groupByYear(projection);
  const grandTotal = years.reduce((a, y) => a + y.total, 0);
  const totalMRR   = streams.reduce((a, s) => a + streamMRR(s), 0);

  const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  return (
    <div className="space-y-5">
      {/* Config row */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-semibold text-slate-600">Start:</span>
          <select value={startMonth} onChange={(e) => setStartMonth(Number(e.target.value))}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:border-cyan-500 focus:outline-none bg-white">
            {MONTH_NAMES.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <select value={startYear} onChange={(e) => setStartYear(Number(e.target.value))}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:border-cyan-500 focus:outline-none bg-white">
            {Array.from({ length: 10 }, (_, i) => now.getFullYear() + i).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-600">Horizon:</span>
          {HORIZONS.map(({ label, years: y }) => (
            <button key={y} onClick={() => setHorizonYears(y)}
              className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all ${horizonYears===y ? "text-white border-cyan-600" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}
              style={horizonYears===y ? { background:"#0e7490" } : {}}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:"Monthly baseline", val:fmt(totalMRR),    sub:"Current estimate"          },
          { label:"Total projection",  val:fmt(grandTotal),  sub:`Over ${horizonYears} yr${horizonYears>1?"s":""}` },
          { label:"Year 1 revenue",    val:fmt(years[0]?.total??0), sub:"First 12 months"   },
          { label:`Year ${horizonYears}`, val:fmt(years[years.length-1]?.total??0), sub:"Final year" },
        ].map(({ label, val, sub }) => (
          <div key={label} className="bg-white rounded-2xl border border-slate-100 p-4">
            <p className="text-xs text-slate-400 mb-1">{label}</p>
            <p className="text-base font-bold text-slate-900">{val}</p>
            <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Annual bar chart */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <p className="text-xs font-semibold text-slate-500 mb-4 uppercase tracking-wider">Annual Revenue Overview</p>
        <div className="flex items-end gap-2 h-32">
          {years.map((y, i) => {
            const max = Math.max(...years.map((yy) => yy.total), 1);
            const pct = (y.total / max) * 100;
            const prev = years[i - 1];
            const growth = prev ? ((y.total - prev.total) / prev.total) * 100 : null;
            return (
              <div key={y.year} className="flex-1 flex flex-col items-center gap-1">
                {growth !== null && (
                  <span className="text-xs font-semibold" style={{ color: growth >= 0 ? "#059669" : "#ef4444", fontSize: 9 }}>
                    {growth >= 0 ? "+" : ""}{growth.toFixed(0)}%
                  </span>
                )}
                <motion.div className="w-full rounded-t-lg cursor-pointer"
                  style={{ background: "linear-gradient(180deg,#0891b2,#0e7490)" }}
                  initial={{ height: 0 }} animate={{ height: `${pct}%` }}
                  transition={{ duration: 0.6, delay: i * 0.06, ease: EASE }}
                  onClick={() => setExpandedYear(expandedYear === y.year ? null : y.year)} />
                <div className="text-center">
                  <p className="font-bold text-slate-700" style={{ fontSize: 10 }}>{y.year}</p>
                  <p className="text-slate-400" style={{ fontSize: 9 }}>{fmt(y.total)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Year-by-year breakdown */}
      <div className="space-y-2">
        {years.map((y, yi) => {
          const prev   = years[yi - 1];
          const growth = prev ? ((y.total - prev.total) / prev.total) * 100 : null;
          const open   = expandedYear === y.year;
          return (
            <div key={y.year} className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
              {/* Year header */}
              <button className="w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50 transition-colors text-left"
                onClick={() => setExpandedYear(open ? null : y.year)}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white text-xs font-bold"
                  style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
                  Y{yi + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800">
                    {y.year} — {y.months[0].yearMonth} → {y.months[y.months.length-1].yearMonth}
                  </p>
                  <p className="text-xs text-slate-400">{y.months.length} months · {streams.length} stream{streams.length!==1?"s":""}</p>
                </div>
                <div className="text-right mr-2 flex-shrink-0">
                  <p className="text-base font-bold" style={{ color:"#0e7490" }}>{fmt(y.total)}</p>
                  {growth !== null && (
                    <p className="text-xs font-semibold" style={{ color: growth>=0?"#059669":"#ef4444" }}>
                      {growth>=0?"+":""}{growth.toFixed(1)}% vs prev year
                    </p>
                  )}
                </div>
                {open ? <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />}
              </button>

              <AnimatePresence>
                {open && (
                  <motion.div initial={{ height:0, opacity:0 }} animate={{ height:"auto", opacity:1 }}
                    exit={{ height:0, opacity:0 }} transition={{ duration:0.3, ease:EASE }} className="overflow-hidden">
                    <div className="border-t border-slate-100">

                      {/* Monthly table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-slate-50">
                              <th className="px-4 py-2.5 text-left font-semibold text-slate-500">Month</th>
                              {streams.map((s) => <th key={s.id} className="px-3 py-2.5 text-right font-semibold text-slate-500">{s.name}</th>)}
                              <th className="px-4 py-2.5 text-right font-semibold" style={{ color:"#0e7490" }}>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {y.months.map((m) => (
                              <tr key={m.yearMonth} className="border-t border-slate-50 hover:bg-slate-50 transition-colors">
                                <td className="px-4 py-2 font-medium text-slate-600">{m.yearMonth}</td>
                                {m.byStream.map((bs) => <td key={bs.name} className="px-3 py-2 text-right text-slate-600">{fmt(bs.rev)}</td>)}
                                <td className="px-4 py-2 text-right font-bold" style={{ color:"#0e7490" }}>{fmt(m.total)}</td>
                              </tr>
                            ))}
                            <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                              <td className="px-4 py-3 text-slate-700">Year Total</td>
                              {streams.map((s) => {
                                const tot = y.months.reduce((a, m) => a + (m.byStream.find((b) => b.name===s.name)?.rev??0), 0);
                                return <td key={s.id} className="px-3 py-3 text-right text-slate-700">{fmt(tot)}</td>;
                              })}
                              <td className="px-4 py-3 text-right" style={{ color:"#0e7490" }}>{fmt(y.total)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      {/* Per-stream category breakdown */}
                      <div className="p-4 border-t border-slate-100 space-y-2">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Category Breakdown</p>
                        {streams.map((s) => {
                          const sOpen = expandedStream === `${y.year}-${s.id}`;
                          const sTotal = y.months.reduce((a, m) => a + (m.byStream.find((b) => b.name===s.name)?.rev??0), 0);
                          const cats   = Object.entries(
                            y.months.reduce((acc, m) => {
                              const bs = m.byStream.find((b) => b.name===s.name);
                              if (bs) Object.entries(bs.byCategory).forEach(([cat, val]) => {
                                acc[cat] = (acc[cat]||0) + val.rev;
                              });
                              return acc;
                            }, {} as Record<string,number>)
                          );
                          const Meta = STREAM_META[s.type];
                          return (
                            <div key={s.id} className="rounded-xl border border-slate-100 overflow-hidden">
                              <button className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left"
                                onClick={() => setExpandedStream(sOpen ? null : `${y.year}-${s.id}`)}>
                                <span className="text-xs font-semibold text-slate-700 flex-1">{s.name}</span>
                                <span className="text-xs font-bold" style={{ color: Meta.color }}>{fmt(sTotal)}</span>
                                {sOpen ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                              </button>
                              {sOpen && (
                                <div className="border-t border-slate-50 px-4 pb-3 pt-1 space-y-1.5">
                                  {cats.map(([cat, rev]) => (
                                    <div key={cat} className="flex items-center justify-between">
                                      <span className="text-xs text-slate-500">{cat}</span>
                                      <span className="text-xs font-semibold text-slate-700">{fmt(rev)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      <div className="flex items-start gap-3 rounded-xl px-4 py-3 bg-amber-50 border border-amber-100">
        <Info className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-700">
          <span className="font-semibold">Projection confidence: Medium</span> — based on your inputs.
          Connect bank records or import verified sales data to reach High confidence.
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════ main page ══ */
export default function ApplyPage() {
  const router = useRouter();
  const [step,  setStep]  = useState(0);
  const [dir,   setDir]   = useState(1);

  /* intake chat */
  const [messages,   setMessages]   = useState<ChatMessage[]>([]);
  const [input,      setInput]      = useState("");
  const [aiTyping,   setAiTyping]   = useState(false);
  const [usedProv,   setUsedProv]   = useState<string | null>(null);
  const [chatError,  setChatError]  = useState("");
  const endRef   = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* streams */
  const [streams,      setStreams]      = useState<RevenueStream[]>([]);
  const [streamIdx,    setStreamIdx]    = useState(0);    // current stream in driver step
  const [driverMode,   setDriverMode]   = useState<DriverMode>("chat");

  const go = (n: number) => { setDir(n > step ? 1 : -1); setStep(n); };

  useEffect(() => { endRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, aiTyping]);
  useEffect(() => { if (messages.length===0) callIntake([]); }, []); // eslint-disable-line

  const callIntake = useCallback(async (history: ChatMessage[]) => {
    setAiTyping(true); setChatError("");
    try {
      const res  = await fetch("/api/intake", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ messages: history }) });
      const data = await res.json() as { text?:string; provider?:string; error?:string };
      if (data.error) throw new Error(data.error);
      setUsedProv(data.provider ?? null);
      const text = data.text ?? "";
      const detected = parseStreams(text);
      if (detected) {
        const clean = text.slice(0, text.indexOf("[STREAMS_DETECTED]")).trim() || "I've got a clear picture of your business. Let me show you what I detected.";
        setMessages((prev) => [...prev, { role:"assistant", content:clean }]);
        setStreams(detected);
        setTimeout(() => go(1), 900);
      } else {
        setMessages((prev) => [...prev, { role:"assistant", content:text }]);
      }
    } catch (e) { setChatError(e instanceof Error ? e.message : "Connection error"); }
    finally { setAiTyping(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendIntake = () => {
    const text = input.trim();
    if (!text || aiTyping) return;
    const updated = [...messages, { role:"user" as const, content:text }];
    setMessages(updated); setInput(""); callIntake(updated);
  };

  const updateStream = useCallback((updated: RevenueStream) => {
    setStreams((prev) => prev.map((s) => s.id===updated.id ? updated : s));
  }, []);

  const currentStream    = streams[streamIdx];
  const allStreamsReady  = streams.length > 0 && streams.every((s) => s.driverDone || s.items.length > 0);

  const slide = {
    enter:  (d: number) => ({ opacity:0, x: d>0?48:-48 }),
    center: { opacity:1, x:0, transition:{ duration:0.38, ease:EASE } },
    exit:   (d: number) => ({ opacity:0, x: d>0?-48:48, transition:{ duration:0.25, ease:EASE } }),
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">

      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-4 sm:px-6 py-4 flex items-center gap-4 flex-shrink-0">
        <Link href="/dashboard" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2">
            {["Understand","Detect","Build Drivers","Forecast"].map((label, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 text-xs font-medium ${step>=i?"text-cyan-700":"text-slate-400"}`}>
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background:step>=i?"#0e7490":"#e2e8f0", color:step>=i?"#fff":"#94a3b8" }}>
                    {step>i ? <Check className="w-3 h-3" /> : i+1}
                  </div>
                  <span className="hidden sm:block">{label}</span>
                </div>
                {i<3 && <div className={`w-4 sm:w-8 h-px ${step>i?"bg-cyan-600":"bg-slate-200"}`} />}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-start sm:items-center justify-center px-4 py-6 sm:py-10 overflow-hidden">
        <div className="w-full max-w-2xl">
          <AnimatePresence mode="wait" custom={dir}>

            {/* ══ STEP 0: Intake Chat ══ */}
            {step===0 && (
              <motion.div key="intake" custom={dir} variants={slide} initial="enter" animate="center" exit="exit"
                className="flex flex-col" style={{ height:"calc(100vh - 180px)", maxHeight:620 }}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background:"linear-gradient(135deg,#042f3d,#0e7490)" }}>
                    <BrainCircuit className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Mentorvix AI · Revenue Intelligence</p>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <p className="text-xs text-slate-400">{usedProv ? `Powered by ${usedProv}` : "Connecting…"}</p>
                    </div>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto space-y-4 pr-1 pb-2">
                  {messages.map((m, i) => (
                    <motion.div key={i} initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.3, ease:EASE }}
                      className={`flex ${m.role==="user"?"justify-end":"justify-start"}`}>
                      {m.role==="assistant" && (
                        <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 mr-2 mt-0.5"
                          style={{ background:"linear-gradient(135deg,#042f3d,#0e7490)" }}>
                          <BrainCircuit className="w-3.5 h-3.5 text-white" />
                        </div>
                      )}
                      <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${m.role==="user"?"text-white rounded-tr-sm":"bg-white border border-slate-100 text-slate-800 rounded-tl-sm shadow-sm"}`}
                        style={m.role==="user"?{ background:"linear-gradient(135deg,#0e7490,#0891b2)" }:{}}>
                        {m.content}
                      </div>
                    </motion.div>
                  ))}
                  {aiTyping && (
                    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-xl flex items-center justify-center" style={{ background:"linear-gradient(135deg,#042f3d,#0e7490)" }}>
                        <BrainCircuit className="w-3.5 h-3.5 text-white" />
                      </div>
                      <div className="bg-white border border-slate-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                        <div className="flex items-center gap-1">
                          {[0,1,2].map((i) => (
                            <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-slate-300"
                              animate={{ y:[0,-4,0] }} transition={{ duration:0.6, repeat:Infinity, delay:i*0.15 }} />
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                  {chatError && (
                    <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                      <span>⚠ {chatError}</span>
                      <button onClick={() => callIntake(messages)} className="ml-auto font-semibold underline">Retry</button>
                    </div>
                  )}
                  <div ref={endRef} />
                </div>
                <div className="mt-3 flex items-end gap-2">
                  <textarea ref={inputRef} rows={2} value={input} onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key==="Enter"&&!e.shiftKey) { e.preventDefault(); sendIntake(); } }}
                    disabled={aiTyping}
                    placeholder="Type your answer… (Enter to send)"
                    className="flex-1 resize-none px-4 py-3 border border-slate-200 rounded-2xl text-sm text-slate-800 bg-white focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all placeholder:text-slate-300 disabled:opacity-60" />
                  <motion.button whileHover={{ scale:1.05 }} whileTap={{ scale:0.95 }} onClick={sendIntake}
                    disabled={!input.trim()||aiTyping}
                    className="w-11 h-11 rounded-2xl flex items-center justify-center text-white shadow-md disabled:opacity-40"
                    style={{ background:"linear-gradient(135deg,#0e7490,#0891b2)" }}>
                    <Send className="w-4 h-4" />
                  </motion.button>
                </div>
                <p className="text-xs text-slate-300 text-center mt-2">Shift+Enter for new line · Enter to send</p>
              </motion.div>
            )}

            {/* ══ STEP 1: Stream Review ══ */}
            {step===1 && (
              <motion.div key="review" custom={dir} variants={slide} initial="enter" animate="center" exit="exit" className="space-y-5">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600">AI Detection Complete</span>
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">We found {streams.length} revenue stream{streams.length!==1?"s":""}</h2>
                  <p className="text-slate-500 text-sm mt-1">Rename, remove, or add streams before building item-level data.</p>
                </div>
                <div className="space-y-2">
                  {streams.map((s, i) => {
                    const Meta = STREAM_META[s.type]; const Icon = Meta.icon;
                    return (
                      <motion.div key={s.id} initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} transition={{ delay:i*0.07, ease:EASE }}
                        className="bg-white rounded-2xl border border-slate-100">
                        <div className="flex items-center gap-3 p-4">
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:Meta.bg }}>
                            <Icon className="w-4 h-4" style={{ color:Meta.color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <EditableName value={s.name} onChange={(name) => updateStream({ ...s, name })} />
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-slate-400">{Meta.label}</span>
                              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full border ${CONF_STYLE[s.confidence]}`}>
                                {s.confidence==="high"?"High":s.confidence==="medium"?"Medium":"Low"} confidence
                              </span>
                            </div>
                          </div>
                          <button onClick={() => setStreams((prev) => prev.filter((x) => x.id!==s.id))}
                            className="p-1.5 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { const s=makeStream("New Revenue Stream","custom","low"); setStreams((p)=>[...p,s]); }}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-slate-200 text-sm font-medium text-slate-500 hover:border-cyan-400 hover:text-cyan-600 transition-colors">
                    <Plus className="w-4 h-4" /> Add stream manually
                  </button>
                  <button onClick={() => go(0)}
                    className="flex items-center gap-1.5 px-4 py-3 rounded-xl border border-slate-200 text-sm text-slate-500 hover:bg-slate-50 transition-colors">
                    <RefreshCw className="w-3.5 h-3.5" /> Re-chat
                  </button>
                </div>
                <button onClick={() => { setStreamIdx(0); setDriverMode("chat"); go(2); }} disabled={streams.length===0}
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 disabled:opacity-40"
                  style={{ background:"linear-gradient(135deg,#0e7490,#0891b2)" }}>
                  Build Item-Level Data <ArrowRight className="w-4 h-4" />
                </button>
              </motion.div>
            )}

            {/* ══ STEP 2: Per-Stream Driver Collection ══ */}
            {step===2 && currentStream && (
              <motion.div key={`drivers-${currentStream.id}`} custom={dir} variants={slide} initial="enter" animate="center" exit="exit" className="space-y-4">
                {/* Stream progress dots */}
                <div className="flex items-center gap-2">
                  {streams.map((s, i) => {
                    const done = s.driverDone || s.items.length > 0;
                    return (
                      <button key={s.id} onClick={() => setStreamIdx(i)}
                        className={`h-2 rounded-full transition-all ${i===streamIdx?"w-6":"w-2"} ${done?"bg-emerald-500":i===streamIdx?"bg-cyan-600":"bg-slate-200"}`} />
                    );
                  })}
                  <span className="text-xs text-slate-400 ml-1">Stream {streamIdx+1} of {streams.length}</span>
                </div>

                {/* Stream header */}
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: STREAM_META[currentStream.type].bg }}>
                    {(() => { const Icon = STREAM_META[currentStream.type].icon; return <Icon className="w-5 h-5" style={{ color: STREAM_META[currentStream.type].color }} />; })()}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">{currentStream.name}</h2>
                    <p className="text-xs text-slate-500">{STREAM_META[currentStream.type].label} · item-by-item breakdown</p>
                  </div>
                  {(currentStream.driverDone || currentStream.items.length > 0) && (
                    <span className="ml-auto flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100">
                      <CheckCircle2 className="w-3.5 h-3.5" /> {currentStream.items.length} items
                    </span>
                  )}
                </div>

                {/* Mode selector */}
                <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
                  {([
                    { id:"chat"  as DriverMode, label:"AI Chat",   icon:BrainCircuit },
                    { id:"import" as DriverMode, label:"Import / Paste", icon:Upload },
                    { id:"manual" as DriverMode, label:"Manual",   icon:Pencil },
                  ]).map(({ id, label, icon:Icon }) => (
                    <button key={id} onClick={() => setDriverMode(id)}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${driverMode===id?"bg-white text-slate-800 shadow-sm":"text-slate-500 hover:text-slate-700"}`}>
                      <Icon className="w-3.5 h-3.5" /> {label}
                    </button>
                  ))}
                </div>

                {/* Mode content */}
                {driverMode==="chat"   && <DriverChat   stream={currentStream} onUpdate={updateStream} />}
                {driverMode==="import" && <ImportPane   stream={currentStream} onUpdate={updateStream} />}
                {driverMode==="manual" && (
                  <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-700">
                    Use the item table below to add items manually.
                  </div>
                )}

                {/* Item table (always visible after items exist) */}
                {currentStream.items.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      Detected Items — edit inline
                    </p>
                    <ItemTable stream={currentStream} onUpdate={updateStream} />
                  </div>
                )}

                {/* Nav */}
                <div className="flex gap-3 pt-2">
                  <button onClick={() => { if (streamIdx>0) { setStreamIdx(streamIdx-1); setDriverMode("chat"); } else go(1); }}
                    className="flex items-center gap-2 px-5 py-3.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                    <ArrowLeft className="w-4 h-4" /> Back
                  </button>
                  {streamIdx < streams.length - 1 ? (
                    <button onClick={() => { setStreamIdx(streamIdx+1); setDriverMode("chat"); }}
                      className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold text-white shadow-lg shadow-cyan-500/20"
                      style={{ background:"linear-gradient(135deg,#0e7490,#0891b2)" }}>
                      Next Stream: {streams[streamIdx+1]?.name} <ArrowRight className="w-4 h-4" />
                    </button>
                  ) : (
                    <button onClick={() => go(3)} disabled={!allStreamsReady}
                      className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 disabled:opacity-40"
                      style={{ background:"linear-gradient(135deg,#0e7490,#0891b2)" }}>
                      <BarChart3 className="w-4 h-4" /> Generate Revenue Forecast
                    </button>
                  )}
                </div>
              </motion.div>
            )}

            {/* ══ STEP 3: Multi-Year Forecast ══ */}
            {step===3 && (
              <motion.div key="forecast" custom={dir} variants={slide} initial="enter" animate="center" exit="exit" className="space-y-5">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <BarChart3 className="w-5 h-5" style={{ color:"#0e7490" }} />
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color:"#0e7490" }}>Revenue Forecast</span>
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">Multi-Year Revenue Projection</h2>
                  <p className="text-slate-500 text-sm mt-1">Item-level · by stream · by category · month by month</p>
                </div>

                <ForecastView streams={streams} />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <button onClick={() => go(2)}
                    className="flex items-center justify-center gap-2 py-3.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                    <ArrowLeft className="w-4 h-4" /> Adjust Numbers
                  </button>
                  <button onClick={() => {
                    const data = { streams, projection: projectRevenue(streams, 36, new Date()) };
                    localStorage.setItem("mvx_revenue_model", JSON.stringify(data));
                    router.push("/dashboard");
                  }}
                    className="flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold text-white shadow-lg shadow-cyan-500/20"
                    style={{ background:"linear-gradient(135deg,#0e7490,#0891b2)" }}>
                    Save & Continue Application <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
