import { getSupabaseClient } from "@/models/db";
import { getUserCredits } from "@/services/credit";
import { getUserUuid } from "@/services/user";
import Empty from "@/components/blocks/empty";
import moment from "moment";

/**
 * 用量统计（6.13）：积分使用历史 + API 调用记录，按日/周/月聚合
 */
export default async function UsagePage() {
  const user_uuid = await getUserUuid();
  if (!user_uuid) {
    return <Empty message="no auth" />;
  }

  const credits = await getUserCredits(user_uuid);
  const supabase = getSupabaseClient();

  // 全部积分流水
  const { data: allCredits } = await supabase
    .from("credits")
    .select("*")
    .eq("user_uuid", user_uuid)
    .order("created_at", { ascending: true });

  const rows = allCredits || [];

  // 按日聚合（近 30 天）
  const daily = new Map<string, number>();
  // 按周聚合（近 12 周）
  const weekly = new Map<string, number>();
  // 按月聚合（近 12 月）
  const monthly = new Map<string, number>();

  rows.forEach((c: any) => {
    if (c.credits >= 0) {
      return; // 只统计消耗
    }
    const spent = Math.abs(c.credits);
    const d = moment(c.created_at);
    const dayKey = d.format("MM-DD");
    const weekKey = d.format("YYYY-[W]ww");
    const monthKey = d.format("YYYY-MM");
    daily.set(dayKey, (daily.get(dayKey) || 0) + spent);
    weekly.set(weekKey, (weekly.get(weekKey) || 0) + spent);
    monthly.set(monthKey, (monthly.get(monthKey) || 0) + spent);
  });

  // API 调用记录（ai_generate / ping 扣费流水）
  const apiCalls = rows
    .filter((c: any) => ["ai_generate", "ai_refund", "ping"].includes(c.trans_type))
    .slice()
    .reverse()
    .slice(0, 30);

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">Usage</h3>

      <div className="rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">Current balance</p>
        <p className="text-3xl font-semibold">{credits.left_credits} credits</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border p-4">
          <h4 className="mb-2 text-sm font-medium">Daily (last 30d)</h4>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {[...daily.entries()]
              .slice(-30)
              .reverse()
              .map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span className="text-muted-foreground">{k}</span>
                  <span>-{v}</span>
                </li>
              ))}
          </ul>
        </div>
        <div className="rounded-lg border p-4">
          <h4 className="mb-2 text-sm font-medium">Weekly (last 12w)</h4>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {[...weekly.entries()]
              .slice(-12)
              .reverse()
              .map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span className="text-muted-foreground">{k}</span>
                  <span>-{v}</span>
                </li>
              ))}
          </ul>
        </div>
        <div className="rounded-lg border p-4">
          <h4 className="mb-2 text-sm font-medium">Monthly (last 12m)</h4>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {[...monthly.entries()]
              .slice(-12)
              .reverse()
              .map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span className="text-muted-foreground">{k}</span>
                  <span>-{v}</span>
                </li>
              ))}
          </ul>
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <h4 className="mb-3 text-sm font-medium">Recent API Calls</h4>
        {apiCalls.length === 0 ? (
          <p className="text-sm text-muted-foreground">No API calls yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2">Time</th>
                <th>Type</th>
                <th>Credits</th>
                <th>Trans No</th>
              </tr>
            </thead>
            <tbody>
              {apiCalls.map((c: any) => (
                <tr key={c.trans_no} className="border-b">
                  <td className="py-2">
                    {moment(c.created_at).format("MM-DD HH:mm")}
                  </td>
                  <td>{c.trans_type}</td>
                  <td className={c.credits > 0 ? "text-green-600" : "text-red-600"}>
                    {c.credits > 0 ? `+${c.credits}` : c.credits}
                  </td>
                  <td className="font-mono text-xs">{c.trans_no.slice(-10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
