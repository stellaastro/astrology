-- CreateTable
CREATE TABLE `privacy_requests` (
    `id` CHAR(26) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `lead_id` CHAR(26) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `completed_at` DATETIME(3) NULL,
    `ip` VARCHAR(45) NULL,
    `user_agent` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `privacy_requests_token_hash_key`(`token_hash`),
    INDEX `privacy_requests_lead_id_idx`(`lead_id`),
    INDEX `privacy_requests_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `privacy_requests` ADD CONSTRAINT `privacy_requests_lead_id_fkey` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
