-- Reconciles drift: this column already exists in schema.prisma and was
-- already relied on by the app (grocery-lists.service.ts's "last edited"
-- footer), but no migration ever actually created it.
ALTER TABLE "GroceryListItem" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
