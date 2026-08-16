import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Drizzle 类型化 schema（P3，与 data/install.sql + data/migrations/ 保持一致）
 *
 * ⚠️ 数据访问层暂保留手写 Supabase Client（DEVELOPMENT_PLAN 2.1 诚实标注），
 * Drizzle 先落地「类型化 schema 定义 + drizzle-kit 迁移生成」基础，
 * models 层改造为 Drizzle 查询留作后续渐进升级。
 */

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  uuid: varchar("uuid", { length: 255 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }),
  nickname: varchar("nickname", { length: 255 }),
  avatar_url: varchar("avatar_url", { length: 255 }),
  locale: varchar("locale", { length: 50 }),
  signin_type: varchar("signin_type", { length: 50 }),
  signin_ip: varchar("signin_ip", { length: 255 }),
  signin_provider: varchar("signin_provider", { length: 50 }),
  signin_openid: varchar("signin_openid", { length: 255 }),
  invite_code: varchar("invite_code", { length: 255 }).notNull().default(""),
  updated_at: timestamp("updated_at", { withTimezone: true }),
  invited_by: varchar("invited_by", { length: 255 }).notNull().default(""),
  is_affiliate: boolean("is_affiliate").notNull().default(false),
  // 6.4 密码登录
  password_hash: varchar("password_hash", { length: 255 }),
  password_updated_at: timestamp("password_updated_at", { withTimezone: true }),
  // 6.10 RBAC
  role: varchar("role", { length: 50 }).default("user"),
  // 6.7 状态
  status: varchar("status", { length: 50 }),
});

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  order_no: varchar("order_no", { length: 255 }).notNull().unique(),
  created_at: timestamp("created_at", { withTimezone: true }),
  user_uuid: varchar("user_uuid", { length: 255 }).notNull().default(""),
  user_email: varchar("user_email", { length: 255 }).notNull().default(""),
  amount: integer("amount").notNull(),
  interval: varchar("interval", { length: 50 }),
  expired_at: timestamp("expired_at", { withTimezone: true }),
  status: varchar("status", { length: 50 }).notNull(),
  payment_provider: varchar("payment_provider", { length: 50 }).default("stripe"),
  stripe_session_id: varchar("stripe_session_id", { length: 255 }),
  credits: integer("credits").notNull(),
  currency: varchar("currency", { length: 50 }),
  sub_id: varchar("sub_id", { length: 255 }),
  product_id: varchar("product_id", { length: 255 }),
  product_name: varchar("product_name", { length: 255 }),
  valid_months: integer("valid_months"),
  order_detail: text("order_detail"),
  paid_at: timestamp("paid_at", { withTimezone: true }),
  paid_email: varchar("paid_email", { length: 255 }),
  paid_detail: text("paid_detail"),
});

export const credits = pgTable("credits", {
  id: serial("id").primaryKey(),
  trans_no: varchar("trans_no", { length: 255 }).notNull().unique(),
  created_at: timestamp("created_at", { withTimezone: true }),
  user_uuid: varchar("user_uuid", { length: 255 }).notNull(),
  trans_type: varchar("trans_type", { length: 50 }).notNull(),
  credits: integer("credits").notNull(),
  order_no: varchar("order_no", { length: 255 }),
  expired_at: timestamp("expired_at", { withTimezone: true }),
});

export const apikeys = pgTable("apikeys", {
  id: serial("id").primaryKey(),
  api_key: varchar("api_key", { length: 255 }).notNull().unique(),
  title: varchar("title", { length: 100 }),
  user_uuid: varchar("user_uuid", { length: 255 }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }),
  status: varchar("status", { length: 50 }),
});

export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  uuid: varchar("uuid", { length: 255 }).notNull().unique(),
  slug: varchar("slug", { length: 255 }),
  title: varchar("title", { length: 255 }),
  description: text("description"),
  content: text("content"),
  created_at: timestamp("created_at", { withTimezone: true }),
  updated_at: timestamp("updated_at", { withTimezone: true }),
  status: varchar("status", { length: 50 }),
  cover_url: varchar("cover_url", { length: 255 }),
  author_name: varchar("author_name", { length: 255 }),
  author_avatar_url: varchar("author_avatar_url", { length: 255 }),
  locale: varchar("locale", { length: 50 }),
});

export const affiliates = pgTable("affiliates", {
  id: serial("id").primaryKey(),
  user_uuid: varchar("user_uuid", { length: 255 }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }),
  status: varchar("status", { length: 50 }).notNull().default(""),
  invited_by: varchar("invited_by", { length: 255 }).notNull(),
  paid_order_no: varchar("paid_order_no", { length: 255 }).notNull().default(""),
  paid_amount: integer("paid_amount").notNull().default(0),
  reward_percent: integer("reward_percent").notNull().default(0),
  reward_amount: integer("reward_amount").notNull().default(0),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  uuid: varchar("uuid", { length: 255 }).notNull().unique(),
  user_uuid: varchar("user_uuid", { length: 255 }).notNull(),
  type: varchar("type", { length: 50 }).notNull().default("system"),
  title: varchar("title", { length: 255 }).notNull().default(""),
  content: text("content"),
  is_read: boolean("is_read").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
