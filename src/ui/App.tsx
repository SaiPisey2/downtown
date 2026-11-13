import { useGame } from '../game/store';
import { Board } from '../scene/Board';
import { Play } from './screens/Play';

export function App() {
  const caseId = useGame((s) => s.caseId);
  const screen = useGame((s) => s.screen);
  if (!caseId) return <main data-testid="app">Downtown</main>;
  return (
    <main data-testid="app" style={{ position: 'fixed', inset: 0, background: '#060a18' }}>
      {screen === 'play' ? <Play /> : <Board />}
    </main>
  );
}
