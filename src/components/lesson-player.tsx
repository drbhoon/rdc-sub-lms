"use client";
import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { recordProgress } from "@/actions/progress";

type Lesson = { id:string; title:string; type:"DOCUMENT"|"VIDEO"|"TEXT"; pageAssetKeys:string[]; pageCount:number; videoKey?:string; watchedSeconds:number; viewedPages:number[]; completed:boolean };

export function LessonPlayer({ lessons }: { lessons: Lesson[] }) {
  const [lessonIndex, setLessonIndex] = useState(0); const [page, setPage] = useState(1); const [pending, startTransition] = useTransition();
  const lastVideoTime = useRef(0); const unsavedWatch = useRef(0);
  const lesson = lessons[lessonIndex];
  if (!lesson) return <div className="card">No approved lessons are available.</div>;
  function save(data: { page?:number; watchedDelta?:number }) { const form = new FormData(); form.set("lessonId", lesson.id); if (data.page) form.set("page", String(data.page)); if (data.watchedDelta !== undefined) form.set("watchedDelta", String(data.watchedDelta)); startTransition(() => recordProgress(form)); }
  function trackVideo(currentTime: number, flush = false) { const delta = currentTime - lastVideoTime.current; lastVideoTime.current = currentTime; if (delta > 0 && delta < 2) unsavedWatch.current += delta; if ((flush || unsavedWatch.current >= 5) && unsavedWatch.current >= 1) { const watchedDelta = Math.floor(unsavedWatch.current); unsavedWatch.current -= watchedDelta; save({ watchedDelta }); } }
  function showPage(next:number) { save({ page }); setPage(Math.max(1,Math.min(lesson.pageCount,next))); }
  return <div className="two-col"><section className="card"><h2>{lesson.title}</h2>{lesson.type === "DOCUMENT" && <>{lesson.pageAssetKeys[page-1] && <Image unoptimized width={1200} height={900} className="lesson-page" src={`/api/files/${lesson.pageAssetKeys[page-1]}`} alt={`Page ${page} of ${lesson.pageCount}`}/>}<div className="lesson-controls"><button className="secondary" disabled={page===1||pending} onClick={() => showPage(page-1)}>Previous</button><span>Page {page} of {lesson.pageCount}</span><button disabled={pending} onClick={() => { save({page}); if(page<lesson.pageCount)setPage(page+1); }}>{page===lesson.pageCount?"Mark page viewed":"Next"}</button></div></>}
    {lesson.type === "VIDEO" && lesson.videoKey && <video className="video" controls src={`/api/files/${lesson.videoKey}`} onPlay={(e) => { lastVideoTime.current=e.currentTarget.currentTime; }} onSeeking={(e) => { lastVideoTime.current=e.currentTarget.currentTime; }} onTimeUpdate={(e) => trackVideo(e.currentTarget.currentTime)} onPause={(e) => trackVideo(e.currentTarget.currentTime,true)} onEnded={(e) => trackVideo(e.currentTarget.currentTime,true)}/>}</section>
    <aside className="card"><h2>Lessons</h2><div className="form">{lessons.map((item,index) => <button className={index===lessonIndex?"":"secondary"} key={item.id} onClick={() => { setLessonIndex(index); setPage(1); }}>{item.completed?"✓ ":""}{index+1}. {item.title}</button>)}</div></aside></div>;
}
