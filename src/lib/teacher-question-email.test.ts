import { describe, expect, it } from "vitest";
import { teacherQuestionMessage } from "./teacher-question-email";

const input = {
  teacherEmail: "meena.iyer@rdc.in",
  teacherName: "Meena Iyer",
  learnerName: "Ravi Kumar",
  learnerCode: "A00388",
  classroomName: "Class Room 07",
  courseId: "course123",
  courseTitle: "Concrete Basics",
  question: "Why is <b>water</b> addition at site risky & what should I say?",
};

describe("teacher question e-mail", () => {
  it("names the learner, their classroom and the course, and links to the teacher's course page", () => {
    const message = teacherQuestionMessage(input, "https://hr.rdcc.ai/lms/");
    expect(message.subject).toBe("RDC Learning: question from Ravi Kumar - Concrete Basics");
    expect(message.text).toContain("Ravi Kumar (A00388, Class Room 07) has asked you a question");
    expect(message.text).toContain("https://hr.rdcc.ai/lms/teacher/courses/course123");
    expect(message.text).toContain(input.question);
  });

  it("escapes the learner's own words in the HTML body", () => {
    const { html } = teacherQuestionMessage(input, "https://hr.rdcc.ai/lms");
    expect(html).not.toContain("<b>water</b>");
    expect(html).toContain("Why is &lt;b&gt;water&lt;/b&gt; addition at site risky &amp; what should I say?");
  });

  it("leaves the classroom out when the learner has none recorded", () => {
    const { text } = teacherQuestionMessage({ ...input, classroomName: null }, "https://hr.rdcc.ai/lms");
    expect(text).toContain("Ravi Kumar (A00388) has asked you a question");
  });
});
