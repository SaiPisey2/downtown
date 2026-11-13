import { useGame } from '../game/store';
import { Board } from '../scene/Board';

export function App() {
  const caseId = useGame((s) => s.caseId);
  if (!caseId) return <main data-testid="app">Downtown</main>;
  return (
    <main data-testid="app" style={{ position: 'fixed', inset: 0, background: '#060a18' }}>
      <Board />
    </main>
  );
}
