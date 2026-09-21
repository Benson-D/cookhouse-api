-- CreateTable
CREATE TABLE "GroceryCategoryOverride" (
    "id" TEXT NOT NULL,
    "clerkOrgId" TEXT NOT NULL,
    "ingredientId" TEXT,
    "label" TEXT,
    "category" TEXT NOT NULL,

    CONSTRAINT "GroceryCategoryOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroceryCategoryOverride_clerkOrgId_idx" ON "GroceryCategoryOverride"("clerkOrgId");

-- CreateIndex
CREATE INDEX "GroceryCategoryOverride_ingredientId_idx" ON "GroceryCategoryOverride"("ingredientId");
