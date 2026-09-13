-- SaaS Phase 1 (Foundation) — tenant-scoped query indexes.
--
-- None of these change behavior; they only give the planner an index
-- where one was structurally missing. Drizzle doesn't auto-index foreign
-- key columns, and none of these happen to be covered by a leading
-- prefix of an existing unique index — confirmed by querying pg_indexes
-- directly against the real project before writing this file, not
-- assumed. Invisible at today's single-tenant/demo scale (sequential
-- scans over a few hundred rows are instant); this is the one piece of
-- the multi-tenant SaaS work that's pure technical debt, decoupled from
-- everything else, and safe to ship on its own.
--
-- restaurant_staff(staff_user_id) is the one entry here with a direct
-- functional purpose beyond general scale: it's the exact access pattern
-- "which restaurants does this user belong to" that the upcoming
-- multi-restaurant staff context (Phase 5) will run on every request.

CREATE INDEX "audit_logs_restaurant_created_idx" ON "audit_logs" USING btree ("restaurant_id", "created_at" DESC);

CREATE INDEX "order_items_restaurant_idx" ON "order_items" USING btree ("restaurant_id");
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");

CREATE INDEX "order_item_options_order_item_idx" ON "order_item_options" USING btree ("order_item_id");

CREATE INDEX "order_status_history_restaurant_idx" ON "order_status_history" USING btree ("restaurant_id");
CREATE INDEX "order_status_history_order_idx" ON "order_status_history" USING btree ("order_id");

CREATE INDEX "table_qr_tokens_restaurant_idx" ON "table_qr_tokens" USING btree ("restaurant_id");

CREATE INDEX "table_sessions_restaurant_status_idx" ON "table_sessions" USING btree ("restaurant_id", "status");

CREATE INDEX "option_groups_menu_item_idx" ON "option_groups" USING btree ("menu_item_id");
CREATE INDEX "option_choices_option_group_idx" ON "option_choices" USING btree ("option_group_id");

CREATE INDEX "menus_restaurant_idx" ON "menus" USING btree ("restaurant_id");

CREATE INDEX "restaurant_staff_staff_user_idx" ON "restaurant_staff" USING btree ("staff_user_id");
