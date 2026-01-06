-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `full_name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `phone_number` VARCHAR(191) NOT NULL,
    `role` ENUM('Maker', 'Checker') NOT NULL,
    `is_active` BOOLEAN NOT NULL,
    `must_change_password` BOOLEAN NOT NULL,
    `password_last_changed` DATETIME(3) NULL,
    `deactivated_at` DATETIME(3) NULL,
    `deactivated_by` INTEGER NULL,
    `deactivation_reason` VARCHAR(191) NULL,
    `deleted_by` INTEGER NULL,
    `force_logout` BOOLEAN NOT NULL DEFAULT false,
    `last_login` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserDetail` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `password_expiry_date` DATETIME(3) NULL,
    `failed_login_attempts` INTEGER NULL,
    `last_failed_login` DATETIME(3) NULL,
    `reason` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `UserDetail_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserSession` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `token` TEXT NOT NULL,
    `session_status` ENUM('active', 'inactive', 'terminated', 'timeout') NOT NULL,
    `login_time` DATETIME(3) NULL,
    `logout_time` DATETIME(3) NULL,
    `last_activity` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Currency` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `symbol` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Currency_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CurrencyPairRate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `base_currency_id` INTEGER NOT NULL,
    `quote_currency_id` INTEGER NOT NULL,
    `rate` DECIMAL(65, 30) NOT NULL,
    `effective_at` DATETIME(3) NOT NULL,
    `created_by` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Customer` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `phone_number` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `is_active` BOOLEAN NOT NULL,
    `created_by` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Customer_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Deal` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deal_number` VARCHAR(191) NOT NULL,
    `customer_id` INTEGER NOT NULL,
    `buy_currency_id` INTEGER NOT NULL,
    `sell_currency_id` INTEGER NOT NULL,
    `deal_type` ENUM('buy', 'sell') NOT NULL,
    `transaction_mode` ENUM('cash', 'credit') NOT NULL,
    `amount` DECIMAL(65, 30) NOT NULL,
    `exchange_rate` DECIMAL(65, 30) NOT NULL,
    `amount_to_be_paid` DECIMAL(65, 30) NOT NULL,
    `remarks` VARCHAR(191) NULL,
    `action_reason` VARCHAR(191) NULL,
    `status` ENUM('Pending', 'Completed') NOT NULL,
    `created_by` INTEGER NOT NULL,
    `action_by` INTEGER NULL,
    `action_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `Deal_deal_number_key`(`deal_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DealReceived` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deal_id` INTEGER NOT NULL,
    `currency_id` INTEGER NOT NULL,
    `price` VARCHAR(191) NOT NULL,
    `quantity` VARCHAR(191) NOT NULL,
    `total` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DealPaid` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `deal_id` INTEGER NOT NULL,
    `currency_id` INTEGER NOT NULL,
    `price` VARCHAR(191) NOT NULL,
    `quantity` VARCHAR(191) NOT NULL,
    `total` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Reconciliation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `status` ENUM('Tallied', 'Short', 'Excess', 'In_Progress') NOT NULL,
    `created_by` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReconciliationOpening` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reconciliation_id` INTEGER NOT NULL,
    `denomination` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,
    `amount` INTEGER NOT NULL,
    `exchange_rate` DECIMAL(65, 30) NOT NULL,
    `currency_id` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReconciliationClosing` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reconciliation_id` INTEGER NOT NULL,
    `denomination` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,
    `amount` INTEGER NOT NULL,
    `exchange_rate` DECIMAL(65, 30) NOT NULL,
    `currency_id` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReconciliationNote` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reconciliation_id` INTEGER NOT NULL,
    `note` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReconciliationDeal` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reconciliation_id` INTEGER NOT NULL,
    `deal_id` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `UserDetail` ADD CONSTRAINT `UserDetail_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserSession` ADD CONSTRAINT `UserSession_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CurrencyPairRate` ADD CONSTRAINT `CurrencyPairRate_base_currency_id_fkey` FOREIGN KEY (`base_currency_id`) REFERENCES `Currency`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CurrencyPairRate` ADD CONSTRAINT `CurrencyPairRate_quote_currency_id_fkey` FOREIGN KEY (`quote_currency_id`) REFERENCES `Currency`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Deal` ADD CONSTRAINT `Deal_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Deal` ADD CONSTRAINT `Deal_buy_currency_id_fkey` FOREIGN KEY (`buy_currency_id`) REFERENCES `Currency`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Deal` ADD CONSTRAINT `Deal_sell_currency_id_fkey` FOREIGN KEY (`sell_currency_id`) REFERENCES `Currency`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Deal` ADD CONSTRAINT `Deal_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Deal` ADD CONSTRAINT `Deal_action_by_fkey` FOREIGN KEY (`action_by`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DealReceived` ADD CONSTRAINT `DealReceived_deal_id_fkey` FOREIGN KEY (`deal_id`) REFERENCES `Deal`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DealReceived` ADD CONSTRAINT `DealReceived_currency_id_fkey` FOREIGN KEY (`currency_id`) REFERENCES `Currency`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DealPaid` ADD CONSTRAINT `DealPaid_deal_id_fkey` FOREIGN KEY (`deal_id`) REFERENCES `Deal`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DealPaid` ADD CONSTRAINT `DealPaid_currency_id_fkey` FOREIGN KEY (`currency_id`) REFERENCES `Currency`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Reconciliation` ADD CONSTRAINT `Reconciliation_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReconciliationOpening` ADD CONSTRAINT `ReconciliationOpening_reconciliation_id_fkey` FOREIGN KEY (`reconciliation_id`) REFERENCES `Reconciliation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReconciliationOpening` ADD CONSTRAINT `ReconciliationOpening_currency_id_fkey` FOREIGN KEY (`currency_id`) REFERENCES `Currency`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReconciliationClosing` ADD CONSTRAINT `ReconciliationClosing_reconciliation_id_fkey` FOREIGN KEY (`reconciliation_id`) REFERENCES `Reconciliation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReconciliationClosing` ADD CONSTRAINT `ReconciliationClosing_currency_id_fkey` FOREIGN KEY (`currency_id`) REFERENCES `Currency`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReconciliationNote` ADD CONSTRAINT `ReconciliationNote_reconciliation_id_fkey` FOREIGN KEY (`reconciliation_id`) REFERENCES `Reconciliation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReconciliationDeal` ADD CONSTRAINT `ReconciliationDeal_reconciliation_id_fkey` FOREIGN KEY (`reconciliation_id`) REFERENCES `Reconciliation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReconciliationDeal` ADD CONSTRAINT `ReconciliationDeal_deal_id_fkey` FOREIGN KEY (`deal_id`) REFERENCES `Deal`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
