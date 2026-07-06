import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const emails = (process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (emails.length !== 2) {
    throw new Error("SUPER_ADMIN_EMAILS must contain exactly two comma-separated addresses");
  }

  for (const email of emails) {
    const user = await prisma.user.upsert({ where: { email }, update: {}, create: { email } });
    for (const role of [UserRole.SUPER_ADMIN, UserRole.TEACHER, UserRole.LEARNER]) {
      await prisma.userRoleGrant.upsert({
        where: { userId_role: { userId: user.id, role } },
        update: {},
        create: { userId: user.id, role },
      });
    }
  }
}

main().finally(() => prisma.$disconnect());
