export function DifficultyGuide({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  return (
    <aside className="guide" data-difficulty-guide aria-labelledby="guide-title">
      <div className="drawer-heading"><div><span className="eyebrow">Reference</span><h2 id="guide-title">Difficulty guide</h2></div><button className="text-action" onClick={onClose}>Close</button></div>
      <dl>
        <div><dt>Target range</dt><dd>The intended resistance. Generated measurements should land inside it.</dd></div>
        <div><dt>Base Cycle</dt><dd>Nineteen roles repeated through the campaign; edit one slot to change its linked occurrences.</dd></div>
        <div><dt>Progression</dt><dd>Offsets make selected roles harder in later repetitions while fixed recovery stays legible.</dd></div>
        <div><dt>Override</dt><dd>A deliberate exception for one level. Reset it to rejoin Journey inheritance.</dd></div>
        <div><dt>Lock</dt><dd>Protects an accepted board and its evidence from inherited regeneration until explicitly unlocked.</dd></div>
      </dl>
    </aside>
  );
}
