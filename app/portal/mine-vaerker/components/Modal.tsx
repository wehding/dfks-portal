"use client";

import React from "react";

interface ModalProps {
  onClose: () => void;
  maxWidth?: string;
  children: React.ReactNode;
}

export function Modal({ onClose, maxWidth = "max-w-xl", children }: ModalProps) {
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`w-full ${maxWidth} max-h-[96svh] overflow-y-auto rounded-t-xl border bg-background p-4 text-foreground shadow-lg sm:max-h-[90vh] sm:rounded-xl sm:p-7`}>
        {children}
      </div>
    </div>
  );
}
