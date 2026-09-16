-- AlterTable
ALTER TABLE "GroceryListItem" ADD COLUMN     "label" TEXT,
ALTER COLUMN "ingredientId" DROP NOT NULL;
