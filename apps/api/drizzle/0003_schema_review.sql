ALTER TABLE "lab_constraints" DROP CONSTRAINT "deduction_non_negative";--> statement-breakpoint
ALTER TABLE "submission_test_results" DROP CONSTRAINT "submission_test_results_test_id_lab_tests_id_fk";
--> statement-breakpoint
ALTER TABLE "verdicts" ADD COLUMN "explanation" text;--> statement-breakpoint
ALTER TABLE "submission_test_results" ADD CONSTRAINT "submission_test_results_test_id_lab_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."lab_tests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_constraints" ADD CONSTRAINT "deduction_range" CHECK ("lab_constraints"."deduction" BETWEEN 0 AND 10);--> statement-breakpoint
ALTER TABLE "labs" ADD CONSTRAINT "time_limit_range" CHECK ("labs"."time_limit_ms" BETWEEN 1000 AND 5000);--> statement-breakpoint
ALTER TABLE "labs" ADD CONSTRAINT "memory_limit_range" CHECK ("labs"."memory_limit_mb" BETWEEN 64 AND 512);