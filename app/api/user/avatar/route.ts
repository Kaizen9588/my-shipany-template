import { respData, respErr } from "@/lib/resp";
import { getUserUuid } from "@/services/user";
import { getSupabaseClient } from "@/models/db";
import { getIsoTimestr } from "@/lib/time";
import { Storage, getStorageKey } from "@/lib/storage";
import { getUuid } from "@/lib/hash";

/**
 * POST /api/user/avatar —— 上传头像（6.11，S3 上传 UI）
 * multipart/form-data：file 字段
 *
 * L1 修复（对抗性测试）：此前仅校验 file.type 前缀 image/（客户端可控）且扩展名取自
 * 文件名 —— 可上传 image/svg+xml（SVG 内嵌 script，存储域 XSS 向量）并自定 Content-Type。
 * 现改为：白名单类型（png/jpeg/webp/gif）+ 魔数校验 + 服务端决定扩展名与 Content-Type。
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

    const buffer = Buffer.from(await file.arrayBuffer());
    // L1：魔数校验（不信任客户端 Content-Type/文件名）
    const detected = detectImageType(buffer);
    if (!detected) {
      return respErr("invalid image type (png/jpeg/webp/gif only)");
    }

    const key = getStorageKey(
      `avatars/${user_uuid}-${getUuid().slice(0, 8)}.${detected.ext}`
    );

    const storage = new Storage();
    const result = await storage.uploadFile({
      body: buffer,
      key,
      contentType: detected.mime,
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

/** L1：按魔数识别图片类型（拒绝 SVG/HTML 等可执行内容） */
function detectImageType(
  buf: Buffer
): { ext: string; mime: string } | null {
  if (
    buf.length > 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { ext: "png", mime: "image/png" };
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (
    buf.length > 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return { ext: "gif", mime: "image/gif" };
  }
  if (
    buf.length > 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}
