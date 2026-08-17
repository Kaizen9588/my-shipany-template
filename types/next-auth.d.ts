import { DefaultSession } from "next-auth";

interface SessionUserFields {
  uuid?: string;
  nickname?: string;
  avatar_url?: string;
  created_at?: string;
  email?: string;
  mustChangePassword?: boolean;
  role?: string;
  status?: string;
}

declare module "next-auth" {
  interface Session {
    user: SessionUserFields & DefaultSession["user"];
  }
}
