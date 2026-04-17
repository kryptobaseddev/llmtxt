-- T393: Clean break — delete Yrs CRDT state and rename yrs_state → crdt_state.
--
-- Design decision DR-P1-02: Clean break from Yrs to Loro.
-- No Yrs state is worth preserving.

-- Step 1: Delete all pending Yrs update rows
DELETE FROM `section_crdt_updates`;
--> statement-breakpoint

-- Step 2: Delete all Yrs consolidated state rows
DELETE FROM `section_crdt_states`;
--> statement-breakpoint

-- Step 3: Rename the column
ALTER TABLE `section_crdt_states` RENAME COLUMN `yrs_state` TO `crdt_state`;
