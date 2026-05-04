"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, HelpCircle, Mail, MessageSquare } from "lucide-react";
import { DashboardSidebar } from "../_nav";

export default function SupportPage() {
  const router = useRouter();
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <DashboardSidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-6 py-4 flex items-center gap-3">
          <button onClick={() => router.back()} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Support</h1>
            <p className="text-xs text-slate-500">Help centre &amp; contact</p>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-73px)] px-6 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5 shadow-lg"
            style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
            <HelpCircle size={28} className="text-white" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Support</h2>
          <p className="text-slate-500 max-w-sm mb-8 leading-relaxed">
            Need help? Reach out to the Mentorvix team — we typically respond within one business day.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <a href="mailto:support@mentorvix.com"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
              style={{ background: "linear-gradient(135deg,#0e7490,#0891b2)" }}>
              <Mail size={16} /> Email Support
            </a>
            <Link href="/dashboard"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
              Back to Dashboard
            </Link>
          </div>

          <div className="mt-6 bg-white border border-slate-200 rounded-2xl p-6 max-w-sm w-full text-left space-y-3 shadow-sm">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Common questions</p>
            {[
              "How do I add or edit a revenue stream?",
              "Can I change the forecast horizon?",
              "How does the growth scenario work?",
              "How do I submit my application?",
            ].map((q) => (
              <div key={q} className="flex items-start gap-2">
                <MessageSquare size={14} className="text-cyan-600 mt-0.5 shrink-0" />
                <span className="text-sm text-slate-700">{q}</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
