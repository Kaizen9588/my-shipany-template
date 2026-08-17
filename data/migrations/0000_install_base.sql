-- 0000 基础表（基线）——数据来源于 data/drizzle/0000_certain_manta.sql（Drizzle schema 基准）
-- 说明：此前的 automated migrations 从 0001 起，缺少 users/orders/credits 等基础表，
-- 导致 0003 引用 orders 时报错“relation does not exist”。本迁移补齐基线。
-- 0006/0007/0008 中的 ADD COLUMN IF NOT EXISTS 对该基线是幂等空操作。
CREATE TABLE IF NOT EXISTS "affiliates" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_uuid" varchar(255) NOT NULL,
	"created_at" timestamp with time zone,
	"status" varchar(50) DEFAULT '' NOT NULL,
	"invited_by" varchar(255) NOT NULL,
	"paid_order_no" varchar(255) DEFAULT '' NOT NULL,
	"paid_amount" integer DEFAULT 0 NOT NULL,
	"reward_percent" integer DEFAULT 0 NOT NULL,
	"reward_amount" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "apikeys" (
	"id" serial PRIMARY KEY NOT NULL,
	"api_key" varchar(255) NOT NULL,
	"title" varchar(100),
	"user_uuid" varchar(255) NOT NULL,
	"created_at" timestamp with time zone,
	"status" varchar(50),
	CONSTRAINT "apikeys_api_key_unique" UNIQUE("api_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"trans_no" varchar(255) NOT NULL,
	"created_at" timestamp with time zone,
	"user_uuid" varchar(255) NOT NULL,
	"trans_type" varchar(50) NOT NULL,
	"credits" integer NOT NULL,
	"order_no" varchar(255),
	"expired_at" timestamp with time zone,
	CONSTRAINT "credits_trans_no_unique" UNIQUE("trans_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" varchar(255) NOT NULL,
	"user_uuid" varchar(255) NOT NULL,
	"type" varchar(50) DEFAULT 'system' NOT NULL,
	"title" varchar(255) DEFAULT '' NOT NULL,
	"content" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "notifications_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_no" varchar(255) NOT NULL,
	"created_at" timestamp with time zone,
	"user_uuid" varchar(255) DEFAULT '' NOT NULL,
	"user_email" varchar(255) DEFAULT '' NOT NULL,
	"amount" integer NOT NULL,
	"interval" varchar(50),
	"expired_at" timestamp with time zone,
	"status" varchar(50) NOT NULL,
	"payment_provider" varchar(50) DEFAULT 'stripe',
	"stripe_session_id" varchar(255),
	"credits" integer NOT NULL,
	"currency" varchar(50),
	"sub_id" varchar(255),
	"product_id" varchar(255),
	"product_name" varchar(255),
	"valid_months" integer,
	"order_detail" text,
	"paid_at" timestamp with time zone,
	"paid_email" varchar(255),
	"paid_detail" text,
	CONSTRAINT "orders_order_no_unique" UNIQUE("order_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" varchar(255) NOT NULL,
	"slug" varchar(255),
	"title" varchar(255),
	"description" text,
	"content" text,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"status" varchar(50),
	"cover_url" varchar(255),
	"author_name" varchar(255),
	"author_avatar_url" varchar(255),
	"locale" varchar(50),
	CONSTRAINT "posts_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"uuid" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"created_at" timestamp with time zone,
	"nickname" varchar(255),
	"avatar_url" varchar(255),
	"locale" varchar(50),
	"signin_type" varchar(50),
	"signin_ip" varchar(255),
	"signin_provider" varchar(50),
	"signin_openid" varchar(255),
	"invite_code" varchar(255) DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone,
	"invited_by" varchar(255) DEFAULT '' NOT NULL,
	"is_affiliate" boolean DEFAULT false NOT NULL,
	"password_hash" varchar(255),
	"password_updated_at" timestamp with time zone,
	"role" varchar(50) DEFAULT 'user',
	"status" varchar(50),
	CONSTRAINT "users_uuid_unique" UNIQUE("uuid")
);
