import Link from "next/link";
import { Card, CardBody, PageHeader } from "@/components/ui";

/** Honest placeholder for navigation items that are not built yet. Nothing here is interactive. */
export function Planned({ title, phase, what }: { title: string; phase: string; what: string[] }) {
  return (
    <>
      <PageHeader title={title} subtitle={`Not built yet — planned for ${phase}.`} />
      <Card className="max-w-2xl">
        <CardBody>
          <p className="text-sm text-slate-700">This section is on the roadmap. When built it will provide:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {what.map((w) => <li key={w}>{w}</li>)}
          </ul>
          <p className="mt-4 text-sm">
            <Link href="/workflows" className="font-medium text-brand-700">Go to the working compliance workflows →</Link>
          </p>
        </CardBody>
      </Card>
    </>
  );
}
