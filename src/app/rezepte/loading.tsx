import { RecipeGridSkeleton } from "@/components/recipes/recipe-grid-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-8 w-40" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-36" />
        </div>
      </div>

      <Skeleton className="mt-6 h-10 w-full" />
      <Skeleton className="mt-4 h-9 w-48" />

      <RecipeGridSkeleton />
    </div>
  );
}
