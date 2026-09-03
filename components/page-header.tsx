"use client";

import type React from "react";
import { usePageMetadata } from "@/components/page-metadata";

export interface PageHeaderProps {
    title: string
    subtitle?: string
    actions?: React.ReactNode
    hideTitleOnMobile?: boolean
    mobileBreakpoint?: "sm" | "md"
}

export function PageHeader({ title, subtitle, actions, hideTitleOnMobile = true, mobileBreakpoint = "sm" }: PageHeaderProps) {
    void hideTitleOnMobile
    void mobileBreakpoint
    usePageMetadata(title, subtitle ?? null)

    return (
        <div className="flex min-w-0 max-w-full flex-col gap-4 sm:flex-row sm:items-start sm:justify-end">
            <h2 className="sr-only">{title}</h2>
            {actions && (
                <div className="flex min-w-0 max-w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
                    {actions}
                </div>
            )}
        </div>
    )
}
