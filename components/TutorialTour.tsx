"use client";

import { useEffect } from "react";
import { Bot, ChevronLeft, ChevronRight, X } from "lucide-react";

const steps = [
  { title: "Welcome & your £ budget", body: "Set your research budget in the top bar. Scenarios use it to size illustrative positions; it never places real orders." },
  { title: "Find a market & choose your timeframe", body: "Search stocks or crypto, then switch between a 5m scalp view and 1D long-term view." },
  { title: "Read a trade card", body: "Each AI card separates chart setup, news and risk, with entry, target, stop and estimated metrics. Choose Trade With This to follow a setup." },
  { title: "Follow live updates & friends", body: "Your open Trade Withs refresh while the app is open. Alerts flag target and stop outcomes; Friends opens public trader profiles." },
  { title: "Plan ahead & make it yours", body: "Open the floating Future Trade Planner to revisit ideas later, and use the palette button to pick a saved theme." },
];

interface TutorialTourProps { step: number; onStep: (step: number) => void; onClose: () => void }

export default function TutorialTour({ step, onStep, onClose }: TutorialTourProps) {
  const current = steps[step];
  useEffect(() => {
    const targets = [
      ['[data-tour="budget"]'],
      ['[data-tour="search"]'],
      ['[data-tour="trade-card"]'],
      ['[data-tour="live"]', '[data-tour="friends"]'],
      ['.topbar .theme-picker', ".planner-bubble"],
    ][step] ?? [];
    const elements = targets.flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)));
    elements.forEach((element) => element.setAttribute("data-tour-highlight", "true"));
    return () => elements.forEach((element) => element.removeAttribute("data-tour-highlight"));
  }, [step]);
  if (!current) return null;
  return (
    <div className="tour-backdrop" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <section className="tour-card">
        <button className="icon-button tour-close" aria-label="Close tour" onClick={onClose}><X size={15} /></button>
        <div className="tour-avatar"><Bot size={23} /></div>
        <span className="tour-step">QUANTPULSE QUICK TOUR · {step + 1} / {steps.length}</span>
        <h2 id="tour-title">{current.title}</h2>
        <p>{current.body}</p>
        <div className="tour-progress">{steps.map((item, index) => <span key={item.title} className={index <= step ? "active" : ""} />)}</div>
        <div className="tour-actions">
          <button className="outline-button" disabled={step === 0} onClick={() => onStep(step - 1)}><ChevronLeft size={14} /> Back</button>
          <button className="lime-button" onClick={() => step === steps.length - 1 ? onClose() : onStep(step + 1)}>{step === steps.length - 1 ? "Finish tour" : <>Next <ChevronRight size={14} /></>}</button>
        </div>
      </section>
    </div>
  );
}
