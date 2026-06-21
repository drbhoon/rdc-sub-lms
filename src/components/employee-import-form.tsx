"use client";

import { useActionState } from "react";
import { importEmployees, type EmployeeImportState } from "@/actions/employees";

export function EmployeeImportForm() {
  const initialState: EmployeeImportState = {};
  const [state, action, pending] = useActionState(importEmployees, initialState);
  return <form action={action} className="form">
    <label>CSV or Excel file<input type="file" name="file" accept=".csv,.xlsx,.xls" required /></label>
    {state.message && <p className="message">{state.message}</p>}
    <div className="form-row">
      <button name="intent" value="preview" className="secondary" disabled={pending}>{pending ? "Checking…" : "Validate and preview"}</button>
      {state.preview && <button name="intent" value="import" disabled={pending}>Import employee master</button>}
    </div>
  </form>;
}
