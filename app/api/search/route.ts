import { respData, respErr } from "@/lib/resp";
import { getSupabaseClient } from "@/models/db";

/**
 * GET /api/search?q=... —— 全站博客搜索（6.15）
 * PostgreSQL ILIKE 模糊匹配 title / description / content
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim();
    const locale = url.searchParams.get("locale") || "";

    if (!q) {
      return respData({ posts: [] });
    }

    const supabase = getSupabaseClient();
    let query = supabase
      .from("posts")
      .select("uuid, slug, title, description, cover_url, created_at, locale")
      .eq("status", "published")
      .or(`title.ilike.%${q}%,description.ilike.%${q}%,content.ilike.%${q}%`)
      .order("created_at", { ascending: false })
      .limit(20);

    if (locale) {
      query = query.eq("locale", locale);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    return respData({ posts: data || [] });
  } catch (e: any) {
    console.error("[search] failed:", e);
    return respErr("search failed");
  }
}
