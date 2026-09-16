-- Phase 6: the columns the booking LIFECYCLE needs, as opposed to the columns
-- the booking SNAPSHOT needs (those landed with 20260915151218_add_bookings).
--
-- Additive only. No column is dropped, no type narrowed, nothing rewritten.

-- MODALITY: voice or chat.
--
-- Consultation.modality already exists, but a Consultation is created in Phase
-- 8 when people actually join, and the modality is chosen at BOOKING — it is
-- what decides which price snapshot is taken. Voice freezes an amount; chat
-- freezes an authorised ceiling and a per-minute rate (ADR-052). Waiting for
-- the consultation row to learn which product was sold would mean the price
-- was computed before the thing that determines it was known.
--
-- It is NOT derived from `chat_rate_per_minute_paise IS NULL`. That trick works
-- until someone stores a rate on a voice booking for reference, and then every
-- reader of the table is silently wrong. A product is a column.
ALTER TABLE `bookings`
    ADD COLUMN `modality` VARCHAR(8) NOT NULL DEFAULT 'voice' AFTER `slot_end`;

-- WHO cancelled, and why.
--
-- The refund policy (O4) and the no-show path both turn on this: a customer
-- cancelling ninety minutes ahead and an astrologer cancelling ninety seconds
-- ahead are the same row today, and they must never be the same refund.
ALTER TABLE `bookings`
    ADD COLUMN `cancelled_by` VARCHAR(16) NULL AFTER `cancelled_at`,
    ADD COLUMN `cancel_reason` VARCHAR(200) NULL AFTER `cancelled_by`;

-- RESCHEDULE COUNT (task 6.6).
--
-- A reschedule moves this row to a new slot rather than creating a second row,
-- so without a counter the history of "this booking has been moved four times"
-- exists only in the audit log, and a policy limit cannot be enforced from
-- there on the request path.
ALTER TABLE `bookings`
    ADD COLUMN `reschedule_count` INT NOT NULL DEFAULT 0 AFTER `cancel_reason`;

-- Backfill is unnecessary: every existing row is 'voice' with zero
-- reschedules, which is exactly what the defaults give them.
