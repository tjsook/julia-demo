import {
  Calculator,
  Clock3,
  DollarSign,
  Keyboard,
  Package,
  Percent,
  PhoneCall,
  ReceiptText,
  Route,
  TrendingUp,
  Truck,
  Users,
} from "lucide-react";

import s from "../../../styles/julia.module.css";

const PAIN_POINTS = [
  {
    id: "manual_load_matching",
    label: "Manual load matching",
    description: "Dispatch or load-assignment decisions are being handled manually.",
    icon: Route,
  },
  {
    id: "detention_not_billed",
    label: "Detention not getting billed",
    description: "Detention events are happening, but billing or collection is getting missed.",
    icon: Clock3,
  },
  {
    id: "office_labor_high",
    label: "Office labor too high",
    description: "Back-office staffing or overhead is high relative to workflow automation.",
    icon: Users,
  },
  {
    id: "phone_work_overload",
    label: "Phone work overload",
    description: "Teams are spending heavy time on calls and manual status communication.",
    icon: PhoneCall,
  },
  {
    id: "manual_order_entry",
    label: "Manual order entry",
    description: "Orders are being entered or re-keyed by hand.",
    icon: Keyboard,
  },
  {
    id: "invoicing_billing_slow",
    label: "Invoicing/billing slow",
    description: "Invoice and billing workflows are delayed and impacting cash timing.",
    icon: ReceiptText,
  },
  {
    id: "low_revenue_per_truck",
    label: "Low revenue per truck",
    description: "Fleet utilization or yield per truck is below target.",
    icon: TrendingUp,
  },
] as const;

const VARIABLES = [
  {
    symbol: "T",
    label: "Trucks",
    description: "Fleet size used to scale operational impact.",
    icon: Truck,
  },
  {
    symbol: "Ld",
    label: "Loads / day",
    description: "Average loads moved per day.",
    icon: Package,
  },
  {
    symbol: "Du",
    label: "% Detention uncaptured",
    description: "Share of detention value currently not billed/collected.",
    icon: Clock3,
  },
  {
    symbol: "R",
    label: "Revenue / load",
    description: "Average revenue generated per load.",
    icon: DollarSign,
  },
  {
    symbol: "minutes_per_order",
    label: "Minutes / order entry",
    description: "Manual time spent per order or load entry.",
    icon: Keyboard,
  },
  {
    symbol: "S",
    label: "% Spot",
    description: "Share of business running in spot market.",
    icon: Percent,
  },
  {
    symbol: "P",
    label: "Office people",
    description: "Office/dispatch headcount supporting this workflow.",
    icon: Users,
  },
] as const;

export function JuliaGlossary() {
  return (
    <section className={s.glossaryBand} aria-label="Julia ROI glossary">
      <div className={s.glossaryHeader}>
        <div className={s.eyebrow}>Glossary</div>
        <h2 className={s.glossaryTitle}>Possible pain points and model variables</h2>
      </div>

      <div className={s.glossaryGrid}>
        <article className={s.glossaryCard} aria-label="All possible pain points">
          <h3>Pain points</h3>
          <ul className={s.glossaryList}>
            {PAIN_POINTS.map((item) => (
              <li key={item.id}>
                <span className={s.glossaryIcon}>
                  <item.icon size={15} strokeWidth={1.8} />
                </span>
                <span className={s.glossaryBody}>
                  <span className={s.glossaryLabel}>{item.label}</span>
                  <code className={s.glossaryCode}>{item.id}</code>
                  <span className={s.glossaryDescription}>{item.description}</span>
                </span>
              </li>
            ))}
          </ul>
        </article>

        <article className={s.glossaryCard} aria-label="All possible model variables">
          <h3>Variables</h3>
          <ul className={s.glossaryList}>
            {VARIABLES.map((item) => (
              <li key={item.symbol}>
                <span className={s.glossaryIcon}>
                  <item.icon size={15} strokeWidth={1.8} />
                </span>
                <span className={s.glossaryBody}>
                  <span className={s.glossaryLabel}>{item.label}</span>
                  <code className={s.glossaryCode}>{item.symbol}</code>
                  <span className={s.glossaryDescription}>{item.description}</span>
                </span>
              </li>
            ))}
          </ul>
        </article>
      </div>

      <p className={s.glossaryFootnote}>
        Values shown in ROI reports are built from whichever pain points and variables are captured in the conversation.
      </p>
    </section>
  );
}
