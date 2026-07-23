interface Props {
  stepNumber: number;
  title: string;
  collapsed: boolean;
  onToggle?: () => void;
  summary?: string;
}

export default function StepHeader({ stepNumber, title, collapsed, onToggle, summary }: Props) {
  return (
    <div className="step-header" onClick={onToggle} style={{ cursor: onToggle ? 'pointer' : 'default' }}>
      <div className="step-header-left">
        <span className="step-badge">{stepNumber}</span>
        <h2 className="step-title">{title}</h2>
      </div>
      {collapsed && summary && (
        <span className="step-summary">{summary}</span>
      )}
      {onToggle && (
        <span className="step-toggle">{collapsed ? 'Expand' : 'Collapse'}</span>
      )}
    </div>
  );
}
