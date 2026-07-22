import { TableSkeleton } from "@/components/ui/data-skeletons";

export default function Loading() {
  return <TableSkeleton columns={6} rows={6} />;
}
