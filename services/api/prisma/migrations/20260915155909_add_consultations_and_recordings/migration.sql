-- DropIndex
DROP INDEX `bookings_slot_key_key` ON `bookings`;

-- CreateTable
CREATE TABLE `consultations` (
    `id` CHAR(26) NOT NULL,
    `booking_id` CHAR(26) NOT NULL,
    `room_id` VARCHAR(64) NULL,
    `started_at` DATETIME(3) NULL,
    `ended_at` DATETIME(3) NULL,
    `astrologer_joined_at` DATETIME(3) NULL,
    `customer_joined_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `consultations_booking_id_key`(`booking_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recording_consents` (
    `id` CHAR(26) NOT NULL,
    `consultation_id` CHAR(26) NOT NULL,
    `party` VARCHAR(16) NOT NULL,
    `user_id` CHAR(26) NOT NULL,
    `granted` BOOLEAN NOT NULL,
    `policy_version` VARCHAR(32) NOT NULL,
    `decided_at` DATETIME(3) NOT NULL,
    `withdrawn_at` DATETIME(3) NULL,

    INDEX `recording_consents_user_id_idx`(`user_id`),
    UNIQUE INDEX `recording_consents_consultation_id_party_key`(`consultation_id`, `party`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recordings` (
    `id` CHAR(26) NOT NULL,
    `consultation_id` CHAR(26) NOT NULL,
    `object_key` VARCHAR(255) NULL,
    `duration_seconds` INTEGER NULL,
    `size_bytes` INTEGER NULL,
    `status` VARCHAR(16) NOT NULL,
    `expires_at` DATETIME(3) NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_reason` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `recordings_consultation_id_key`(`consultation_id`),
    INDEX `recordings_status_expires_at_idx`(`status`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recording_assessments` (
    `id` CHAR(26) NOT NULL,
    `recording_id` CHAR(26) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `abuse_flagged` BOOLEAN NOT NULL DEFAULT false,
    `abuse_confidence` INTEGER NULL,
    `machine_notes` TEXT NULL,
    `reviewer_id` CHAR(26) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `reviewer_verdict` VARCHAR(16) NULL,
    `reviewer_notes` TEXT NULL,
    `grade` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `recording_assessments_recording_id_key`(`recording_id`),
    INDEX `recording_assessments_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `consultations` ADD CONSTRAINT `consultations_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `recording_consents` ADD CONSTRAINT `recording_consents_consultation_id_fkey` FOREIGN KEY (`consultation_id`) REFERENCES `consultations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recordings` ADD CONSTRAINT `recordings_consultation_id_fkey` FOREIGN KEY (`consultation_id`) REFERENCES `consultations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recording_assessments` ADD CONSTRAINT `recording_assessments_recording_id_fkey` FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
