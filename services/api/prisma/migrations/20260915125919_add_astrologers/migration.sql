-- AlterTable
ALTER TABLE `leads` ADD COLUMN `fixture_dataset` VARCHAR(64) NULL;

-- CreateTable
CREATE TABLE `astrologers` (
    `id` CHAR(26) NOT NULL,
    `user_id` CHAR(26) NULL,
    `slug` VARCHAR(80) NOT NULL,
    `name_hi` VARCHAR(120) NOT NULL,
    `name_en` VARCHAR(120) NOT NULL,
    `headline` VARCHAR(160) NULL,
    `bio` TEXT NULL,
    `experience_years` INTEGER NOT NULL,
    `languages` JSON NOT NULL,
    `specialisations` JSON NOT NULL,
    `session_rate_paise` INTEGER NOT NULL,
    `session_minutes` INTEGER NOT NULL DEFAULT 30,
    `photo_key` VARCHAR(255) NULL,
    `published_at` DATETIME(3) NULL,
    `retired_at` DATETIME(3) NULL,
    `is_dev_fixture` BOOLEAN NOT NULL DEFAULT false,
    `fixture_dataset` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `astrologers_user_id_key`(`user_id`),
    UNIQUE INDEX `astrologers_slug_key`(`slug`),
    INDEX `astrologers_published_at_idx`(`published_at`),
    INDEX `astrologers_retired_at_idx`(`retired_at`),
    INDEX `astrologers_is_dev_fixture_idx`(`is_dev_fixture`),
    INDEX `astrologers_fixture_dataset_idx`(`fixture_dataset`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `astrologers` ADD CONSTRAINT `astrologers_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
