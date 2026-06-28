"use client";

import React from "react";

interface ModalProps {
  onClose: () => void;
  maxWidth?: string;
  children: React.ReactNode;
}

export function Modal({ onClose, maxWidth = "max-w-xl", children }: ModalProps) {
  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3 sm:p-6"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`bg-white rounded-xl border border-gray-200 w-full ${maxWidth} max-h-[90vh] overflow-y-auto p-4 sm:p-7`}>
        {children}
      </div>
    </div>
  );
}
