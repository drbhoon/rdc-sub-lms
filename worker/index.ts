import { PrismaClient, LessonType, ProcessingStatus } from "@prisma/client";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { generateStudyPack } from "../src/lib/ai-study-pack";
import { storage } from "../src/lib/storage";

const db = new PrismaClient();
const run = promisify(execFile);

async function command(name: string, args: string[]) {
  return run(name, args, { timeout: 10 * 60_000, maxBuffer: 20 * 1024 * 1024 });
}

async function processDocument(content: Awaited<ReturnType<typeof nextContent>>, temp: string) {
  if (!content) return;
  const extension = path.extname(content.originalName).toLowerCase();
  const input = path.join(temp, `input${extension}`);
  await writeFile(input, await storage.get(content.storedKey));
  let pdf = input;
  if (content.type === "PRESENTATION") {
    await command("libreoffice", ["--headless", "--convert-to", "pdf", "--outdir", temp, input]);
    pdf = path.join(temp, "input.pdf");
  }
  const prefix = path.join(temp, "page");
  await command("pdftoppm", ["-png", "-r", "120", pdf, prefix]);
  const { stdout } = await command("pdftotext", [pdf, "-"]);
  const files = (await readdir(temp)).filter((name) => /^page-\d+\.png$/.test(name)).sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  const keys: string[] = [];
  for (const file of files) {
    const key = `generated/${content.id}/${file}`;
    await storage.put(key, await readFile(path.join(temp, file)));
    keys.push(key);
  }
  if (!keys.length) throw new Error("No pages were produced from the document");
  const cleanText = stdout.replace(/\s+/g, " ").trim();
  const studyPack = await generateStudyPack(cleanText, {
    model: process.env.OPENAI_MODEL ?? "gpt-5.4-mini",
    maxOutputTokens: Math.min(3000, Math.max(1200, content.course.aiTokenLimit)),
  });
  await db.courseContent.update({
    where: { id: content.id },
    data: {
      extractedText: cleanText,
      summary: studyPack.summary,
      keyPoints: studyPack.keyPoints,
      glossary: studyPack.glossary,
      quizQuestions: studyPack.quizQuestions,
      aiModel: process.env.OPENAI_MODEL ?? "gpt-5.4-mini",
      aiGeneratedAt: new Date(),
    },
  });
  await db.lesson.upsert({
    where: { courseContentId_order: { courseContentId: content.id, order: 1 } },
    update: { title: content.originalName.replace(/\.[^.]+$/, ""), type: LessonType.DOCUMENT, pageAssetKeys: keys, pageCount: keys.length },
    create: { courseContentId: content.id, title: content.originalName.replace(/\.[^.]+$/, ""), type: LessonType.DOCUMENT, order: 1, pageAssetKeys: keys, pageCount: keys.length },
  });
}

async function processVideo(content: NonNullable<Awaited<ReturnType<typeof nextContent>>>, temp: string) {
  const input = path.join(temp, "input.mp4");
  await writeFile(input, await storage.get(content.storedKey));
  const { stdout } = await command("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", input]);
  const durationSeconds = Math.max(1, Math.floor(Number(stdout.trim())));
  if (!Number.isFinite(durationSeconds)) throw new Error("Video duration could not be determined");
  await db.lesson.upsert({
    where: { courseContentId_order: { courseContentId: content.id, order: 1 } },
    update: { title: content.originalName.replace(/\.[^.]+$/, ""), type: LessonType.VIDEO, durationSeconds, requiredWatchPercent: content.course.requiredVideoPercent },
    create: { courseContentId: content.id, title: content.originalName.replace(/\.[^.]+$/, ""), type: LessonType.VIDEO, order: 1, durationSeconds, requiredWatchPercent: content.course.requiredVideoPercent },
  });
}

async function nextContent() {
  const job = await db.processingJob.findFirst({ where: { status: ProcessingStatus.QUEUED }, orderBy: { createdAt: "asc" }, include: { content: { include: { course: true } } } });
  if (!job) return null;
  const claimed = await db.processingJob.updateMany({ where: { id: job.id, status: ProcessingStatus.QUEUED }, data: { status: ProcessingStatus.PROCESSING, lockedAt: new Date(), attempts: { increment: 1 } } });
  if (!claimed.count) return null;
  await db.courseContent.update({ where: { id: job.contentId }, data: { processingStatus: ProcessingStatus.PROCESSING } });
  if (job.content.course.status !== "PUBLISHED") await db.course.update({ where: { id: job.content.courseId }, data: { status: "AI_PROCESSING" } });
  return { ...job.content, jobId: job.id };
}

async function processOne() {
  const content = await nextContent();
  if (!content) return false;
  const temp = await mkdtemp(path.join(os.tmpdir(), "rdc-lms-"));
  try {
    if (content.type === "VIDEO") await processVideo(content, temp);
    else await processDocument(content, temp);
    await db.$transaction([
      db.courseContent.update({ where: { id: content.id }, data: { processingStatus: ProcessingStatus.COMPLETED, processingError: null } }),
      db.processingJob.update({ where: { id: content.jobId }, data: { status: ProcessingStatus.COMPLETED, error: null } }),
      db.course.update({ where: { id: content.courseId }, data: { status: content.course.status === "PUBLISHED" ? "PUBLISHED" : "PENDING_TEACHER_APPROVAL", hasPendingChanges: true } }),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Unknown processing error";
    await db.$transaction([
      db.courseContent.update({ where: { id: content.id }, data: { processingStatus: ProcessingStatus.FAILED, processingError: message } }),
      db.processingJob.update({ where: { id: content.jobId }, data: { status: ProcessingStatus.FAILED, error: message } }),
    ]);
  } finally { await rm(temp, { recursive: true, force: true }); }
  return true;
}

async function main() {
  console.log("RDC LMS worker started");
  for (;;) {
    const worked = await processOne();
    if (!worked) await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

main().finally(() => db.$disconnect());
