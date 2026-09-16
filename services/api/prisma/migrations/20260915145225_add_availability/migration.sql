-- AlterTable
ALTER TABLE `astrologers` ADD COLUMN `buffer_minutes` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `availability_rules` (
    `id` CHAR(26) NOT NULL,
    `astrologer_id` CHAR(26) NOT NULL,
    `weekday` TINYINT NOT NULL,
    `start_minute` INTEGER NOT NULL,
    `end_minute` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `availability_rules_astrologer_id_weekday_idx`(`astrologer_id`, `weekday`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `availability_blocks` (
    `id` CHAR(26) NOT NULL,
    `astrologer_id` CHAR(26) NOT NULL,
    `starts_at` DATETIME(3) NOT NULL,
    `ends_at` DATETIME(3) NOT NULL,
    `reason` VARCHAR(160) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `availability_blocks_astrologer_id_starts_at_idx`(`astrologer_id`, `starts_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `availability_rules` ADD CONSTRAINT `availability_rules_astrologer_id_fkey` FOREIGN KEY (`astrologer_id`) REFERENCES `astrologers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `availability_blocks` ADD CONSTRAINT `availability_blocks_astrologer_id_fkey` FOREIGN KEY (`astrologer_id`) REFERENCES `astrologers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
