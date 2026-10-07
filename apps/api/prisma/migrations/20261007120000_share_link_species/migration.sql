-- 物种资料卡只读分享：把分享链接限定到具体物种（siteId + speciesId）。
-- SQLite 不支持 ALTER TABLE ADD CONSTRAINT，按 Prisma 规范重建 ShareLink。

-- CreateTable
CREATE TABLE "new_ShareLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "speciesId" TEXT,
    "ownerId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'TIMELINE',
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShareLink_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShareLink_speciesId_fkey" FOREIGN KEY ("speciesId") REFERENCES "Species" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShareLink_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CopyData（仅引用原表已存在的列；speciesId 在旧表上不存在，重建后保持 NULL）
INSERT INTO "new_ShareLink" ("id", "token", "siteId", "ownerId", "scope", "expiresAt", "revokedAt", "viewCount", "createdAt")
SELECT "id", "token", "siteId", "ownerId", "scope", "expiresAt", "revokedAt", "viewCount", "createdAt" FROM "ShareLink";

-- DropTable
DROP TABLE "ShareLink";

-- RenameTable
ALTER TABLE "new_ShareLink" RENAME TO "ShareLink";

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_token_key" ON "ShareLink"("token");

-- CreateIndex
CREATE INDEX "ShareLink_siteId_revokedAt_idx" ON "ShareLink"("siteId", "revokedAt");

-- CreateIndex
CREATE INDEX "ShareLink_speciesId_revokedAt_idx" ON "ShareLink"("speciesId", "revokedAt");
