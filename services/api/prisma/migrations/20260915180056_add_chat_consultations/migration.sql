-- reviewed: this migration DROPS `recording_assessments` and recreates the same
-- queue as `consultation_assessments`, keyed to the consultation rather than to
-- a recording.
--
-- WHY IT IS SAFE HERE AND WOULD NOT BE LATER: the table is EMPTY in both
-- development and production — verified by counting rows in each before writing
-- this — because nothing has ever run an assessment. Once a single review
-- exists this becomes a rename-and-backfill, not a drop.
--
-- WHY THE CHANGE: a chat consultation has a transcript rather than a recording
-- and needs exactly the same review gate. Keying the queue to Recording would
-- have meant a second, parallel pipeline for chat, and a second place for the
-- rule that a machine result is only ever a draft to be forgotten (ADR-051).

/*
  Warnings:

  - You are about to drop the `recording_assessments` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `recording_assessments` DROP FOREIGN KEY `recording_assessments_recording_id_fkey`;

-- AlterTable
ALTER TABLE `consultations` ADD COLUMN `modality` VARCHAR(8) NOT NULL DEFAULT 'voice';

-- DropTable
DROP TABLE `recording_assessments`;

-- CreateTable
CREATE TABLE `consultation_assessments` (
    `id` CHAR(26) NOT NULL,
    `consultation_id` CHAR(26) NOT NULL,
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

    UNIQUE INDEX `consultation_assessments_consultation_id_key`(`consultation_id`),
    INDEX `consultation_assessments_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `chat_messages` (
    `id` CHAR(26) NOT NULL,
    `consultation_id` CHAR(26) NOT NULL,
    `sender` VARCHAR(16) NOT NULL,
    `sender_user_id` CHAR(26) NOT NULL,
    `body` TEXT NOT NULL,
    `sent_at` DATETIME(3) NOT NULL,
    `redacted_at` DATETIME(3) NULL,

    INDEX `chat_messages_consultation_id_sent_at_idx`(`consultation_id`, `sent_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `consultation_assessments` ADD CONSTRAINT `consultation_assessments_consultation_id_fkey` FOREIGN KEY (`consultation_id`) REFERENCES `consultations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_consultation_id_fkey` FOREIGN KEY (`consultation_id`) REFERENCES `consultations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
