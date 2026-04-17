-- T393: Clean break — truncate Yrs CRDT state tables and rename yrs_state → crdt_state.
--
-- Design decision DR-P1-02: We have zero production Yrs CRDT state worth
-- preserving. Loro is the only format from this point forward.
-- No migration script converting Yrs blobs → Loro blobs is needed or run.

-- Step 1: Truncate pending Yrs update rows (no data worth keeping)
TRUNCATE TABLE "section_crdt_updates";
--> statement-breakpoint

-- Step 2: Truncate Yrs consolidated state rows
TRUNCATE TABLE "section_crdt_states";
--> statement-breakpoint

-- Step 3: Rename the column to remove library coupling
ALTER TABLE "section_crdt_states" RENAME COLUMN "yrs_state" TO "crdt_state";
