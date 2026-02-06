-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "attachment_ids" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ChatAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Colleague" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "description" TEXT NOT NULL DEFAULT '',
    "responsibilities" TEXT NOT NULL DEFAULT '',
    "allowed_connections" TEXT NOT NULL DEFAULT '[]',
    "allowed_skills" TEXT NOT NULL DEFAULT '[]',
    "memory" TEXT NOT NULL DEFAULT '{"scope":"role"}',
    "reporting" TEXT NOT NULL DEFAULT '{"on":["task_complete","uncertainty"]}'
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "execute_at" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "context" TEXT NOT NULL DEFAULT '{}'
);

-- CreateTable
CREATE TABLE "MCPConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "ChatMessage_userId_createdAt_idx" ON "ChatMessage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatAttachment_userId_createdAt_idx" ON "ChatAttachment"("userId", "createdAt");
