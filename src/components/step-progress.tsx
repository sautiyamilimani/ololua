export function StepProgress({
  steps,
  currentStep,
  label,
}: {
  steps: string[];
  currentStep: number;
  label: string;
}) {
  return (
    <ol
      aria-label={label}
      className="grid gap-3 sm:grid-flow-col sm:auto-cols-fr"
    >
      {steps.map((step, index) => {
        const isComplete = index < currentStep;
        const isCurrent = index === currentStep;

        return (
          <li
            aria-current={isCurrent ? "step" : undefined}
            className="flex items-center gap-2 text-sm"
            key={step}
          >
            <span
              aria-hidden="true"
              className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                isComplete || isCurrent
                  ? "bg-teal-800 text-white"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {index + 1}
            </span>
            <span
              className={
                isCurrent
                  ? "font-semibold text-slate-950"
                  : isComplete
                    ? "font-medium text-teal-900"
                    : "text-slate-500"
              }
            >
              {step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
