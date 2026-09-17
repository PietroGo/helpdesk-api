/*
  Warnings:

  - You are about to drop the column `cnpj` on the `User` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "User_cnpj_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "cnpj";
