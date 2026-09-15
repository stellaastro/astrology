-- CreateTable
CREATE TABLE `bookings` (
    `id` CHAR(26) NOT NULL,
    `astrologer_id` CHAR(26) NOT NULL,
    `customer_id` CHAR(26) NOT NULL,
    `slot_start` DATETIME(3) NOT NULL,
    `slot_end` DATETIME(3) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    -- SLOT OCCUPANCY (ADR-029). A STORED GENERATED column, written by MySQL and
    -- never by the application.
    --
    -- MySQL 8 has NO partial or filtered unique indexes. A plain
    -- UNIQUE(astrologer_id, slot_start) — the PostgreSQL habit — would block a
    -- slot FOR EVER after one cancellation, surfacing as astrologers asking why
    -- their afternoons vanished.
    --
    -- MySQL does permit unlimited NULLs in a unique index, so a column that is
    -- NULL for rows which do not occupy their slot gives exactly the filtered
    -- uniqueness needed.
    --
    -- OCCUPYING BY DEFAULT: the CASE lists the statuses that FREE the slot, so
    -- a status added later occupies until someone decides otherwise. That way
    -- the failure mode of forgetting is a slot that looks busy — visible and
    -- annoying — rather than one sold twice.
    --
    -- The expression must be deterministic, so it cannot consult NOW(). An
    -- expired hold therefore keeps its slot until the reaper flips its status,
    -- which is what makes the hold durable rather than a clock the database
    -- reads (task 6.2).
    `slot_key` VARCHAR(64)
        GENERATED ALWAYS AS (
            CASE WHEN `status` IN ('cancelled', 'expired')
                 THEN NULL
                 ELSE CONCAT(`astrologer_id`, '#', `slot_start`)
            END
        ) STORED,
    `price_paise` INTEGER NOT NULL,
    `session_minutes` INTEGER NOT NULL,
    `taxable_value_paise` INTEGER NULL,
    `tax_rate_bp` INTEGER NULL,
    `tax_amount_paise` INTEGER NULL,
    `sac_code` VARCHAR(16) NULL,
    `place_of_supply` VARCHAR(2) NULL,
    `hold_expires_at` DATETIME(3) NULL,
    `confirmed_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `idempotency_key` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bookings_idempotency_key_key`(`idempotency_key`),
    -- The invariant: one occupying booking per astrologer per slot. NULLs are
    -- exempt, which is the entire point.
    UNIQUE INDEX `bookings_slot_key_key`(`slot_key`),
    INDEX `bookings_astrologer_id_slot_start_idx`(`astrologer_id`, `slot_start`),
    INDEX `bookings_customer_id_idx`(`customer_id`),
    INDEX `bookings_status_hold_expires_at_idx`(`status`, `hold_expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_astrologer_id_fkey` FOREIGN KEY (`astrologer_id`) REFERENCES `astrologers`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;
-- ON UPDATE NO ACTION, not CASCADE, and this is a MySQL requirement rather than
-- a choice: a foreign key whose column feeds a STORED GENERATED column cannot
-- use CASCADE. astrologer_id feeds slot_key, so CASCADE fails with error 1215 —
-- which reports as "cannot add foreign key constraint" and says nothing about
-- generated columns. Verified by adding both variants by hand.
-- It costs nothing: ULIDs are never updated.

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
