import { User } from "@/types/user";
import { getIsoTimestr } from "@/lib/time";
import { getSupabaseClient } from "./db";
import { likeFilter } from "@/lib/postgrest";

export async function insertUser(user: User) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("users").insert(user);

  if (error) {
    throw error;
  }

  return data;
}

export async function findUserByEmail(
  email: string,
  provider?: string
): Promise<User | undefined> {
  const supabase = getSupabaseClient();
  let query = supabase.from("users").select("*").eq("email", email).limit(1);
  if (provider) {
    // P-1.11：同邮箱多 provider 场景按 (email, provider) 匹配
    query = query.eq("signin_provider", provider);
  }
  const { data, error } = await query.single();

  if (error) {
    return undefined;
  }

  return data;
}

export async function findUserByUuid(uuid: string): Promise<User | undefined> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("uuid", uuid)
    .single();

  if (error) {
    return undefined;
  }

  return data;
}

export async function getUsers(
  page: number = 1,
  limit: number = 50
): Promise<User[] | undefined> {
  if (page < 1) page = 1;
  if (limit <= 0) limit = 50;

  const offset = (page - 1) * limit;
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return undefined;
  }

  return data;
}

export async function updateUserInviteCode(
  user_uuid: string,
  invite_code: string
) {
  const supabase = getSupabaseClient();
  const updated_at = getIsoTimestr();
  const { data, error } = await supabase
    .from("users")
    .update({ invite_code, updated_at })
    .eq("uuid", user_uuid);

  if (error) {
    throw error;
  }

  return data;
}

export async function updateUserInvitedBy(
  user_uuid: string,
  invited_by: string
) {
  const supabase = getSupabaseClient();
  const updated_at = getIsoTimestr();
  const { data, error } = await supabase
    .from("users")
    .update({ invited_by, updated_at })
    .eq("uuid", user_uuid);

  if (error) {
    throw error;
  }

  return data;
}

export async function getUsersByUuids(user_uuids: string[]): Promise<User[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .in("uuid", user_uuids);
  if (error) {
    return [];
  }

  return data as User[];
}

export async function findUserByInviteCode(invite_code: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("invite_code", invite_code)
    .single();

  if (error) {
    return undefined;
  }

  return data;
}

export async function getUserUuidsByEmail(email: string) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .select("uuid")
    .eq("email", email);
  if (error) {
    return [];
  }

  return data.map((user) => user.uuid);
}

// ---------- 6.7 后台用户管理 ----------

export async function searchUsers(
  keyword: string = "",
  page: number = 1,
  limit: number = 20
): Promise<User[] | undefined> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("users")
    .select("*")
    .order("created_at", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (keyword) {
    query = query.or(
      `${likeFilter("email", keyword)},${likeFilter("nickname", keyword)},${likeFilter("uuid", keyword)}`
    );
  }

  const { data, error } = await query;
  if (error) {
    return undefined;
  }
  return data;
}

export async function countUsers(): Promise<number> {
  const supabase = getSupabaseClient();
  const { count, error } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true });
  if (error) {
    return 0;
  }
  return count || 0;
}

/** 管理员更新用户（角色/状态等） */
export async function updateUserByAdmin(
  uuid: string,
  fields: Partial<Pick<User, "role" | "status" | "nickname">>
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("users")
    .update({ ...fields, updated_at: getIsoTimestr() })
    .eq("uuid", uuid);
  if (error) {
    throw error;
  }
}

/** 0037：登录时刻刷新最近登录设备/时间与国家（注册字段不覆盖；调用方吞错） */
export async function updateUserLoginEnv(
  user_uuid: string,
  fields: {
    last_login_device?: string;
    last_login_at?: string;
    country?: string;
  }
): Promise<void> {
  const payload = Object.fromEntries(
    Object.entries({ ...fields, updated_at: getIsoTimestr() }).filter(
      ([, v]) => v !== undefined
    )
  );
  if (Object.keys(payload).length <= 1) {
    return;
  }
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("users")
    .update(payload)
    .eq("uuid", user_uuid);
  if (error) {
    throw error;
  }
}
