import { lazy, Suspense, useEffect } from 'react';
import Lobby from './lobby/Lobby';
import Hud from './hud/Hud';
import ErrorBoundary from './ui/ErrorBoundary';
import { bindSocket, socket } from './net/socket';
import { useSession } from './state/session';

const GameScene = lazy(() => import('./scene/GameScene'));

export default function App() {
  const roomId = useSession((s) => s.roomId);

  useEffect(() => {
    const unbind = bindSocket();
    socket.connect();
    return () => {
      unbind();
      socket.disconnect();
    };
  }, []);

  if (!roomId) return <Lobby />;

  // The lobby stays light; the 3D engine loads only once you've got a seat.
  return (
    <>
      <ErrorBoundary>
        <Suspense fallback={null}>
          <GameScene />
        </Suspense>
      </ErrorBoundary>
      <Hud />
    </>
  );
}
