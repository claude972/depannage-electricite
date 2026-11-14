import { Icon } from "./icons";

export function RequestProgress({ step, labels }: { step: number; labels: string[] }) {
  return <ol className="stepper" aria-label="Étapes de la demande">
    {labels.map((label, index) => (
      <li key={label} className={step >= index + 1 ? "current" : ""} aria-current={step === index + 1 ? "step" : undefined}>
        <span aria-hidden="true">{step > index + 1 ? <Icon name="check" size={15} /> : index + 1}</span>
        <strong>{label}</strong>
      </li>
    ))}
  </ol>;
}
