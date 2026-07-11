import ExcelJS from "exceljs";
import { UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { autoFit, styleHeader, workbookResponse } from "@/lib/excel-response";
import { routeUserWithRole } from "@/lib/route-auth";

export async function GET() {
  if (!await routeUserWithRole(UserRole.SUPER_ADMIN)) return new Response("Forbidden", { status: 403 });

  const employees = await db.employee.findMany({
    include: {
      company: true,
      user: { include: { roles: true, coursesTaught: { include: { course: true } } } },
      enrollments: { include: { course: true }, orderBy: { enrolledAt: "desc" } },
    },
    orderBy: [{ company: { name: "asc" } }, { name: "asc" }],
    take: 10000,
  });

  const workbook = new ExcelJS.Workbook();
  const master = workbook.addWorksheet("Employee Master");
  master.addRow([
    "Employee Code",
    "Name",
    "Email",
    "Company",
    "Department",
    "Designation",
    "Location/Plant",
    "Status",
    "Roles",
    "Manager",
    "Mobile",
    "Enrolled Courses",
    "Completed Courses",
    "Created At",
    "Updated At",
  ]);
  styleHeader(master.getRow(1));
  for (const employee of employees) {
    master.addRow([
      employee.employeeCode,
      employee.name,
      employee.email,
      employee.company.name,
      employee.department,
      employee.designation,
      employee.locationPlant ?? "",
      employee.status,
      employee.user?.roles.map((role) => role.role).sort().join(", ") ?? "",
      employee.managerName ?? "",
      employee.mobileNumber ?? "",
      employee.enrollments.length,
      employee.enrollments.filter((enrollment) => enrollment.status === "COMPLETED").length,
      employee.createdAt,
      employee.updatedAt,
    ]);
  }
  master.getColumn(14).numFmt = "yyyy-mm-dd hh:mm";
  master.getColumn(15).numFmt = "yyyy-mm-dd hh:mm";
  autoFit(master);

  const enrollments = workbook.addWorksheet("Course Enrollments");
  enrollments.addRow(["Employee Code", "Name", "Email", "Company", "Course", "Course Status", "Enrollment Status", "Enrolled At", "Started At", "Completed At"]);
  styleHeader(enrollments.getRow(1));
  for (const employee of employees) {
    for (const enrollment of employee.enrollments) {
      enrollments.addRow([
        employee.employeeCode,
        employee.name,
        employee.email,
        employee.company.name,
        enrollment.course.title,
        enrollment.course.status,
        enrollment.status,
        enrollment.enrolledAt,
        enrollment.startedAt ?? "",
        enrollment.completedAt ?? "",
      ]);
    }
  }
  enrollments.getColumn(8).numFmt = "yyyy-mm-dd hh:mm";
  enrollments.getColumn(9).numFmt = "yyyy-mm-dd hh:mm";
  enrollments.getColumn(10).numFmt = "yyyy-mm-dd hh:mm";
  autoFit(enrollments);

  const teachers = workbook.addWorksheet("Teacher Assignments");
  teachers.addRow(["Employee Code", "Name", "Email", "Company", "Course", "Course Status"]);
  styleHeader(teachers.getRow(1));
  for (const employee of employees) {
    for (const assignment of employee.user?.coursesTaught ?? []) {
      teachers.addRow([
        employee.employeeCode,
        employee.name,
        employee.email,
        employee.company.name,
        assignment.course.title,
        assignment.course.status,
      ]);
    }
  }
  autoFit(teachers);

  return workbookResponse(workbook, "rdc-lms-employee-data.xlsx");
}
