-- CreateTable
CREATE TABLE "DiscoveredTool" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "connectionId" TEXT NOT NULL,
    "connectionName" TEXT NOT NULL
);
