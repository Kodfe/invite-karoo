CREATE TYPE "public"."access_role" AS ENUM('owner', 'cohost');--> statement-breakpoint
CREATE TYPE "public"."admin_role" AS ENUM('admin', 'setup', 'support');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('new', 'in_setup', 'live', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."blast_kind" AS ENUM('rsvp_request', 'reminder');--> statement-breakpoint
CREATE TYPE "public"."blast_state" AS ENUM('queued', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."call_outcome" AS ENUM('none', 'answered', 'no_answer', 'wrong_number', 'call_back');--> statement-breakpoint
CREATE TYPE "public"."event_source" AS ENUM('manual', 'ai');--> statement-breakpoint
CREATE TYPE "public"."gift_method" AS ENUM('qr', 'manual');--> statement-breakpoint
CREATE TYPE "public"."lang" AS ENUM('en', 'hi', 'ta', 'gu');--> statement-breakpoint
CREATE TYPE "public"."notif_cat" AS ENUM('inv', 'rem', 'host', 'sys');--> statement-breakpoint
CREATE TYPE "public"."otp_purpose" AS ENUM('login', 'signup', 'change_number');--> statement-breakpoint
CREATE TYPE "public"."rsvp" AS ENUM('none', 'going', 'maybe', 'not_going');--> statement-breakpoint
CREATE TYPE "public"."side" AS ENUM('bride', 'groom');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'answered', 'closed');--> statement-breakpoint
CREATE TYPE "public"."wedding_status" AS ENUM('draft', 'active', 'paused', 'ended');--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "admin_role" DEFAULT 'setup' NOT NULL,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"image_key" text NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"wedding_id" uuid,
	"action" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"function_id" uuid NOT NULL,
	"kind" "blast_kind" NOT NULL,
	"state" "blast_state" DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"sent_by" text,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fcm_token" text NOT NULL,
	"platform" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "functions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"venue_name" text NOT NULL,
	"venue_address" text,
	"maps_url" text,
	"dress_code" text,
	"notes" text,
	"color" text DEFAULT '#7C5CBF' NOT NULL,
	"icon" text DEFAULT 'rings' NOT NULL,
	"gift_plan" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "gift_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"is_cash" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gifts_received" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"function_id" uuid NOT NULL,
	"guest_id" uuid,
	"giver_name" text NOT NULL,
	"giver_phone" text DEFAULT '' NOT NULL,
	"category_id" uuid NOT NULL,
	"amount" integer,
	"item_name" text,
	"note" text DEFAULT '' NOT NULL,
	"method" "gift_method" DEFAULT 'manual' NOT NULL,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"side" "side" NOT NULL,
	"relation" text DEFAULT '' NOT NULL,
	"expected_pax" integer DEFAULT 1 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_via" text DEFAULT 'xls' NOT NULL,
	"qr_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "host_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"phone" text NOT NULL,
	"status" "application_status" DEFAULT 'new' NOT NULL,
	"data" jsonb NOT NULL,
	"guest_file" jsonb,
	"guest_report" jsonb,
	"card_file" jsonb,
	"wedding_id" uuid,
	"assigned_to" uuid,
	"admin_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"function_id" uuid NOT NULL,
	"invited" boolean DEFAULT true NOT NULL,
	"notified_at" timestamp with time zone,
	"rsvp" "rsvp" DEFAULT 'none' NOT NULL,
	"pax" integer DEFAULT 0 NOT NULL,
	"responded_at" timestamp with time zone,
	"by_host" boolean DEFAULT false NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"gift_out" boolean DEFAULT false NOT NULL,
	"gift_out_given" boolean DEFAULT false NOT NULL,
	"gift_out_given_at" timestamp with time zone,
	"gift_out_given_by" text,
	"gift_out_method" "gift_method",
	"call_attempts" integer DEFAULT 0 NOT NULL,
	"last_called_at" timestamp with time zone,
	"call_outcome" "call_outcome" DEFAULT 'none' NOT NULL,
	"guest_reminders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"off_defaults" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"to" text NOT NULL,
	"template" text,
	"status" text NOT NULL,
	"provider_id" text,
	"error" text,
	"related_type" text,
	"related_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"cat" "notif_cat" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"long" text,
	"art" text,
	"action" jsonb DEFAULT '{"type":"none"}'::jsonb NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"pushed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nudges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"function_id" uuid,
	"audience" text NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"app_count" integer DEFAULT 0 NOT NULL,
	"message" text NOT NULL,
	"sent_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"purpose" "otp_purpose" NOT NULL,
	"code_hash" text NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"ticket" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"date" date NOT NULL,
	"time" text,
	"venue" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"icon" text DEFAULT 'calendar' NOT NULL,
	"image_url" text,
	"source" "event_source" DEFAULT 'manual' NOT NULL,
	"own_wedding" jsonb,
	"reminders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reminder_fires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invite_id" uuid NOT NULL,
	"offset_min" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_hash" text NOT NULL,
	"platform" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author" text NOT NULL,
	"admin_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"user_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"wedding_id" uuid,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"unread_for_user" integer DEFAULT 0 NOT NULL,
	"unread_for_team" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"first_name" text NOT NULL,
	"family_name" text NOT NULL,
	"city" text NOT NULL,
	"email" text,
	"photo_url" text,
	"lang" "lang" DEFAULT 'en' NOT NULL,
	"prefs" jsonb DEFAULT '{"wa":true,"push":true,"sms":false,"inv":true,"rem":true,"remAt":[1440,180],"nudge":true,"msgs":true,"quiet":false,"qFrom":"22:00","qTo":"07:00","pause":false}'::jsonb NOT NULL,
	"privacy" jsonb DEFAULT '{"city":true,"seen":true}'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wedding_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"name" text NOT NULL,
	"relation" text NOT NULL,
	"role" "access_role" DEFAULT 'cohost' NOT NULL,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wedding_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"type" text DEFAULT 'image' NOT NULL,
	"key" text NOT NULL,
	"url" text NOT NULL,
	"poster_url" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_phone" text NOT NULL,
	"contact_phone" text,
	"city" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"dates_locked" boolean DEFAULT true NOT NULL,
	"status" "wedding_status" DEFAULT 'draft' NOT NULL,
	"status_reason" text,
	"sending_enabled" boolean DEFAULT true NOT NULL,
	"bride" jsonb NOT NULL,
	"groom" jsonb NOT NULL,
	"bride_family" jsonb NOT NULL,
	"groom_family" jsonb NOT NULL,
	"card" jsonb,
	"voice" jsonb,
	"application_id" uuid,
	"handed_over_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_scans" ADD CONSTRAINT "ai_scans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blasts" ADD CONSTRAINT "blasts_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blasts" ADD CONSTRAINT "blasts_function_id_functions_id_fk" FOREIGN KEY ("function_id") REFERENCES "public"."functions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "functions" ADD CONSTRAINT "functions_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_categories" ADD CONSTRAINT "gift_categories_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts_received" ADD CONSTRAINT "gifts_received_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts_received" ADD CONSTRAINT "gifts_received_function_id_functions_id_fk" FOREIGN KEY ("function_id") REFERENCES "public"."functions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts_received" ADD CONSTRAINT "gifts_received_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gifts_received" ADD CONSTRAINT "gifts_received_category_id_gift_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."gift_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_applications" ADD CONSTRAINT "host_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_applications" ADD CONSTRAINT "host_applications_assigned_to_admin_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_function_id_functions_id_fk" FOREIGN KEY ("function_id") REFERENCES "public"."functions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nudges" ADD CONSTRAINT "nudges_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nudges" ADD CONSTRAINT "nudges_function_id_functions_id_fk" FOREIGN KEY ("function_id") REFERENCES "public"."functions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_events" ADD CONSTRAINT "personal_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_fires" ADD CONSTRAINT "reminder_fires_invite_id_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."invites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wedding_access" ADD CONSTRAINT "wedding_access_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wedding_media" ADD CONSTRAINT "wedding_media_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weddings" ADD CONSTRAINT "weddings_created_by_admin_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_email_uq" ON "admin_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "audit_wedding_idx" ON "audit_log" USING btree ("wedding_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "blasts_fn_kind_uq" ON "blasts" USING btree ("function_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "blasts_idem_uq" ON "blasts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_token_uq" ON "devices" USING btree ("fcm_token");--> statement-breakpoint
CREATE INDEX "functions_wedding_idx" ON "functions" USING btree ("wedding_id","starts_at");--> statement-breakpoint
CREATE INDEX "gifts_wedding_fn_idx" ON "gifts_received" USING btree ("wedding_id","function_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guests_live_phone_uq" ON "guests" USING btree ("wedding_id","phone") WHERE "guests"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "guests_qr_uq" ON "guests" USING btree ("qr_token");--> statement-breakpoint
CREATE INDEX "guests_phone_idx" ON "guests" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "apps_status_idx" ON "host_applications" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_guest_fn_uq" ON "invites" USING btree ("guest_id","function_id");--> statement-breakpoint
CREATE INDEX "invites_fn_idx" ON "invites" USING btree ("function_id");--> statement-breakpoint
CREATE INDEX "invites_wedding_idx" ON "invites" USING btree ("wedding_id");--> statement-breakpoint
CREATE INDEX "msglog_related_idx" ON "message_log" USING btree ("related_type","related_id");--> statement-breakpoint
CREATE INDEX "notif_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "nudges_wedding_idx" ON "nudges" USING btree ("wedding_id","created_at");--> statement-breakpoint
CREATE INDEX "otp_phone_idx" ON "otp_codes" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "events_user_date_idx" ON "personal_events" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "fires_uq" ON "reminder_fires" USING btree ("invite_id","offset_min","starts_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ticket_msgs_idx" ON "ticket_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "tickets_user_idx" ON "tickets" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_number_uq" ON "tickets" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_live" ON "users" USING btree ("phone") WHERE "users"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "access_live_uq" ON "wedding_access" USING btree ("wedding_id","phone") WHERE "wedding_access"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "media_wedding_idx" ON "wedding_media" USING btree ("wedding_id","kind","sort");--> statement-breakpoint
CREATE INDEX "weddings_owner_idx" ON "weddings" USING btree ("owner_phone");