import { Check } from 'lucide-react';
import type { ProgressStep } from './progress';

/** Where the tournament stands: every round and elimination as a step, always in view while working. */
export function TournamentProgress({ steps, onOpen }: { steps: ProgressStep[]; onOpen: (step: ProgressStep) => void }) {
  return <section className="tab-progress tab-no-project" aria-label="Progreso del torneo">
    <ol>{steps.map((step, index) => <li key={step.key} className={'tab-step ' + step.state}>
      <button type="button" onClick={() => onOpen(step)} aria-current={step.state === 'active' || step.state === 'draft' ? 'step' : undefined}
        title={step.label + (step.detail ? ': ' + step.detail : '')}>
        <span className="tab-step-dot">{step.state === 'done' ? <Check size={13} strokeWidth={3} /> : index + 1}</span>
        <span className="tab-step-text"><b>{step.label}</b>{step.detail && <small>{step.detail}</small>}</span>
      </button>
    </li>)}</ol>
  </section>;
}
