"use client";

import { X } from "lucide-react";
import React from "react";

type ModalShellProps = {
  title: React.ReactNode;
  onClose: () => void;
  onBackdropClose?: () => void;
  error?: string | null;
  children: React.ReactNode;
  maxWidthClass?: string;
  glowClass?: string;
};

export default function ModalShell({
  title,
  onClose,
  onBackdropClose = onClose,
  error,
  children,
  maxWidthClass = "max-w-[400px]",
  glowClass = "bg-indigo-500/5",
}: ModalShellProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={onBackdropClose} />
      <div className={`relative w-full ${maxWidthClass} max-h-[90vh] flex flex-col rounded-[20px] bg-white border border-[#E6E9F0] shadow-2xl p-6 my-auto overflow-hidden`}>
        <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full ${glowClass} blur-[80px] pointer-events-none`} />
        <div className="flex justify-between items-center mb-4 border-b border-[#E6E9F0] pb-3 shrink-0">
          <h3 className="text-sm font-bold text-[#0E1726]">{title}</h3>
          <button onClick={onClose} className="text-[#6B7488] hover:text-[#0E1726] transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        {error && <div className="p-3 mb-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs shrink-0 font-medium">{error}</div>}
        <div className="overflow-y-auto flex-1 pr-1">
          {children}
        </div>
      </div>
    </div>
  );
}
