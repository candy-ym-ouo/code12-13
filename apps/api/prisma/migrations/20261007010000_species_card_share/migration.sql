-- 物种资料卡分享：ShareLink 从"仅地点"扩展为"地点或物种"二选一。
-- SQLite 不支持直接把列改为可空，按 Prisma 迁移规范重建表。
PRAGMA foreign_keys=OFF;

-- RedefineTables
CREATE TABLE "new_ShareLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "siteId" TEXT,
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

INSERT INTO "new_ShareLink" ("id", "token", "siteId", "speciesId", "ownerId", "scope", "expiresAt", "revokedAt", "viewCount", "createdAt")
SELECT "id", "token", "siteId", NULL, "ownerId", "scope", "expiresAt", "revokedAt", "viewCount", "createdAt" FROM "ShareLink";

DROP TABLE "ShareLink";
ALTER TABLE "new_ShareLink" RENAME TO "ShareLink";

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_token_key" ON "ShareLink"("token");

-- CreateIndex
CREATE INDEX "ShareLink_siteId_revokedAt_idx" ON "ShareLink"("siteId", "revokedAt");

-- CreateIndex
CREATE INDEX "ShareLink_speciesId_revokedAt_idx" ON "ShareLink"("speciesId", "revokedAt");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
