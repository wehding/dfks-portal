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
            className={cn("inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
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
        <div className={cn("hidden min-w-0 max-w-full overflow-x-auto rounded-lg border md:block", className)}>
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
        <div className={cn("min-w-0 max-w-full space-y-3 md:hidden", className)}>
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
                "min-w-0 max-w-full overflow-hidden rounded-lg border bg-background p-4 shadow-sm",
                onClick && "cursor-pointer active:bg-muted/50",
                className
            )}
            onClick={onClick}
            role={onClick ? "button" : undefined}
            tabIndex={onClick ? 0 : undefined}
            onKeyDown={onClick ? event => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    onClick()
                }
            } : undefined}
        >
            {children}
        </div>
    )
}

export function SummaryGrid({ children, className }: { children: React.ReactNode; className?: string }) {
    return <div className={cn("grid min-w-0 max-w-full grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:gap-3", className)}>{children}</div>
}

export function SummaryCard({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
    return <div className={cn("min-w-0 rounded-lg border bg-card px-3 py-3 text-card-foreground sm:flex sm:min-w-44 sm:items-center sm:justify-between sm:gap-4 sm:px-4 sm:py-2.5", className)}>
        <p className="line-clamp-2 min-h-8 text-[11px] font-medium leading-4 text-muted-foreground sm:min-h-0 sm:line-clamp-1 sm:text-sm">{label}</p>
        <p className="mt-1 text-xl font-bold tabular-nums text-foreground sm:mt-0 sm:text-xl">{value}</p>
    </div>
}

export function ListFilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
    return <div className={cn("grid min-w-0 max-w-full gap-2 rounded-lg border bg-card p-3 sm:flex sm:flex-wrap sm:items-center", className)}>{children}</div>
}

export function EmptyState({ title, description, action, className }: { title: string; description?: string; action?: React.ReactNode; className?: string }) {
    return <div className={cn("flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-6 text-center", className)}>
        <p className="font-medium text-foreground">{title}</p>
        {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
        {action && <div className="mt-4">{action}</div>}
    </div>
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
