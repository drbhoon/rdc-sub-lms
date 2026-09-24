import { describe, expect, it } from "vitest";
import { teacherRoleMessage } from "./teacher-role-email";

describe("teacher role e-mail", () => {
  it("uses HR's wording and links to the LMS sign-in page", () => {
    const { subject, text, html } = teacherRoleMessage({ name: "Meena Iyer", email: "meena.iyer@rdc.in" }, "https://hr.rdcc.ai/lms/");
    expect(subject).toBe("RDC Learning: You have been assigned the role of Teacher");
    expect(text).toContain("You have been assigned the role of “Teacher.” Please login using this link:");
    expect(text).toContain("https://hr.rdcc.ai/lms/login");
    expect(html).toContain('<a href="https://hr.rdcc.ai/lms/login">');
  });

  it("tells them which address to sign in with", () => {
    const { text } = teacherRoleMessage({ name: "Meena Iyer", email: "meena.iyer@rdc.in" }, "https://hr.rdcc.ai/lms");
    expect(text).toContain("(meena.iyer@rdc.in)");
  });

  it("escapes names in the HTML part", () => {
    const { html } = teacherRoleMessage({ name: "<b>O'Brien</b>", email: "ob@rdc.in" }, "https://hr.rdcc.ai/lms");
    expect(html).toContain("&lt;b&gt;O&#39;Brien&lt;/b&gt;");
    expect(html).not.toContain("<b>O'Brien</b>");
  });
});
