import { cn } from "@/lib/utils"
import { ChevronDown, ChevronRight } from "lucide-react"

export function ExpandableListTrigger({
    expanded,
    onToggle,
    label,
    className,
}: {
    expanded: boolean
    onToggle: () => void
    label: string
    className?: string
}) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={label}
            className={cn("shrink-0 text-muted-foreground", className)}
        >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
    )
}

export function ResponsiveTableFrame({
    children,
    className,
}: {
    children: React.ReactNode
    className?: string
}) {
    return (
        <div className={cn("hidden overflow-hidden rounded-lg border md:block", className)}>
            {children}
        </div>
    )
}

export function MobileCardList({
    children,
    className,
}: {
    children: React.ReactNode
    className?: string
}) {
    return (
        <div className={cn("space-y-3 md:hidden", className)}>
            {children}
        </div>
    )
}

export function MobileDataCard({
    children,
    className,
    onClick,
}: {
    children: React.ReactNode
    className?: string
    onClick?: () => void
}) {
    return (
        <div
            className={cn(
                "rounded-lg border bg-background p-4 shadow-sm",
                onClick && "cursor-pointer active:bg-muted/50",
                className
            )}
            onClick={onClick}
        >
            {children}
        </div>
    )
}

export function MobileMetaRow({
    label,
    children,
}: {
    label: string
    children: React.ReactNode
}) {
    return (
        <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
            <div className="mt-0.5 text-sm text-foreground">{children}</div>
        </div>
    )
}
