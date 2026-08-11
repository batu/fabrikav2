import type { LevelDef, MarbleColor } from '../../../../../games/marble_run/src/marble-board/types.ts';

const COLORS: Readonly<Record<string, string>> = {
  R: '#c85445', B: '#3c71aa', G: '#47866a', Y: '#d3a83e', P: '#82629b', O: '#cb763b',
};

export function BoardThumbnail({ board }: { readonly board: LevelDef }): React.JSX.Element {
  const cells = board.cells.flatMap((row, y) => [...row].map((cell, x) => ({ cell, x, y })));
  return (
    <svg className="board-thumbnail" viewBox={`-1 -1 ${board.cols + 2} ${board.rows + 2}`} role="img" aria-label={`Board ${board.id}, ${board.cols} by ${board.rows}`}>
      <rect x="-0.35" y="-0.35" width={board.cols + 0.7} height={board.rows + 0.7} rx=".55" className="board-thumbnail__tray" />
      {cells.map(({ cell, x, y }) => cell === '#' ? null : (
        <g key={`${x}-${y}`}>
          <circle cx={x + .5} cy={y + .5} r=".35" className={cell === 'X' ? 'board-thumbnail__plug' : 'board-thumbnail__well'} />
          {COLORS[cell] !== undefined && <circle cx={x + .5} cy={y + .5} r=".28" fill={COLORS[cell]} data-color={cell.toLowerCase() as MarbleColor} />}
        </g>
      ))}
      {board.gates.map((gate, index) => {
        const vertical = gate.side === 'left' || gate.side === 'right';
        const x = gate.side === 'left' ? -.62 : gate.side === 'right' ? board.cols + .12 : gate.index + .25;
        const y = gate.side === 'top' ? -.62 : gate.side === 'bottom' ? board.rows + .12 : gate.index + .25;
        return <rect key={`${gate.side}-${gate.index}-${index}`} x={x} y={y} width={vertical ? .5 : .5} height={vertical ? .5 : .5} rx=".12" fill={COLORS[gate.color[0]!.toUpperCase()] ?? '#20231f'} />;
      })}
    </svg>
  );
}
