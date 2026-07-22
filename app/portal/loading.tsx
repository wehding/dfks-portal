import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function PortalLoading() {
  return <div className="space-y-6"><div className="space-y-2"><Skeleton className="h-8 w-64" /><Skeleton className="h-4 w-80 max-w-full" /></div><div className="grid gap-6 lg:grid-cols-2">{[0, 1].map(card => <Card key={card}><CardHeader><Skeleton className="h-6 w-40" /></CardHeader><CardContent className="space-y-3">{[0, 1, 2].map(row => <Skeleton key={row} className="h-16 w-full" />)}</CardContent></Card>)}</div></div>;
}
