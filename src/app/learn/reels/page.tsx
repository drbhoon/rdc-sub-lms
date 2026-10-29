import { UserRole } from "@prisma/client";
import { ReelFeed, type ReelItem } from "@/components/reel-feed";
import { withBase } from "@/lib/base-path";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

/** Every reel from every course the learner is enrolled in, in one feed. */
export default async function ReelsPage() {
  const user = await requireRole(UserRole.LEARNER);
  const rows = user.employeeId
    ? await db.courseReel.findMany({
        where: { isActive: true, course: { status: "PUBLISHED", enrollments: { some: { employeeId: user.employeeId } } } },
        include: { course: { select: { title: true } }, views: { where: { employeeId: user.employeeId } } },
        orderBy: [{ createdAt: "desc" }],
        take: 200,
      })
    : [];
  const reels: ReelItem[] = rows.map((reel) => ({
    id: reel.id, title: reel.title, caption: reel.caption, course: reel.course.title, watched: Boolean(reel.views[0]?.completed),
    src: reel.storedKey ? withBase(`/api/files/${reel.storedKey}`) : undefined, youtubeId: reel.youtubeId ?? undefined,
  }));
  return <main className="container reels-page">
    <header className="home-head">
      <p className="muted">Quick learning</p>
      <h1>Reels</h1>
    </header>
    <section className="card">
      {reels.length
        ? <ReelFeed reels={reels} startOpen />
        : <p>No reels yet. Reels added to your courses by your trainers will appear here.</p>}
    </section>
  </main>;
}
