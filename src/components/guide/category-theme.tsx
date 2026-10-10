import type { ComponentType, SVGProps } from "react";
import type { GuideCategory } from "@/lib/workflows/scenarios";
import { IconAlert, IconBuilding, IconClock, IconFlask, IconMap, IconUserPlus, IconWrench } from "@/components/icons";
import { cn } from "@/components/ui";

/** Visual identity per scenario category. Class strings are literal so Tailwind keeps them. */
export interface CategoryTheme {
  short: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** icon container */
  chip: string;
  /** hover border on cards */
  hover: string;
  /** small solid accent (dots, bars) */
  solid: string;
}

export const CATEGORY_THEME: Record<GuideCategory, CategoryTheme> = {
  "Hiring and Driver Qualifications": { short: "Driver Hiring", Icon: IconUserPlus, chip: "bg-blue-50 text-blue-600 ring-blue-100", hover: "hover:border-blue-300", solid: "bg-blue-500" },
  "Drug and Alcohol Compliance": { short: "Drug & Alcohol", Icon: IconFlask, chip: "bg-violet-50 text-violet-600 ring-violet-100", hover: "hover:border-violet-300", solid: "bg-violet-500" },
  "Accidents and Roadside Inspections": { short: "Accidents & Inspections", Icon: IconAlert, chip: "bg-orange-50 text-orange-600 ring-orange-100", hover: "hover:border-orange-300", solid: "bg-orange-500" },
  "Hours of Service": { short: "Hours of Service", Icon: IconClock, chip: "bg-teal-50 text-teal-600 ring-teal-100", hover: "hover:border-teal-300", solid: "bg-teal-500" },
  "Vehicle Maintenance and Inspections": { short: "Vehicle Maintenance", Icon: IconWrench, chip: "bg-emerald-50 text-emerald-600 ring-emerald-100", hover: "hover:border-emerald-300", solid: "bg-emerald-500" },
  "Company Registration and Operations": { short: "Company Compliance", Icon: IconBuilding, chip: "bg-indigo-50 text-indigo-600 ring-indigo-100", hover: "hover:border-indigo-300", solid: "bg-indigo-500" },
  "State-Specific Requirements": { short: "State Regulations", Icon: IconMap, chip: "bg-amber-50 text-amber-600 ring-amber-100", hover: "hover:border-amber-300", solid: "bg-amber-500" },
};

export function CategoryIcon({ category, size = "md", muted = false }: { category: GuideCategory; size?: "sm" | "md" | "lg"; muted?: boolean }) {
  const t = CATEGORY_THEME[category];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-xl ring-1 ring-inset",
        muted ? "bg-slate-50 text-slate-400 ring-slate-100" : t.chip,
        size === "sm" ? "h-8 w-8" : size === "lg" ? "h-12 w-12" : "h-10 w-10",
      )}
    >
      <t.Icon className={size === "sm" ? "h-4 w-4" : size === "lg" ? "h-6 w-6" : "h-5 w-5"} />
    </span>
  );
}
