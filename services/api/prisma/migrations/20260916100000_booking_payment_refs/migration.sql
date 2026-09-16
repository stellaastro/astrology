-- Phase 7: the gateway's two identifiers on the booking they paid for.
--
-- Additive only.
--
-- BOTH ARE UNIQUE, and that is the point rather than tidiness.
--
--   order_id   one Razorpay order belongs to exactly one booking. Without the
--              index, a bug that reused an order across two bookings would
--              confirm whichever the webhook found first.
--   payment_id one payment applies to exactly one booking, ONCE. Gateways
--              retry webhooks; the application dedupes on the event id, and
--              this is the database saying the same thing independently, so a
--              deduplication bug cannot become a double confirmation.
--
-- NULL is exempt from a MySQL unique index, which is what lets every unpaid
-- booking coexist — the same property ADR-029 relies on for slot_key.
ALTER TABLE `bookings`
    ADD COLUMN `razorpay_order_id` VARCHAR(64) NULL AFTER `captured_paise`,
    ADD COLUMN `razorpay_payment_id` VARCHAR(64) NULL AFTER `razorpay_order_id`,
    ADD UNIQUE INDEX `bookings_razorpay_order_id_key` (`razorpay_order_id`),
    ADD UNIQUE INDEX `bookings_razorpay_payment_id_key` (`razorpay_payment_id`);
