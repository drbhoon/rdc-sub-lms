import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { autoFit, styleHeader, workbookResponse } from "@/lib/excel-response";
import { routeCourseManager } from "@/lib/route-auth";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!await routeCourseManager(id)) return new Response("Forbidden", { status: 403 });
  const course = await db.course.findUnique({
    where: { id },
    select: {
      title: true,
      aiInteractions: {
        include: { employee: { include: { company: true } } },
        orderBy: { createdAt: "desc" },
        take: 50000,
      },
    },
  });
  if (!course) return new Response("Not found", { status: 404 });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Learner AI History");
  sheet.addRow([
    "Course",
    "Employee Code",
    "Learner",
    "Email",
    "Company",
    "Question",
    "AI Answer",
    "Status",
    "Error",
    "AI Model",
    "Answer Scope",
    "Asked At",
  ]);
  styleHeader(sheet.getRow(1));
  for (const interaction of course.aiInteractions) {
    sheet.addRow([
      course.title,
      interaction.employee.employeeCode,
      interaction.employee.name,
      interaction.employee.email,
      interaction.employee.company.name,
      interaction.question,
      interaction.answer ?? "",
      interaction.status,
      interaction.error ?? "",
      interaction.model ?? "",
      interaction.sourceRestricted ? "Published course material only" : "Extended",
      interaction.createdAt,
    ]);
  }
  sheet.getColumn(12).numFmt = "yyyy-mm-dd hh:mm";
  sheet.getColumn(6).alignment = { vertical: "top", wrapText: true };
  sheet.getColumn(7).alignment = { vertical: "top", wrapText: true };
  autoFit(sheet);
  sheet.getColumn(6).width = 48;
  sheet.getColumn(7).width = 60;
  sheet.getColumn(9).width = 40;
  return workbookResponse(workbook, `rdc-ai-history-${course.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.xlsx`);
}
