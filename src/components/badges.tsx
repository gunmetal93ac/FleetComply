import type { Classification } from "@/lib/rules/types";
import { STATUS_LABEL, type ItemStatus } from "@/lib/workflows/status";
import { Badge, type Tone } from "./ui";
import { CLASSIFICATION_LABEL } from "@/lib/rules/labels";

export { CLASSIFICATION_LABEL };
const CLASS_TONE: Record<Classification, Tone> = {
  LEGALLY_REQUIRED: "red",
  CONDITIONALLY_REQUIRED: "red",
  BEST_PRACTICE: "teal",
  COMPANY_POLICY: "purple",
  NOT_APPLICABLE: "slate",
  UNABLE_TO_DETERMINE: "amber",
};
const STATUS_TONE: Record<ItemStatus, Tone> = {
  NOT_STARTED: "slate",
  IN_PROGRESS: "blue",
  PENDING_VERIFICATION: "amber",
  COMPLETED: "green",
  NOT_APPLICABLE: "slate",
  BLOCKED: "red",
};

export function ClassificationBadge({ value }: { value: Classification }) {
  return <Badge tone={CLASS_TONE[value]}>{CLASSIFICATION_LABEL[value]}</Badge>;
}
export function StatusBadge({ value }: { value: ItemStatus }) {
  return <Badge tone={STATUS_TONE[value]}>{STATUS_LABEL[value]}</Badge>;
}
export function VerificationBadge({ status }: { status: "VERIFIED" | "REQUIRES_VERIFICATION" }) {
  return status === "VERIFIED" ? (
    <Badge tone="green">Source verified</Badge>
  ) : (
    <Badge tone="amber">Regulatory guidance pending review</Badge>
  );
}
export function BlockerBadge() {
  return <Badge tone="red">Blocks safety-sensitive work</Badge>;
}
export function SampleBadge() {
  return <Badge tone="purple">SAMPLE DATA</Badge>;
}
