import { respData, respErr } from "@/lib/resp";
import { getUserUuid } from "@/services/user";
import { getSupabaseClient } from "@/models/db";
import { getIsoTimestr } from "@/lib/time";
import { Storage, getStorageKey } from "@/lib/storage";
import { getUuid } from "@/lib/hash";

/**
 * POST /api/user/avatar —— 上传头像（6.11，S3 上传 UI）
 * multipart/form-data：file 字段
 */
export async function POST(req: Request) {
  try {
    const user_uuid = await getUserUuid();
    if (!user_uuid) {
      return respErr("no auth", 401);
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return respErr("file is required");
    }

    if (file.size > 2 * 1024 * 1024) {
      return respErr("file too large (max 2MB)");
    }
    if (!file.type.startsWith("image/")) {
      return respErr("invalid file type");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.split(".").pop() || "png";
    const key = getStorageKey(`avatars/${user_uuid}-${getUuid().slice(0, 8)}.${ext}`);

    const storage = new Storage();
    const result = await storage.uploadFile({
      body: buffer,
      key,
      contentType: file.type,
      disposition: "inline",
    });

    const avatarUrl = result.url;

    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("users")
      .update({ avatar_url: avatarUrl, updated_at: getIsoTimestr() })
      .eq("uuid", user_uuid);
    if (error) {
      throw error;
    }

    return respData({ avatar_url: avatarUrl });
  } catch (e: any) {
    console.error("[user/avatar] failed:", e);
    return respErr("upload avatar failed: " + e.message);
  }
}
