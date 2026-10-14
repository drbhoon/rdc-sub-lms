import { UserRole } from "@prisma/client";
import {
  Activity, Award, Bot, CheckCheck, CircleCheck, CircleX, Factory, FileText, Gauge, Hourglass, Layers, Library,
  MessageSquare, MousePointerClick, PauseCircle, Pencil, Percent, PlayCircle, Presentation, School, Star, TrendingUp, Users, Video,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { PrintButton } from "@/components/print-button";
import { db } from "@/lib/db";
import { formatIstDate } from "@/lib/ist";
import { loadInfographic } from "@/lib/infographic";
import { requireRole } from "@/lib/session";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const one = (params: Record<string, string | string[] | undefined>, key: string) => {
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value) ?? "";
};
const number = (value: number) => value.toLocaleString("en-IN");

type Tile = { icon: LucideIcon; value: string; caption: string };

function Block({ title, tone, tiles }: { title: string; tone: "dark" | "pale"; tiles: Tile[] }) {
  return <section className={`info-block info-${tone}`}>
    <h2>{title}</h2>
    <div className="info-tiles">
      {tiles.map(({ icon: Icon, value, caption }) => <div className="info-tile" key={caption}>
        <Icon size={44} strokeWidth={1.6} aria-hidden="true" />
        <strong>{value}</strong>
        <span>{caption}</span>
      </div>)}
    </div>
  </section>;
}

export default async function InfographicPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(UserRole.SUPER_ADMIN);
  const params = await searchParams;
  const companyId = one(params, "companyId");
  const from = DATE.test(one(params, "from")) ? one(params, "from") : "";
  const to = DATE.test(one(params, "to")) ? one(params, "to") : "";
  const [companies, data] = await Promise.all([
    db.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    loadInfographic({ companyId, from, to }),
  ]);
  const company = companies.find((item) => item.id === companyId);
  const scope = [company?.name ?? "All companies", from || to ? `enrolled ${from || "the start"} to ${to || "today"}` : "all time"].join(" · ");

  return <main className="container">
    <h1>Reports</h1>
    <nav className="report-tabs" aria-label="Report sections">
      <Link href="/admin/reports">General</Link>
      <Link href="/admin/reports/assessment">Assessment</Link>
      <Link href="/admin/reports/feedback">Feedback</Link>
      <Link href="/admin/reports/custom">Custom</Link>
      <Link className="active" href="/admin/reports/infographic">Infographic</Link>
    </nav>
    <form className="period-filter card info-filter" method="get">
      <label>Company
        <select name="companyId" defaultValue={companyId}>
          <option value="">All companies</option>
          {companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label>Enrolled from<input type="date" name="from" defaultValue={from} /></label>
      <label>Enrolled to<input type="date" name="to" defaultValue={to} /></label>
      <button>Apply</button>
      <PrintButton />
    </form>

    <div className="infographic">
      <section className="info-title">
        <p>{formatIstDate(new Date())} · {scope}</p>
        <h2>RDC learning infographic</h2>
      </section>
      <Block title="Insights" tone="pale" tiles={[
        { icon: MousePointerClick, value: `${data.participation}%`, caption: "participation" },
        { icon: Activity, value: `${data.engagement}%`, caption: "engagement (last 30 days)" },
        { icon: TrendingUp, value: `${data.progress}%`, caption: "average progress" },
        { icon: Gauge, value: `${data.completionRate}%`, caption: "completion rate" },
      ]} />
      <Block title="People" tone="dark" tiles={[
        { icon: Users, value: number(data.learners), caption: "learners" },
        { icon: Presentation, value: number(data.teachers), caption: "teachers" },
        { icon: Factory, value: number(data.plants), caption: "plants / locations" },
        { icon: School, value: number(data.classrooms), caption: "classrooms" },
      ]} />
      <Block title="Course completion" tone="pale" tiles={[
        { icon: Library, value: number(data.enrolments), caption: "enrolments" },
        { icon: CheckCheck, value: number(data.completed), caption: "completed" },
        { icon: PlayCircle, value: number(data.inProgress), caption: "in progress" },
        { icon: PauseCircle, value: number(data.notStarted), caption: "not started" },
      ]} />
      <Block title="Assessments" tone="dark" tiles={[
        { icon: Pencil, value: number(data.attempts), caption: "attempts" },
        { icon: CircleCheck, value: number(data.passed), caption: "passed" },
        { icon: CircleX, value: number(data.notPassed), caption: "not passed" },
        { icon: Percent, value: `${data.averageScore}%`, caption: "average score" },
      ]} />
      <Block title="Learning time" tone="pale" tiles={[
        { icon: Hourglass, value: `${number(data.hoursSpent)} h`, caption: "time spent learning" },
        { icon: Video, value: number(data.videos), caption: "videos" },
        { icon: FileText, value: number(data.documents), caption: "documents" },
        { icon: Layers, value: number(data.modules), caption: "modules" },
      ]} />
      <Block title="Certificates and feedback" tone="dark" tiles={[
        { icon: Award, value: number(data.certificates), caption: "completed with certificate" },
        { icon: MessageSquare, value: number(data.feedbackReplies), caption: "feedback replies" },
        { icon: Star, value: data.averageRating === null ? "-" : `${data.averageRating}`, caption: "average rating (of 5)" },
        { icon: Bot, value: number(data.aiQuestions), caption: "AI tutor questions" },
      ]} />
    </div>
  </main>;
}
