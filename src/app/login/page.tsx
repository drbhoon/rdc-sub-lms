import { redirect } from "next/navigation";
import Image from "next/image";
import { AuthForm } from "@/components/auth-form";
import { currentUser } from "@/lib/session";
export default async function Login() {
  if (await currentUser()) redirect("/dashboard");
  return <main className="login-page">
    <section className="login-hero card">
      <div className="login-brand"><Image src="/brand/rdc-logo.jpeg" alt="RDC logo" width={104} height={64} /><span>RDC Concrete (India) Limited</span></div>
      <h1>DEEKSHA FOR ROBO AND ULTRAFINE EMPLOYEES</h1>
      <p>Lightweight learning, course tracking, and certification for RDC subsidiary teams.</p>
      <div className="hero-images">
        <figure><Image src="/brand/grinding-mill.jpg" alt="Grinding mill" width={480} height={600} /><figcaption>Grinding mill</figcaption></figure>
        <figure><Image src="/brand/stone-crusher.jpg" alt="Stone crusher" width={800} height={487} /><figcaption>Stone crusher</figcaption></figure>
      </div>
    </section>
    <section className="login-form-panel"><AuthForm /></section>
  </main>;
}
