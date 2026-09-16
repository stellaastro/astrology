-- AlterTable
ALTER TABLE `astrologers` ADD COLUMN `chat_max_minutes` INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN `chat_rate_per_minute_paise` INTEGER NULL;

-- AlterTable
ALTER TABLE `bookings` ADD COLUMN `captured_paise` INTEGER NULL,
    ADD COLUMN `chat_rate_per_minute_paise` INTEGER NULL;

-- AlterTable
ALTER TABLE `consultations` ADD COLUMN `billable_seconds` INTEGER NULL,
    ADD COLUMN `idle_seconds_excluded` INTEGER NULL,
    ADD COLUMN `meter_started_at` DATETIME(3) NULL,
    ADD COLUMN `meter_stopped_at` DATETIME(3) NULL;
