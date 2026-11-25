-- CreateIndex
CREATE INDEX "Application_studentId_appliedAt_idx" ON "Application"("studentId", "appliedAt");

-- CreateIndex
CREATE INDEX "Application_jobId_appliedAt_idx" ON "Application"("jobId", "appliedAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
