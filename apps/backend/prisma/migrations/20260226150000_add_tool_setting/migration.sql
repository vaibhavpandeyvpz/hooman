-- CreateTable
CREATE TABLE "ToolSetting" (
    "toolId" TEXT NOT NULL PRIMARY KEY,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "allowEveryTime" BOOLEAN NOT NULL DEFAULT false
);
