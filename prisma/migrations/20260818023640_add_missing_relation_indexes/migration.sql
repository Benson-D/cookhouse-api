-- CreateIndex
CREATE INDEX "GroceryListItem_unitId_idx" ON "GroceryListItem"("unitId");

-- CreateIndex
CREATE INDEX "GroceryListItem_addedById_idx" ON "GroceryListItem"("addedById");

-- CreateIndex
CREATE INDEX "GroceryListItem_checkedById_idx" ON "GroceryListItem"("checkedById");

-- CreateIndex
CREATE INDEX "MeasurementUnit_baseUnitId_idx" ON "MeasurementUnit"("baseUnitId");

-- CreateIndex
CREATE INDEX "Purchase_userId_idx" ON "Purchase"("userId");

-- CreateIndex
CREATE INDEX "Purchase_unitId_idx" ON "Purchase"("unitId");

-- CreateIndex
CREATE INDEX "Purchase_receiptId_idx" ON "Purchase"("receiptId");

-- CreateIndex
CREATE INDEX "Receipt_storeId_idx" ON "Receipt"("storeId");
