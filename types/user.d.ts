export interface User {
  id?: number;
  uuid?: string;
  email: string;
  created_at?: string;
  nickname: string;
  avatar_url: string;
  locale?: string;
  signin_type?: string;
  signin_ip?: string;
  signin_provider?: string;
  signin_openid?: string;
  /** 6.4 邮箱密码登录：bcrypt 哈希（OAuth 用户为 null，绝不含明文） */
  password_hash?: string;
  password_updated_at?: string;
  /** 6.10 RBAC：super_admin / admin / operator / user */
  role?: string;
  /** 账号状态：active / banned（6.7 用户管理） */
  status?: string;
  credits?: UserCredits;
  invite_code?: string;
  invited_by?: string;
  is_affiliate?: boolean;
}

export interface UserCredits {
  // P-1.8 问题 3：删除从未实现的幽灵字段（one_time_credits/monthly_credits 等），
  // 类型与实际行为保持一致
  left_credits: number;
  is_recharged?: boolean;
  is_pro?: boolean;
}
