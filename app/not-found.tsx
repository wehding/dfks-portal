import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Siden findes ikke</h1>
        <p className="mt-2 max-w-md text-sm text-gray-500">
          Linket peger på en side, der ikke længere findes.
        </p>
      </div>
      <Button asChild>
        <Link href="/">Til forsiden</Link>
      </Button>
    </div>
  );
}
