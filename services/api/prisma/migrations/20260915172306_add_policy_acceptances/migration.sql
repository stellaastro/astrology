-- CreateTable
CREATE TABLE `policy_acceptances` (
    `id` CHAR(26) NOT NULL,
    `user_id` CHAR(26) NOT NULL,
    `policy` VARCHAR(32) NOT NULL,
    `version` VARCHAR(32) NOT NULL,
    `accepted` BOOLEAN NOT NULL,
    `accepted_at` DATETIME(3) NOT NULL,
    `ip` VARCHAR(45) NULL,
    `user_agent` VARCHAR(255) NULL,
    `withdrawn_at` DATETIME(3) NULL,

    INDEX `policy_acceptances_user_id_policy_idx`(`user_id`, `policy`),
    UNIQUE INDEX `policy_acceptances_user_id_policy_version_key`(`user_id`, `policy`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `policy_acceptances` ADD CONSTRAINT `policy_acceptances_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
