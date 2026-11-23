CREATE TYPE "public"."submission_status" AS ENUM('queued', 'judging', 'accepted', 'wrong_answer', 'compile_error', 'time_limit', 'memory_limit', 'runtime_error');--> statement-breakpoint
CREATE TYPE "public"."test_status" AS ENUM('accepted', 'wrong_answer', 'time_limit', 'memory_limit', 'runtime_error');--> statement-breakpoint
CREATE TYPE "public"."unsure_reason" AS ENUM('model_unsure', 'bad_schema', 'evidence_mismatch', 'timeout', 'cost_limit', 'model_off');--> statement-breakpoint
CREATE TYPE "public"."verdict_source" AS ENUM('hard_rule', 'model');--> statement-breakpoint
CREATE TYPE "public"."verdict_value" AS ENUM('pass', 'violation', 'unsure');--> statement-breakpoint
CREATE TABLE "lab_constraints" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lab_constraints_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"lab_id" integer NOT NULL,
	"code" text NOT NULL,
	"text" text NOT NULL,
	"deduction" integer NOT NULL,
	CONSTRAINT "lab_constraints_labId_code_unique" UNIQUE("lab_id","code"),
	CONSTRAINT "deduction_non_negative" CHECK ("lab_constraints"."deduction" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lab_tests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lab_tests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"lab_id" integer NOT NULL,
	"position" integer NOT NULL,
	"input" text NOT NULL,
	"expected_output" text NOT NULL,
	CONSTRAINT "lab_tests_labId_position_unique" UNIQUE("lab_id","position")
);
--> statement-breakpoint
CREATE TABLE "model_calls" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "model_calls_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"submission_id" integer NOT NULL,
	"provider_request_id" text,
	"model" text NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"duration_ms" integer NOT NULL,
	"cost_usd" numeric(12, 6),
	"prompt" text NOT NULL,
	"response" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_test_results" (
	"submission_id" integer NOT NULL,
	"test_id" integer NOT NULL,
	"status" "test_status" NOT NULL,
	"time_ms" integer,
	"memory_kb" integer,
	CONSTRAINT "submission_test_results_submission_id_test_id_pk" PRIMARY KEY("submission_id","test_id")
);
--> statement-breakpoint
CREATE TABLE "verdicts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "verdicts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"submission_id" integer NOT NULL,
	"constraint_id" integer NOT NULL,
	"verdict" "verdict_value" NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" "verdict_source" NOT NULL,
	"unsure_reason" "unsure_reason",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verdicts_submissionId_constraintId_unique" UNIQUE("submission_id","constraint_id"),
	CONSTRAINT "unsure_reason_iff_unsure" CHECK (("verdicts"."verdict" = 'unsure') = ("verdicts"."unsure_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "status" SET DEFAULT 'queued'::"public"."submission_status";--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "status" SET DATA TYPE "public"."submission_status" USING "status"::"public"."submission_status";--> statement-breakpoint
ALTER TABLE "labs" ADD COLUMN "time_limit_ms" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "labs" ADD COLUMN "memory_limit_mb" integer DEFAULT 256 NOT NULL;--> statement-breakpoint
ALTER TABLE "lab_constraints" ADD CONSTRAINT "lab_constraints_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_test_results" ADD CONSTRAINT "submission_test_results_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_test_results" ADD CONSTRAINT "submission_test_results_test_id_lab_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."lab_tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_constraint_id_lab_constraints_id_fk" FOREIGN KEY ("constraint_id") REFERENCES "public"."lab_constraints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_calls_submission_id_index" ON "model_calls" USING btree ("submission_id");