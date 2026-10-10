"use client";
import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { recordProgress } from "@/actions/progress";
import { withBase } from "@/lib/base-path";

type Lesson = { id:string; title:string; type:"DOCUMENT"|"VIDEO"|"TEXT"; pageAssetKeys:string[]; pageCount:number; videoKey?:string; watchedSeconds:number; viewedPages:number[]; completed:boolean };

export function LessonPlayer({ lessons, moduleCount }: {
  lessons: Lesson[];
  /** How many modules the course has: "Course" when one, "Module" when several. */
  moduleCount: number;
}) {
  const [lessonIndex, setLessonIndex] = useState(0);
  const [page, setPage] = useState(1);
  const [pending, startTransition] = useTransition();
  // Set when the learner presses Finish and the server says some pages were
  // never viewed, so they are told rather than left with a button that did nothing.
  const [finishNote, setFinishNote] = useState("");
  const lastVideoTime = useRef(0);
  const unsavedWatch = useRef(0);
  const lesson = lessons[lessonIndex];
  if (!lesson) return <div className="card">No approved lessons are available.</div>;
  function save(data: { page?:number; watchedDelta?:number }) {
    const form = new FormData();
    form.set("lessonId", lesson.id);
    if (data.page) form.set("page", String(data.page));
    if (data.watchedDelta !== undefined) form.set("watchedDelta", String(data.watchedDelta));
    startTransition(async () => { await recordProgress(form); });
  }
  function trackVideo(currentTime: number, flush = false) {
    const delta = currentTime - lastVideoTime.current;
    lastVideoTime.current = currentTime;
    if (delta > 0 && delta < 2) unsavedWatch.current += delta;
    if ((flush || unsavedWatch.current >= 5) && unsavedWatch.current >= 1) {
      const watchedDelta = Math.floor(unsavedWatch.current);
      unsavedWatch.current -= watchedDelta;
      save({ watchedDelta });
    }
  }
  const unit = moduleCount === 1 ? "Course" : "Module";
  function finish() {
    const form = new FormData();
    form.set("lessonId", lesson.id);
    form.set("page", String(page));
    setFinishNote("");
    startTransition(async () => {
      const result = await recordProgress(form);
      if (!result?.lessonCompleted) setFinishNote("Some pages of this " + unit.toLowerCase() + " have not been viewed yet. Use Previous to go back through them, then press Finish again.");
    });
  }
  function showPage(next:number) {
    setFinishNote("");
    save({ page });
    setPage(Math.max(1, Math.min(lesson.pageCount, next)));
  }
  function selectLesson(index: number) {
    setLessonIndex(index);
    setFinishNote("");
    setPage(1);
    lastVideoTime.current = 0;
    unsavedWatch.current = 0;
  }
  return <div className="lesson-player">
    <section className="card lesson-viewer-card">
      <h2>{lesson.title}</h2>
      {lesson.type === "DOCUMENT" && <>
        <div className="lesson-page-frame">
          {lesson.pageAssetKeys[page - 1]
            ? <Image unoptimized width={1600} height={1200} className="lesson-page" src={withBase(`/api/files/${lesson.pageAssetKeys[page - 1]}`)} alt={`Page ${page} of ${lesson.pageCount}`} />
            : <p className="muted">Page image is not available.</p>}
        </div>
        <div className="lesson-controls">
          <button className="secondary" disabled={page === 1 || pending} onClick={() => showPage(page - 1)}>Previous</button>
          <span>Page {page} of {lesson.pageCount}</span>
          {page === lesson.pageCount
            ? <button disabled={pending} onClick={finish}>Finish</button>
            : <button disabled={pending} onClick={() => { save({ page }); setPage(page + 1); }}>Next</button>}
        </div>
        {page === lesson.pageCount && lesson.completed && <p className="message success" role="status">You have completed this {unit}.</p>}
        {page === lesson.pageCount && finishNote && <p className="message" role="status">{finishNote}</p>}
      </>}
      {lesson.type === "VIDEO" && lesson.videoKey && <video className="video" controls preload="metadata" src={withBase(`/api/files/${lesson.videoKey}`)} onPlay={(e) => { lastVideoTime.current = e.currentTarget.currentTime; }} onSeeking={(e) => { lastVideoTime.current = e.currentTarget.currentTime; }} onTimeUpdate={(e) => trackVideo(e.currentTarget.currentTime)} onPause={(e) => trackVideo(e.currentTarget.currentTime, true)} onEnded={(e) => trackVideo(e.currentTarget.currentTime, true)} />}
    </section>
    <aside className="card lesson-list-card">
      <h2>Lessons</h2>
      <div className="lesson-list-buttons">
        {lessons.map((item, index) => <button className={index === lessonIndex ? "" : "secondary"} key={item.id} onClick={() => selectLesson(index)}>{item.completed ? "✓ " : ""}{index + 1}. {item.title}</button>)}
      </div>
    </aside>
  </div>;
}
