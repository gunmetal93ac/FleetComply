"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Select } from "@/components/ui";

const CATS: Array<[string, string]> = [
  ["DRIVER_QUALIFICATION_FILE", "Driver qualification file"],
  ["DRIVER_INVESTIGATION_HISTORY_FILE", "Investigation history file (restricted)"],
  ["DRUG_ALCOHOL_PROGRAM", "Drug & alcohol (restricted)"],
  ["HAZMAT_TRAINING", "Hazmat training"],
  ["ACCIDENT_RECORDS", "Accident records"],
  ["GENERAL_EMPLOYMENT", "General employment / HR"],
  ["COMPANY_RECORDS", "Company records"],
];

export function DriverDocUpload({ driverId }: { driverId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="mt-3 space-y-2 border-t border-slate-100 pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set("driverId", driverId);
        setBusy(true);
        setError(null);
        const res = await fetch("/api/documents/upload", { method: "POST", body: fd });
        setBusy(false);
        if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Upload failed");
        else {
          (e.target as HTMLFormElement).reset();
          router.refresh();
        }
      }}
    >
      <Select name="recordCategory" required defaultValue="">
        <option value="" disabled>Record category…</option>
        {CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
      <Input type="file" name="file" required />
      <label className="block text-xs text-slate-600">Expires (optional) <Input type="date" name="expiresOn" /></label>
      <Button size="sm" type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload"}</Button>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </form>
  );
}
