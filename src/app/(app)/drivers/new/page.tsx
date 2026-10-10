import { requireUser } from "@/lib/auth/session";
import { createDriverAction } from "@/app/actions/drivers";
import { DriverForm } from "@/components/drivers/DriverForm";
import { Card, CardBody, PageHeader } from "@/components/ui";

export default async function NewDriverPage() {
  await requireUser("driver:write");
  return (
    <>
      <PageHeader title="Add driver" subtitle="Hiring someone new? The “Hire a new CDL driver” workflow creates the driver for you and builds the checklist." />
      <Card className="max-w-3xl"><CardBody><DriverForm action={createDriverAction} submitLabel="Add driver" /></CardBody></Card>
    </>
  );
}
