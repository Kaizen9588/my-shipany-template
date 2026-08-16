export interface Apikey {
  /** P-1.5：只存 SHA-256 哈希，不存明文 */
  api_key: string;
  /** 明文 key 前缀（前 8 字符），用于列表展示 */
  key_prefix?: string;
  title: string;
  user_uuid: string;
  created_at: string;
  status: string;
}
