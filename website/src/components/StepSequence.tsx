interface Step {
  title: string;
  body: string;
}

interface StepSequenceProps {
  steps: Step[];
  eyebrow?: string;
  startAt?: number;
}

export function StepSequence({ steps, eyebrow, startAt = 1 }: StepSequenceProps) {
  return (
    <div className="flex flex-col gap-0">
      {eyebrow && (
        <span className="mb-4 font-mono text-xs uppercase tracking-[0.18em] text-ink-200">
          {eyebrow}
        </span>
      )}
      <ol className="flex flex-col">
        {steps.map((step, idx) => {
          const n = startAt + idx;
          return (
            <li
              key={step.title}
              className="grid grid-cols-[auto_1fr] gap-x-6 border-t border-ink-500/40 py-6 first:border-t-0"
            >
              <span className="font-mono text-sm text-ink-300">
                {String(n).padStart(2, '0')}
              </span>
              <div className="flex flex-col gap-2">
                <h3 className="text-xl font-medium text-ink-50">{step.title}</h3>
                <p className="max-w-prose-tight text-ink-200">{step.body}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
