-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "label" TEXT,
ALTER COLUMN "ingredientId" DROP NOT NULL;
