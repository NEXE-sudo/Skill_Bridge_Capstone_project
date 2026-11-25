import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL must be configured");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function main() {
  const now = new Date();
  const retentionCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  try {
    const [accountTokens, sessions] = await prisma.$transaction([
      prisma.accountToken.deleteMany({
        where: { OR: [{ expiresAt: { lt: now } }, { consumedAt: { lt: retentionCutoff } }] },
      }),
      prisma.sessionToken.deleteMany({
        where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: retentionCutoff } }] },
      }),
    ]);
    console.info(`Removed ${accountTokens.count} expired/old account tokens and ${sessions.count} expired/old sessions.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Failed to clean expired auth records", error);
  process.exitCode = 1;
});
