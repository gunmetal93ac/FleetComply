import { Planned } from "@/components/app/Planned";

export default function Page() {
  return <Planned title="Compliance Calendar" phase="Phase 2" what={["Every dated checklist item, CDL and medical expiration on one calendar", "Configurable reminders (90 / 60 / 30 / 7 days)", "Email and SMS delivery (architecture ready; dashboard alerts first)"]} />;
}
