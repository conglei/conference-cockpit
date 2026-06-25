import { redirect } from "next/navigation";

// Who-to-meet is now the home page. Keep this URL working.
export default function WhoToMeetRedirect() {
  redirect("/");
}
