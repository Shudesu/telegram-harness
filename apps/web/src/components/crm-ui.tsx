"use client";
import { Badge, Button, Input } from "@cloudflare/kumo";
import type { ReactNode } from "react";
export function CrmField({
  label,
  name,
  type = "text",
  placeholder,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: "text" | "number";
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <label className="crm-field">
      <span>{label}</span>
      <Input
        aria-label={label}
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={name !== "tags"}
      />
    </label>
  );
}
export function CrmButton({
  children,
  secondary = false,
}: {
  children: ReactNode;
  secondary?: boolean;
}) {
  return (
    <Button type="submit" variant={secondary ? "secondary" : "primary"}>
      {children}
    </Button>
  );
}
export function CrmBadge({ children }: { children: ReactNode }) {
  return <Badge>{children}</Badge>;
}
