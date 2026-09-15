-- AlterTable
ALTER TABLE `users` ADD COLUMN `fixture_dataset` VARCHAR(64) NULL,
    ADD COLUMN `is_dev_fixture` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX `users_is_dev_fixture_idx` ON `users`(`is_dev_fixture`);

-- CreateIndex
CREATE INDEX `users_fixture_dataset_idx` ON `users`(`fixture_dataset`);
