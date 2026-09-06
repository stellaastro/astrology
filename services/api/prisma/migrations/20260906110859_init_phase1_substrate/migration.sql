-- CreateTable
CREATE TABLE `leads` (
    `id` CHAR(26) NOT NULL,
    `email` VARCHAR(320) NOT NULL,
    `phone` VARCHAR(16) NULL,
    `locale` VARCHAR(10) NOT NULL DEFAULT 'hi',
    `source` VARCHAR(64) NULL,
    `referral_code` VARCHAR(32) NULL,
    `utm_source` VARCHAR(128) NULL,
    `utm_medium` VARCHAR(128) NULL,
    `utm_campaign` VARCHAR(128) NULL,
    `consent_at` DATETIME(3) NOT NULL,
    `consent_policy_version` VARCHAR(32) NOT NULL,
    `confirmed_at` DATETIME(3) NULL,
    `confirmation_token` CHAR(43) NULL,
    `turnstile_bypassed` BOOLEAN NOT NULL DEFAULT false,
    `ip` VARCHAR(45) NULL,
    `user_agent` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `leads_email_key`(`email`),
    UNIQUE INDEX `leads_confirmation_token_key`(`confirmation_token`),
    INDEX `leads_created_at_idx`(`created_at`),
    INDEX `leads_referral_code_idx`(`referral_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_events` (
    `id` CHAR(26) NOT NULL,
    `actor_id` CHAR(26) NULL,
    `actor_role` VARCHAR(32) NULL,
    `action` VARCHAR(64) NOT NULL,
    `target_type` VARCHAR(64) NOT NULL,
    `target_id` VARCHAR(64) NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `reason` TEXT NULL,
    `ip` VARCHAR(45) NULL,
    `session_id` CHAR(26) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_events_actor_id_created_at_idx`(`actor_id`, `created_at`),
    INDEX `audit_events_target_type_target_id_idx`(`target_type`, `target_id`),
    INDEX `audit_events_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idempotency_keys` (
    `key` VARCHAR(255) NOT NULL,
    `scope` VARCHAR(64) NOT NULL,
    `request_hash` CHAR(64) NOT NULL,
    `response` JSON NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'in_progress',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `idempotency_keys_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `outbox_messages` (
    `id` CHAR(26) NOT NULL,
    `topic` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_error` TEXT NULL,
    `available_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `outbox_messages_processed_at_available_at_idx`(`processed_at`, `available_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
