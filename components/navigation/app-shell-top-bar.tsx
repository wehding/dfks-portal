import { cn } from "@/lib/utils";

export function AppShellTopBar({ className, ...props }: React.ComponentProps<"header">) {
  return (
    <header
      data-app-shell-topbar
      className={cn(
        "sticky top-0 z-40 flex h-14 w-full min-w-0 shrink-0 items-center gap-2 border-b bg-background/95 px-2.5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:h-12 sm:px-4 sm:shadow-none",
        className,
      )}
      {...props}
    />
  );
}
