import { redirect } from "next/navigation";
import Image from "next/image";
import { AuthForm } from "@/components/auth-form";
import { currentUser } from "@/lib/session";
import { withBase } from "@/lib/base-path";
import { safeNextPath } from "@/lib/next-path";
export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  // The page they were trying to reach, passed along by requireUser.
  const next = safeNextPath((await searchParams).next);
  if (await currentUser()) redirect(next ?? "/dashboard");
  return <main className="login-page">
    <section className="login-hero card">
      <div className="login-brand"><Image src={withBase("/brand/rdc-logo.jpeg")} alt="RDC logo" width={104} height={64} /><span>RDC Concrete (India) Limited</span></div>
      <h1>DEEKSHA 2- LEARNING PLATFORM OF RDC</h1>
      <p>Online Learning Academy of RDC ROBO &amp; ULTRAFINE.</p>
      <figure className="hero-photo">
        <Image src={withBase("/brand/graduation-ceremony.jpg")} alt="Graduates and faculty at the work-integrated learning graduation ceremony" width={2000} height={1333} priority />
      </figure>
    </section>
    <section className="login-form-panel"><AuthForm next={next} /></section>
  </main>;
}
