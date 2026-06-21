import { notFound } from "next/navigation";
import { LessonPlayer } from "@/components/lesson-player";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

export default async function LearnCourse({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(); const { id } = await params; if (!user.employeeId) notFound();
  const enrollment = await db.enrollment.findUnique({ where: { employeeId_courseId: { employeeId: user.employeeId, courseId: id } }, include: { progress: true, course: { include: { contents: { where: { isPublished: true }, include: { lessons: { where: { approvedAt: { not: null } }, orderBy: { order: "asc" } } }, orderBy: { version: "asc" } } } } } });
  if (!enrollment || enrollment.course.status !== "PUBLISHED") notFound();
  const progress = new Map(enrollment.progress.map((p) => [p.lessonId,p]));
  const lessons = enrollment.course.contents.flatMap((content) => content.lessons.map((lesson) => ({ id:lesson.id,title:lesson.title,type:lesson.type,pageAssetKeys:Array.isArray(lesson.pageAssetKeys)?lesson.pageAssetKeys as string[]:[],pageCount:lesson.pageCount,videoKey:lesson.type==="VIDEO"?content.storedKey:undefined,watchedSeconds:progress.get(lesson.id)?.watchedSeconds??0,viewedPages:Array.isArray(progress.get(lesson.id)?.viewedPages)?progress.get(lesson.id)!.viewedPages as number[]:[],completed:Boolean(progress.get(lesson.id)?.completedAt) })));
  const completed = lessons.filter((l) => l.completed).length; const percent = lessons.length ? Math.round(completed/lessons.length*100) : 0;
  return <main className="container"><span className="badge">{enrollment.status.replaceAll("_", " ")}</span><h1>{enrollment.course.title}</h1><div className="progress"><span style={{width:`${percent}%`}}/></div><p>{completed} of {lessons.length} lessons complete</p><LessonPlayer lessons={lessons}/></main>;
}
