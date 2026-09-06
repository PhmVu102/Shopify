-- CreateTable
CREATE TABLE "ProductVector" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "embedding" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    "dimensions" INTEGER NOT NULL DEFAULT 1536,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductVector_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductVector_productId_key" ON "ProductVector"("productId");

-- CreateIndex
CREATE INDEX "ProductVector_productId_idx" ON "ProductVector"("productId");
