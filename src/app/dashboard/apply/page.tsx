"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Plus, Trash2, Edit3, Check,
  Sparkles, BarChart3, TrendingUp, ShoppingBag, Briefcase,
  Repeat, Landmark, Zap, CheckCircle2,
  X, ChevronDown, ChevronUp, Info, RefreshCw, Send,
} from "lucide-react";

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

/* ─────────────────────────────────────── types ── */
type StreamType = "product" | "service" | "subscription" | "rental" | "marketplace" | "custom";
type Confidence  = "high" | "medium" | "low";
type Provider    = "anthropic" | "openai" | "gemini";

interface ChatMessage { role: "user" | "assistant"; content: string; }
interface RevenueStream {
  id: string; name: string; type: StreamType; confidence: Confidence;
  monthlyUnits: number; pricePerUnit: number;
  monthlyClients: number; avgContractValue: number;
  subscribers: number; monthlyFee: number; newPerMonth: number; churnPct: number;
  rentalUnits: number; rentalRate: number; occupancyPct: number;
  customMonthly: number; monthlyGrowthPct: number;
}

/* ─────────────────────────────────── stream metadata ── */
const STREAM_META: Record<StreamType, {
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string; bg: string; driverLabel: string;
}> = {
  product:      { label: "Product Sales",             icon: ShoppingBag, color: "#0e7490", bg: "#f0f9ff", driverLabel: "Units × Price"             },
  service:      { label: "Service / Project",         icon: Briefcase,   color: "#7c3aed", bg: "#faf5ff", driverLabel: "Clients × Contract Value"   },
  subscription: { label: "Subscription / MRR",        icon: Repeat,      color: "#059669", bg: "#f0fdf4", driverLabel: "Subscribers × Monthly Fee" },
  rental:       { label: "Rental / Lease",             icon: Landmark,    color: "#b45309", bg: "#fffbeb", driverLabel: "Units × Occupancy × Rate"  },
  marketplace:  { label: "Marketplace / Commission",  icon: TrendingUp,  color: "#e11d48", bg: "#fff1f2", driverLabel: "GMV × Take Rate"            },
  custom:       { label: "Custom Stream",              icon: Zap,         color: "#6366f1", bg: "#eef2ff", driverLabel: "Monthly revenue (manual)"  },
};

/* ─────────────────────────────────────── helpers ── */
let _id = 0;
function makeStream(name: string, type: StreamType, confidence: Confidence): RevenueStream {
  return {
    id: `s${++_id}`, name, type, confidence,
    monthlyUnits: 0, pricePerUnit: 0, monthlyClients: 0, avgContractValue: 0,
    subscribers: 0, monthlyFee: 0, newPerMonth: 0, churnPct: 5,
    rentalUnits: 0, rentalRate: 0, occupancyPct: 80,
    customMonthly: 0, monthlyGrowthPct: 2,
  };
}

function streamMRR(s: RevenueStream): number {
  switch (s.type) {
    case "product":
    case "marketplace": return s.monthlyUnits * s.pricePerUnit;
    case "service":      return s.monthlyClients * s.avgContractValue;
    case "subscription": return s.subscribers * s.monthlyFee;
    case "rental":       return s.rentalUnits * s.rentalRate * (s.occupancyPct / 100);
    case "custom":       return s.customMonthly;
    default:             return 0;
  }
}

