-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopifyProductId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "vendor" TEXT,
    "productType" TEXT,
    "tags" TEXT,
    "imageUrl" TEXT,
    "shopifyCreatedAt" DATETIME NOT NULL,
    "shopifyUpdatedAt" DATETIME NOT NULL,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "shopifyVariantId" TEXT NOT NULL,
    "title" TEXT,
    "sku" TEXT,
    "price" DECIMAL,
    "compareAtPrice" DECIMAL,
    "availableForSale" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_shopifyProductId_key" ON "Product"("shopifyProductId");

-- CreateIndex
CREATE INDEX "Product_deletedAt_idx" ON "Product"("deletedAt");

-- CreateIndex
CREATE INDEX "Product_shopifyUpdatedAt_idx" ON "Product"("shopifyUpdatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_shopifyVariantId_key" ON "ProductVariant"("shopifyVariantId");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");
