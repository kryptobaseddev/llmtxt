-- T393: Clean break — truncate Yrs CRDT state tables and rename yrs_state → crdt_state.
--
-- Design decision DR-P1-02: We have zero local Yrs CRDT state worth
-- preserving. Loro is the only format from this point forward.

-- Step 1: Delete all pending Yrs update rows
DELETE FROM `section_crdt_updates`;
--> statement-breakpoint

-- Step 2: Delete all Yrs consolidated state rows
DELETE FROM `section_crdt_states`;
--> statement-breakpoint

-- Step 3: Rename the column to remove library coupling
-- SQLite 3.25+ supports ALTER TABLE RENAME COLUMN
ALTER TABLE `section_crdt_states` RENAME COLUMN `yrs_state` TO `crdt_state`;
