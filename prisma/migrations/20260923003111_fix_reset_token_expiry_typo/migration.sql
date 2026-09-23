/*
  Warnings:

  - You are about to drop the column `restTokenExpiry` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "restTokenExpiry",
ADD COLUMN     "resetTokenExpiry" TIMESTAMP(3);
