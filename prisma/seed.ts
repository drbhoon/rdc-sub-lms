import { EmployeeStatus, PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();
const ADMIN_COMPANY_NAME = "RDC Concrete (India) Limited";

function adminEmployeeCode(email: string) {
  const normalized = email.toUpperCase().replace(/[^A-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return `ADMIN-${normalized.slice(0, 48)}`;
}

function adminDisplayName(email: string) {
  const localPart = email.split("@")[0] || email;
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || email;
}

async function main() {
  const emails = (process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (emails.length !== 2) {
    throw new Error("SUPER_ADMIN_EMAILS must contain exactly two comma-separated addresses");
  }

  const adminCompany = await prisma.company.upsert({
    where: { name: ADMIN_COMPANY_NAME },
    update: {},
    create: { name: ADMIN_COMPANY_NAME },
  });

  for (const email of emails) {
    const existingEmployee = await prisma.employee.findUnique({ where: { email } });
    const employee = existingEmployee
      ? await prisma.employee.update({
        where: { id: existingEmployee.id },
        data: { status: EmployeeStatus.ACTIVE },
      })
      : await prisma.employee.create({
        data: {
          employeeCode: adminEmployeeCode(email),
          name: adminDisplayName(email),
          email,
          department: "Administration",
          designation: "Super Admin",
          locationPlant: "Corporate",
          status: EmployeeStatus.ACTIVE,
          companyId: adminCompany.id,
        },
      });

    const user = await prisma.user.upsert({
      where: { email },
      update: { employeeId: employee.id },
      create: { email, employeeId: employee.id },
    });
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
