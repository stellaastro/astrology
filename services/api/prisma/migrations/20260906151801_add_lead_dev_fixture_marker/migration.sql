-- AlterTable
ALTER TABLE `leads` ADD COLUMN `is_dev_fixture` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX `leads_is_dev_fixture_idx` ON `leads`(`is_dev_fixture`);
