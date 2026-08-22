import { cn } from "@/lib/utils";

// Skeletons, not spinners: the layout reserves its space so nothing shifts when data lands.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" className={cn("bg-muted animate-pulse rounded-md", className)} {...props} />;
}
export { Skeleton };
