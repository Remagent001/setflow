import { redirect } from "next/navigation";

// Root just forwards into the app; AppShell bounces to /login if signed out.
export default function HomePage() {
  redirect("/dashboard");
}
