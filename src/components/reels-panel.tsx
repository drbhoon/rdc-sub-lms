import { addYoutubeReel, deleteReel, setReelActive } from "@/actions/reels";
import { KeepForm } from "@/components/keep-form";
import { ReelUploadForm } from "@/components/reel-upload-form";
import { db } from "@/lib/db";
import { formatClock } from "@/lib/youtube";

/** Reels of a course, for the admin and teacher pages: add (upload or YouTube link), hide, remove. */
export async function ReelsPanel({ courseId }: { courseId: string }) {
  const reels = await db.courseReel.findMany({
    where: { courseId },
    include: { _count: { select: { views: true } }, views: { where: { completed: true }, select: { id: true } } },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return <section className="card reels-panel">
    <h2>Reels</h2>
    <p className="muted">
      Short vertical videos that learners scroll through beside the lessons. They are optional: watching them is never needed to
      complete the course. Reels go live as soon as the course is published; no approval step.
    </p>
    {!reels.length && <p>No reels yet.</p>}
    {reels.map((reel) => <div className="reel-row" key={reel.id}>
      <div>
        <strong>{reel.title}</strong> {!reel.isActive && <span className="badge">Hidden</span>}
        <p className="muted">
          {reel.youtubeId ? "YouTube" : `Uploaded, ${(reel.sizeBytes / 1048576).toFixed(1)} MB`}
          {reel.durationSeconds ? ` · ${formatClock(reel.durationSeconds)}` : ""}
          {` · ${reel._count.views} viewer${reel._count.views === 1 ? "" : "s"}, ${reel.views.length} watched it through`}
        </p>
      </div>
      <div className="button-row">
        <form action={setReelActive}>
          <input type="hidden" name="reelId" value={reel.id} />
          <input type="hidden" name="active" value={reel.isActive ? "0" : "1"} />
          <button type="submit" className="secondary">{reel.isActive ? "Hide" : "Show"}</button>
        </form>
        <form action={deleteReel}>
          <input type="hidden" name="reelId" value={reel.id} />
          <button type="submit" className="danger">Delete</button>
        </form>
      </div>
    </div>)}
    <details>
      <summary>Upload a reel</summary>
      <ReelUploadForm courseId={courseId} />
    </details>
    <details>
      <summary>Add a YouTube Short or video as a reel</summary>
      <KeepForm action={addYoutubeReel} submitLabel="Add reel" clearOnSuccess>
        <input type="hidden" name="courseId" value={courseId} />
        <label>YouTube link<input name="url" required placeholder="https://www.youtube.com/shorts/…" /></label>
        <label>Title<input name="title" required minLength={3} maxLength={150} /></label>
        <label>Length in seconds (optional)<input name="durationSeconds" type="number" min="1" max="180" /></label>
        <label>Caption (optional)<textarea name="caption" maxLength={500} rows={2} /></label>
      </KeepForm>
    </details>
  </section>;
}
