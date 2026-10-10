import type { Classification } from "./types";

export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  LEGALLY_REQUIRED: "Legally required",
  CONDITIONALLY_REQUIRED: "Required for this situation",
  BEST_PRACTICE: "Recommended best practice",
  COMPANY_POLICY: "Company policy",
  NOT_APPLICABLE: "Not applicable",
  UNABLE_TO_DETERMINE: "Unable to determine",
};
