"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Settings, User, Bell, Shield, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DashboardSidebar } from "../_nav";

export default function SettingsPage() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    const sb = createClient();
    await sb.auth.signOut();
    router.push("/");
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <DashboardSidebar />
      <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-6 py-4 flex items-center gap-3">
          <button onClick={() => router.back()} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Settings</h1>
            <p className="text-xs text-slate-500">Account, notifications &amp; security</p>
          </div>
        </div>

        <div className="max-w-xl mx-auto px-6 py-10 space-y-4">
          {/* Account */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
              <User size={16} className="text-cyan-600" />
              <span className="text-sm font-semibold text-slate-800">Account</span>
            </div>
            <div className="px-5 py-4 space-y-3">
              <SettingRow label="Display name"     value="Coming soon" />
              <SettingRow label="Email address"    value="Managed via authentication" />
              <SettingRow label="Password"         value="Change via email link" />
            </div>
          </div>

          {/* Notifications */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
              <Bell size={16} className="text-cyan-600" />
              <span className="text-sm font-semibold text-slate-800">Notifications</span>
            </div>
            <div className="px-5 py-4 space-y-3">
              <SettingRow label="Email updates"    value="Coming soon" />
              <SettingRow label="Application alerts" value="Coming soon" />
            </div>
          </div>

          {/* Security */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
              <Shield size={16} className="text-cyan-600" />
              <span className="text-sm font-semibold text-slate-800">Security</span>
            </div>
            <div className="px-5 py-4 space-y-3">
              <SettingRow label="Two-factor auth"  value="Coming soon" />
              <SettingRow label="Active sessions"  value="Coming soon" />
            </div>
          </div>

          {/* Sign out */}
          <div className="bg-white border border-red-100 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-red-100 flex items-center gap-2">
              <LogOut size={16} className="text-red-500" />
              <span className="text-sm font-semibold text-slate-800">Sign out</span>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-slate-500 mb-4">You will be returned to the login screen.</p>
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-60"
              >
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm text-slate-400">{value}</span>
    </div>
  );
}
