import type { ComponentProps, ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/**
 * One entry in the Settings and Library lists: an icon, a name, and a short
 * line of status. Opens that item's panel. Works as a Radix `asChild` trigger.
 */
export function SettingsRow({
  icon,
  title,
  detail,
  tone = "default",
  className,
  ...props
}: ComponentProps<"button"> & {
  icon: ReactNode;
  title: string;
  detail?: ReactNode;
  tone?: "default" | "ok" | "warn";
}) {
  return (
    <button type="button" className={`settings-row ${className ?? ""}`} data-tone={tone} {...props}>
      <span className="settings-row-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="settings-row-text">
        <span className="settings-row-title">{title}</span>
        {detail ? <span className="settings-row-detail">{detail}</span> : null}
      </span>
      <ChevronRight className="settings-row-chevron" aria-hidden="true" />
    </button>
  );
}

export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-group" aria-label={title}>
      <h2 className="settings-group-title">{title}</h2>
      <div className="settings-group-rows">{children}</div>
    </section>
  );
}
