import { redirect } from "next/navigation";

// The plan now lives on the home page (the trailer). Keep the old URL working.
export default function PlanRedirect() {
  redirect("/");
}
