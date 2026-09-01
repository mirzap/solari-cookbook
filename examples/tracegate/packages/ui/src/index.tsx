import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Panel(props: { readonly title: string; readonly eyebrow?: string; readonly children: ReactNode }) {
  return (
    <section className="tg-panel">
      <header className="tg-panel__header">
        {props.eyebrow === undefined ? null : <p className="tg-eyebrow">{props.eyebrow}</p>}
        <h2>{props.title}</h2>
      </header>
      {props.children}
    </section>
  );
}

export function StatusBadge({ status }: { readonly status: string }) {
  return <span className={`tg-status tg-status--${status.replaceAll("_", "-")}`}>{status.replaceAll("_", " ")}</span>;
}

export function Metric({ label, value, detail }: { readonly label: string; readonly value: ReactNode; readonly detail?: string }) {
  return (
    <div className="tg-metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {detail === undefined ? null : <small>{detail}</small>}
    </div>
  );
}

export function PrimaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={["tg-button", props.className].filter(Boolean).join(" ")} />;
}

export function InlineNotice({ tone, children }: { readonly tone: "info" | "warning" | "error"; readonly children: ReactNode }) {
  return <p className={`tg-notice tg-notice--${tone}`} role={tone === "error" ? "alert" : "status"}>{children}</p>;
}
