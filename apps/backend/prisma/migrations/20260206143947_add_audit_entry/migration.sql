-- CreateTable
CREATE TABLE "AuditEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "timestamp" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "AuditEntry_timestamp_idx" ON "AuditEntry"("timestamp");
