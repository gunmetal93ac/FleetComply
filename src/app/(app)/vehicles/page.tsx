import { Planned } from "@/components/app/Planned";

export default function Page() {
  return <Planned title="Vehicles" phase="Phase 2" what={["Vehicle profiles (unit, VIN, plate, registration, IRP/IFTA)", "Annual inspection due dates and alerts", "Defect, repair and out-of-service tracking", "Vehicle workflows such as 'Add a vehicle' and 'Return to service'"]} />;
}
