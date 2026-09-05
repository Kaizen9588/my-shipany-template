import { Skeleton } from "@/components/ui/skeleton";

/**
 * 路由切换加载骨架屏：admin 后台与 console 控制台共用，
 * 放在各路由段的 loading.tsx 中，点击菜单后即时可见。
 */
export default function RouteLoadingSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}
