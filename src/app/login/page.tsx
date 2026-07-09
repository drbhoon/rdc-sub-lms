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
        <figure><Image src="/brand/robo-disha.jpg" alt="ROBO Disha branded learning image" width={1263} height={949} priority /><figcaption>ROBO Disha</figcaption></figure>
        <figure><Image src="/brand/uf-disha.jpg" alt="UltraFine Disha branded learning image" width={1600} height={1068} priority /><figcaption>UltraFine Disha</figcaption></figure>
      </div>
    </section>
    <section className="login-form-panel"><AuthForm /></section>
  </main>;
}