function projectRevenue(streams: RevenueStream[], months = 12) {
  return Array.from({ length: months }, (_, i) => {
    const byStream = streams.map((s) => {
      const base = streamMRR(s);
      const factor = Math.pow(1 + s.monthlyGrowthPct / 100, i);
      return { name: s.name, rev: Math.round(base * factor) };
    });
    return { month: i + 1, total: byStream.reduce((a, b) => a + b.rev, 0), byStream };
  });
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n/1_000).toFixed(1)}K`;
  return `$${n}`;
}

const CONF_STYLE: Record<Confidence, string> = {
  high:   "bg-emerald-50 text-emerald-700 border-emerald-100",
  medium: "bg-amber-50   text-amber-700   border-amber-100",
  low:    "bg-red-50     text-red-600     border-red-100",
};

/* ─────────────────────────── parse AI stream detection output ── */
function parseDetectedStreams(text: string): RevenueStream[] | null {
  const idx = text.indexOf("[STREAMS_DETECTED]");
  if (idx === -1) return null;
  try {
    const json = text.slice(idx + "[STREAMS_DETECTED]".length).trim();
    const arr = JSON.parse(json) as { name: string; type: StreamType; confidence: Confidence }[];
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

/* ─────────────────────────── DriverInput ── */
function DriverInput({ label, value, onChange, prefix="", suffix="", step=1, min=0 }:{
  label: string; value: number; onChange: (v: number) => void;
  prefix?: string; suffix?: string; step?: number; min?: number;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">{prefix}</span>}
        <input type="number" min={min} step={step} value={value || ""} placeholder="0"
          onChange={(e) => onChange(Number(e.target.value))}
          className={`w-full py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 bg-slate-50 focus:bg-white focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all ${prefix?"pl-8":"pl-3"} ${suffix?"pr-10":"pr-3"}`} />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">{suffix}</span>}
      </div>
    </div>
  );
}

/* ─────────────────────────── StreamDriverForm ── */
function StreamDriverForm({ stream, onChange }: { stream: RevenueStream; onChange: (s: RevenueStream) => void }) {
  const up = (key: keyof RevenueStream, v: number) => onChange({ ...stream, [key]: v });
  const mrr = streamMRR(stream);
  return (
    <div className="space-y-4">
      {(stream.type === "product" || stream.type === "marketplace") ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <DriverInput label="Units sold per month" value={stream.monthlyUnits} onChange={(v) => up("monthlyUnits", v)} />
          <DriverInput label="Average selling price" value={stream.pricePerUnit} onChange={(v) => up("pricePerUnit", v)} prefix="$" />
        </div>
      ) : stream.type === "service" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <DriverInput label="Clients / projects per month" value={stream.monthlyClients} onChange={(v) => up("monthlyClients", v)} />
          <DriverInput label="Average contract / project value" value={stream.avgContractValue} onChange={(v) => up("avgContractValue", v)} prefix="$" />
        </div>
      ) : stream.type === "subscription" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <DriverInput label="Current subscribers" value={stream.subscribers} onChange={(v) => up("subscribers", v)} />
          <DriverInput label="Monthly fee per subscriber" value={stream.monthlyFee} onChange={(v) => up("monthlyFee", v)} prefix="$" />
          <DriverInput label="New subscribers per month" value={stream.newPerMonth} onChange={(v) => up("newPerMonth", v)} />
          <DriverInput label="Monthly churn rate" value={stream.churnPct} onChange={(v) => up("churnPct", v)} suffix="%" min={0} />
        </div>
      ) : stream.type === "rental" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <DriverInput label="Rentable units / rooms" value={stream.rentalUnits} onChange={(v) => up("rentalUnits", v)} />
          <DriverInput label="Rate per unit per month" value={stream.rentalRate} onChange={(v) => up("rentalRate", v)} prefix="$" />
          <DriverInput label="Average occupancy" value={stream.occupancyPct} onChange={(v) => up("occupancyPct", v)} suffix="%" />
        </div>
      ) : (
        <DriverInput label="Current monthly revenue from this stream" value={stream.customMonthly} onChange={(v) => up("customMonthly", v)} prefix="$" />
      )}
      <div>
        <div className="flex justify-between mb-1">
          <label className="text-xs font-medium text-slate-500">Expected monthly growth</label>
          <span className="text-xs font-bold" style={{ color:"#0e7490" }}>+{stream.monthlyGrowthPct}%</span>
        </div>
        <input type="range" min={0} max={20} step={0.5} value={stream.monthlyGrowthPct}
          onChange={(e) => up("monthlyGrowthPct", Number(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer" style={{ accentColor:"#0e7490" }} />
        <div className="flex justify-between text-xs text-slate-300 mt-0.5"><span>0% (flat)</span><span>20% / month</span></div>
      </div>
      {mrr > 0 && (
        <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }}
          className="flex items-center justify-between rounded-xl px-4 py-2.5 bg-slate-50 border border-slate-100">
          <span className="text-xs text-slate-500">Estimated current monthly revenue</span>
          <span className="text-sm font-bold" style={{ color:"#0e7490" }}>{fmt(mrr)}</span>
        </motion.div>
      )}
    </div>
  );
}

/* ─────────────────────────── RevenueChart ── */
function RevenueChart({ data }: { data: { month: number; total: number }[] }) {
  const max = Math.max(...data.map((d) => d.total), 1);
  return (
    <div className="flex items-end gap-1 h-28 w-full">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <motion.div className="w-full rounded-t-md"
            style={{ background: "linear-gradient(180deg,#0891b2,#0e7490)" }}
            initial={{ height: 0 }} animate={{ height:`${(d.total/max)*100}%` }}
            transition={{ duration:0.6, delay:i*0.04, ease:EASE }} />
          <span className="text-slate-400" style={{ fontSize:9 }}>{MONTHS[d.month-1]}</span>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════ main page ══ */
export default function ApplyPage() {
  const router = useRouter();
  const [step, setStep]   = useState(0); // 0=chat, 1=review, 2=drivers, 3=forecast
  const [dir,  setDir]    = useState(1);

  /* ── chat state ── */
  const [messages,     setMessages]     = useState<ChatMessage[]>([]);
  const [input,        setInput]        = useState("");
  const [aiTyping,     setAiTyping]     = useState(false);
  const [provider,     setProvider]     = useState<Provider>("anthropic");
  const [usedProvider, setUsedProvider] = useState<Provider | null>(null);
  const [chatError,    setChatError]    = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);

  /* ── stream / forecast state ── */
  const [streams,         setStreams]         = useState<RevenueStream[]>([]);
  const [expandedStream,  setExpandedStream]  = useState<string | null>(null);

  const go = (n: number) => { setDir(n > step ? 1 : -1); setStep(n); };

  /* ── scroll chat to bottom ── */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, aiTyping]);

  /* ── open conversation: AI fires first question ── */
  useEffect(() => {
    if (messages.length === 0) {
      callAI([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── call AI API route ── */
  const callAI = useCallback(async (history: ChatMessage[]) => {
    setAiTyping(true);
    setChatError("");
    try {
      const res  = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, provider }),
      });
      const data = await res.json() as { text?: string; provider?: Provider; error?: string };
      if (data.error) throw new Error(data.error);

      const text = data.text ?? "";
      setUsedProvider(data.provider ?? null);

      // Check for stream detection signal
      const detected = parseDetectedStreams(text);
      if (detected) {
        // Show clean version of response (hide the JSON)
        const cleanText = text.slice(0, text.indexOf("[STREAMS_DETECTED]")).trim() ||
          "I've understood your business model. Let me show you what I detected.";
        setMessages((prev) => [...prev, { role: "assistant", content: cleanText }]);
        setStreams(detected);
        setExpandedStream(detected[0]?.id ?? null);
        // Small delay then transition
        setTimeout(() => go(1), 900);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: text }]);
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Connection error");
    } finally {
      setAiTyping(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || aiTyping) return;
    const updated: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(updated);
    setInput("");
    callAI(updated);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  /* ── stream operations ── */
  const updateStream = useCallback((updated: RevenueStream) => {
    setStreams((prev) => prev.map((s) => s.id === updated.id ? updated : s));
  }, []);
  const removeStream = (id: string) => setStreams((prev) => prev.filter((s) => s.id !== id));
  const addCustomStream = () => {
    const s = makeStream("New Revenue Stream", "custom", "low");
    setStreams((prev) => [...prev, s]);
    setExpandedStream(s.id);
  };

  const totalMRR    = streams.reduce((a, s) => a + streamMRR(s), 0);
  const projection  = projectRevenue(streams);
  const annualTotal = projection.reduce((a, d) => a + d.total, 0);

  const PROVIDER_COLORS: Record<Provider, string> = {
    anthropic: "#e07b39",
    openai:    "#10a37f",
    gemini:    "#4285f4",
  };

  const slide = {
    enter:  (d: number) => ({ opacity: 0, x: d > 0 ? 48 : -48 }),
    center: { opacity: 1, x: 0, transition: { duration: 0.38, ease: EASE } },
    exit:   (d: number) => ({ opacity: 0, x: d > 0 ? -48 : 48, transition: { duration: 0.25, ease: EASE } }),
  };

  /* ══════════════════════════════════════════════════ render ══ */
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">

      {/* ── Header ── */}
      <div className="bg-white border-b border-slate-100 px-4 sm:px-6 py-4 flex items-center gap-4 flex-shrink-0">
        <Link href="/dashboard" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2">
            {["Understand", "Detect Streams", "Build Drivers", "Forecast"].map((label, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 text-xs font-medium ${step >= i ? "text-cyan-700" : "text-slate-400"}`}>
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background: step > i ? "#0e7490" : step === i ? "#0e7490" : "#e2e8f0", color: step >= i ? "#fff" : "#94a3b8" }}>
                    {step > i ? <Check className="w-3 h-3" /> : i + 1}
                  </div>
                  <span className="hidden sm:block">{label}</span>
                </div>
                {i < 3 && <div className={`w-4 sm:w-8 h-px ${step > i ? "bg-cyan-600" : "bg-slate-200"}`} />}
              </div>
            ))}
          </div>
        </div>
        {/* Provider selector */}
        <div className="flex items-center gap-1.5">
          {(["anthropic","openai","gemini"] as Provider[]).map((p) => (
            <button key={p} onClick={() => setProvider(p)}
              title={p.charAt(0).toUpperCase() + p.slice(1)}
              className={`w-7 h-7 rounded-full text-xs font-bold border-2 transition-all ${provider === p ? "border-current scale-110" : "border-transparent opacity-40 hover:opacity-70"}`}
              style={{ background: PROVIDER_COLORS[p], color: "#fff" }}>
              {p === "anthropic" ? "A" : p === "openai" ? "O" : "G"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 flex items-start sm:items-center justify-center px-4 py-6 sm:py-10 overflow-hidden">
        <div className="w-full max-w-2xl">
          <AnimatePresence mode="wait" custom={dir}>

            {/* ═══════════ STEP 0: AI Chat ═══════════ */}
            {step === 0 && (
              <motion.div key="chat" custom={dir} variants={slide} initial="enter" animate="center" exit="exit"
                className="flex flex-col" style={{ height: "calc(100vh - 180px)", maxHeight: 620 }}>

                {/* Chat header */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
                    style={{ background: "linear-gradient(135deg,#042f3d,#0e7490)" }}>
                    <Sparkles className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Mentorvix AI · Revenue Intelligence</p>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <p className="text-xs text-slate-400">
                        Powered by {usedProvider ?? provider}
                        {usedProvider && usedProvider !== provider && ` (auto-selected)`}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto space-y-4 pr-1 pb-2">
                  {messages.map((m, i) => (
                    <motion.div key={i}
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, ease: EASE }}
                      className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                      {m.role === "assistant" && (
                        <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 mr-2 mt-0.5"
                          style={{ background: "linear-gradient(135deg,#042f3d,#0e7490)" }}>
                          <Sparkles className="w-3.5 h-3.5 text-white" />
                        </div>
                      )}
                      <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                        m.role === "user"
                          ? "text-white rounded-tr-sm"
                          : "bg-white border border-slate-100 text-slate-800 rounded-tl-sm shadow-sm"
                      }`}
                        style={m.role === "user" ? { background: "linear-gradient(135deg,#0e7490,#0891b2)" } : {}}>
                        {m.content}
                      </div>
                    </motion.div>
                  ))}

                  {/* Typing indicator */}
                  {aiTyping && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: "linear-gradient(135deg,#042f3d,#0e7490)" }}>
                        <Sparkles className="w-3.5 h-3.5 text-white" />
                      </div>
                      <div className="bg-white border border-slate-100 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                        <div className="flex items-center gap-1">
                          {[0, 1, 2].map((i) => (
                            <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-slate-300"
                              animate={{ y: [0, -4, 0] }}
                              transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }} />
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* Error */}
                  {chatError && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                      <span>⚠ {chatError}</span>
                      <button onClick={() => callAI(messages)} className="ml-auto font-semibold underline">Retry</button>
                    </motion.div>
                  )}

                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="mt-3 flex items-end gap-2">
                  <div className="flex-1 relative">
                    <textarea
                      ref={inputRef}
                      rows={2}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      disabled={aiTyping}
                      placeholder="Type your answer… (Enter to send)"
                      className="w-full resize-none px-4 py-3 pr-12 border border-slate-200 rounded-2xl text-sm text-slate-800 bg-white focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition-all placeholder:text-slate-300 disabled:opacity-60"
                    />
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                    onClick={handleSend}
                    disabled={!input.trim() || aiTyping}
                    className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 text-white shadow-md disabled:opacity-40 transition-all"
                    style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
                    <Send className="w-4 h-4" />
                  </motion.button>
                </div>
                <p className="text-xs text-slate-300 text-center mt-2">Shift+Enter for new line · Enter to send</p>
              </motion.div>
            )}

            {/* ═══════════ STEP 1: Stream Review ═══════════ */}
            {step === 1 && (
              <motion.div key="review" custom={dir} variants={slide} initial="enter" animate="center" exit="exit" className="space-y-5">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600">AI Detection Complete</span>
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">We found {streams.length} revenue stream{streams.length !== 1 ? "s" : ""}</h2>
                  <p className="text-slate-500 text-sm mt-1">Rename, remove, or add streams before setting up the numbers.</p>
                </div>

                <div className="space-y-2">
                  {streams.map((s, i) => {
                    const Meta = STREAM_META[s.type];
                    const Icon = Meta.icon;
                    return (
                      <motion.div key={s.id}
                        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.07, ease: EASE }}
                        className="bg-white rounded-2xl border border-slate-100">
                        <div className="flex items-center gap-3 p-4">
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: Meta.bg }}>
                            <Icon className="w-4 h-4" style={{ color: Meta.color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <EditableName value={s.name} onChange={(name) => updateStream({ ...s, name })} />
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-slate-400">{Meta.label}</span>
                              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full border ${CONF_STYLE[s.confidence]}`}>
                                {s.confidence === "high" ? "High confidence" : s.confidence === "medium" ? "Medium confidence" : "Low confidence"}
                              </span>
                            </div>
                          </div>
                          <button onClick={() => removeStream(s.id)}
                            className="p-1.5 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                <div className="flex gap-2">
                  <button onClick={addCustomStream}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-slate-200 text-sm font-medium text-slate-500 hover:border-cyan-400 hover:text-cyan-600 transition-colors">
                    <Plus className="w-4 h-4" /> Add stream manually
                  </button>
                  <button onClick={() => go(0)}
                    className="flex items-center gap-1.5 px-4 py-3 rounded-xl border border-slate-200 text-sm text-slate-500 hover:bg-slate-50 transition-colors">
                    <RefreshCw className="w-3.5 h-3.5" /> Re-chat
                  </button>
                </div>

                {streams.length === 0 && (
                  <p className="text-center py-6 text-slate-400 text-sm">No streams. Add at least one to continue.</p>
                )}

                <button onClick={() => { setExpandedStream(streams[0]?.id ?? null); go(2); }}
                  disabled={streams.length === 0}
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
                  Set Up Numbers <ArrowRight className="w-4 h-4" />
                </button>
              </motion.div>
            )}

            {/* ═══════════ STEP 2: Driver Collection ═══════════ */}
            {step === 2 && (
              <motion.div key="drivers" custom={dir} variants={slide} initial="enter" animate="center" exit="exit" className="space-y-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Set the numbers for each stream</h2>
                  <p className="text-slate-500 text-sm mt-1">Use estimates — calculated from drivers, not guesses.</p>
                </div>

                {totalMRR > 0 && (
                  <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }}
                    className="flex items-center justify-between rounded-2xl px-5 py-3.5 border border-cyan-100"
                    style={{ background:"linear-gradient(135deg,#f0f9ff,#e0f2fe)" }}>
                    <div>
                      <p className="text-xs text-slate-500 font-medium">Total estimated monthly revenue</p>
                      <p className="text-xl font-bold" style={{ color:"#0e7490" }}>{fmt(totalMRR)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-400">Projected Year 1</p>
                      <p className="text-sm font-semibold text-slate-600">{fmt(annualTotal)}</p>
                    </div>
                  </motion.div>
                )}

                <div className="space-y-3">
                  {streams.map((s) => {
                    const Meta = STREAM_META[s.type];
                    const Icon = Meta.icon;
                    const mrr  = streamMRR(s);
                    const open = expandedStream === s.id;
                    return (
                      <div key={s.id} className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                        <button className="w-full flex items-center gap-3 p-4 text-left hover:bg-slate-50 transition-colors"
                          onClick={() => setExpandedStream(open ? null : s.id)}>
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background:Meta.bg }}>
                            <Icon className="w-4 h-4" style={{ color:Meta.color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-slate-800">{s.name}</p>
                            <p className="text-xs text-slate-400">{Meta.driverLabel}</p>
                          </div>
                          <div className="text-right mr-2 flex-shrink-0">
                            {mrr > 0
                              ? <span className="text-sm font-bold" style={{ color:"#0e7490" }}>{fmt(mrr)}/mo</span>
                              : <span className="text-xs text-slate-300">Enter numbers →</span>}
                          </div>
                          {open ? <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />}
                        </button>
                        <AnimatePresence>
                          {open && (
                            <motion.div initial={{ height:0, opacity:0 }} animate={{ height:"auto", opacity:1 }}
                              exit={{ height:0, opacity:0 }} transition={{ duration:0.3, ease:EASE }} className="overflow-hidden">
                              <div className="px-4 pb-5 pt-1 border-t border-slate-50">
                                <StreamDriverForm stream={s} onChange={updateStream} />
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>

                <div className="flex gap-3">
                  <button onClick={() => go(1)}
                    className="flex items-center gap-2 px-5 py-3.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                    <ArrowLeft className="w-4 h-4" /> Back
                  </button>
                  <button onClick={() => go(3)} disabled={totalMRR === 0}
                    className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 disabled:opacity-40"
                    style={{ background:"linear-gradient(135deg,#0e7490,#0891b2)" }}>
                    <BarChart3 className="w-4 h-4" /> Generate Revenue Forecast
                  </button>
                </div>
              </motion.div>
            )}

            {/* ═══════════ STEP 3: Forecast ═══════════ */}
            {step === 3 && (
              <motion.div key="forecast" custom={dir} variants={slide} initial="enter" animate="center" exit="exit" className="space-y-5">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <BarChart3 className="w-5 h-5" style={{ color:"#0e7490" }} />
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color:"#0e7490" }}>Revenue Forecast</span>
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">12-Month Revenue Projection</h2>
                  <p className="text-slate-500 text-sm mt-1">Driver-based · Finance-grade · {streams.length} stream{streams.length !== 1 ? "s" : ""}</p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { label:"Current monthly",   val:fmt(totalMRR),                  sub:"Estimated baseline" },
                    { label:"Projected Year 1",   val:fmt(annualTotal),               sub:"With growth applied" },
                    { label:"Month 12 revenue",   val:fmt(projection[11]?.total??0),  sub:"End of period" },
                  ].map(({ label, val, sub }) => (
                    <motion.div key={label} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }}
                      className="bg-white rounded-2xl border border-slate-100 p-4">
                      <p className="text-xs text-slate-400 mb-1">{label}</p>
                      <p className="text-lg font-bold text-slate-900">{val}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
                    </motion.div>
                  ))}
                </div>

                <div className="bg-white rounded-2xl border border-slate-100 p-5">
                  <p className="text-xs font-semibold text-slate-500 mb-4 uppercase tracking-wider">Monthly Revenue Trend</p>
                  <RevenueChart data={projection} />
                </div>

                <div className="bg-white rounded-2xl border border-slate-100 p-5">
                  <p className="text-xs font-semibold text-slate-500 mb-4 uppercase tracking-wider">Revenue Streams Breakdown</p>
                  <div className="space-y-3">
                    {streams.map((s) => {
                      const mrr  = streamMRR(s);
                      const pct  = totalMRR > 0 ? (mrr / totalMRR) * 100 : 0;
                      const Meta = STREAM_META[s.type];
                      return (
                        <div key={s.id}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm text-slate-700 font-medium">{s.name}</span>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-slate-400">{pct.toFixed(0)}%</span>
                              <span className="text-sm font-bold text-slate-900">{fmt(mrr)}/mo</span>
                            </div>
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <motion.div className="h-full rounded-full" style={{ background:Meta.color }}
                              initial={{ width:0 }} animate={{ width:`${pct}%` }}
                              transition={{ duration:0.8, ease:EASE }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-xl px-4 py-3 bg-amber-50 border border-amber-100">
                  <Info className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-amber-700">Projection confidence: Medium</p>
                    <p className="text-xs text-amber-600 mt-0.5">Add bank records or sales exports later to reach High confidence and unlock lender-ready verification.</p>
                  </div>
                </div>

                <details className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                  <summary className="flex items-center justify-between px-5 py-4 cursor-pointer text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                    <span>Full month-by-month table</span>
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  </summary>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-t border-slate-100 bg-slate-50">
                          <th className="text-left px-4 py-2.5 text-slate-500 font-semibold">Month</th>
                          {streams.map((s) => <th key={s.id} className="text-right px-3 py-2.5 text-slate-500 font-semibold">{s.name}</th>)}
                          <th className="text-right px-4 py-2.5 font-semibold" style={{ color:"#0e7490" }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {projection.map((d, i) => (
                          <tr key={i} className="border-t border-slate-50 hover:bg-slate-50">
                            <td className="px-4 py-2.5 text-slate-600 font-medium">{MONTHS[i]}</td>
                            {d.byStream.map((bs) => <td key={bs.name} className="text-right px-3 py-2.5 text-slate-600">{fmt(bs.rev)}</td>)}
                            <td className="text-right px-4 py-2.5 font-bold" style={{ color:"#0e7490" }}>{fmt(d.total)}</td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                          <td className="px-4 py-3 text-slate-700">Year Total</td>
                          {streams.map((s) => {
                            const tot = projection.reduce((a, d) => a + (d.byStream.find((b) => b.name===s.name)?.rev??0), 0);
                            return <td key={s.id} className="text-right px-3 py-3 text-slate-700">{fmt(tot)}</td>;
                          })}
                          <td className="text-right px-4 py-3" style={{ color:"#0e7490" }}>{fmt(annualTotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </details>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button onClick={() => go(2)}
                    className="flex items-center justify-center gap-2 py-3.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                    <ArrowLeft className="w-4 h-4" /> Adjust Numbers
                  </button>
                  <button
                    onClick={() => {
                      const data = { streams: streams.map((s) => ({ ...s, mrr: streamMRR(s) })), totalMRR, annualTotal, projection };
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
