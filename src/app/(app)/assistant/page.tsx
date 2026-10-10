import { Planned } from "@/components/app/Planned";

export default function Page() {
  return <Planned title="AI Compliance Assistant" phase="Phase 3" what={["Answers grounded only in the approved, versioned rule catalog (retrieval, not model memory)", "Every answer cites the rule entries it used and their verification status", "Says 'unable to determine' and asks clarifying questions instead of guessing", "Links straight into the matching workflow"]} />;
}
