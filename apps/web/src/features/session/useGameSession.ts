import type { Ack, ClientToServerEvents, GameSnapshot, PlayerSnapshot, ServerToClientEvents, SubmitOrderAck } from '@beer-game/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { acceptSnapshot } from '../../lib/snapshots';
import { clearPending, readPending, readSeat, writePending, type PendingOrder } from '../../lib/storage';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

export type LinkStatus = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'replaced' | 'closed';

export function useGameSession(code: string, mode: 'player' | 'spectator' | 'off') {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [link, setLink] = useState<LinkStatus>(mode === 'off' ? 'closed' : 'connecting');
  const [notice, setNotice] = useState<string | null>(null);
  const [replaced, setReplaced] = useState(false);
  const [sending, setSending] = useState(false);
  const socketRef = useRef<Client | null>(null);
  const snapshotRef = useRef<GameSnapshot | null>(null);
  const inflight = useRef(false);

  const apply = useCallback((next: GameSnapshot) => {
    setSnapshot((current) => {
      const accepted = acceptSnapshot(current, next);
      snapshotRef.current = accepted;
      return accepted;
    });
  }, []);

  const flush = useCallback(
    async (socket: Client, current: GameSnapshot) => {
      if (inflight.current || current.kind !== 'player') return;
      const pending = readPending(code);
      if (!pending) return;
      if (current.station?.submitted || current.round !== pending.round || current.status !== 'playing') {
        clearPending(code);
        return;
      }
      inflight.current = true;
      try {
        const ack = await socket.timeout(4000).emitWithAck('round:submit-order', pending);
        if (ack.ok || (!ack.ok && ack.error.code === 'ALREADY_SUBMITTED')) clearPending(code);
      } catch {
        setNotice('Order is still queued. It will transmit when the link returns.');
      } finally {
        inflight.current = false;
      }
    },
    [code],
  );

  const connect = useCallback(() => {
    const seat = readSeat(code);
    if (mode === 'player' && !seat) {
      setLink('closed');
      return;
    }
    socketRef.current?.disconnect();
    const socket: Client = io({
      auth: mode === 'spectator' ? { gameCode: code, spectator: true } : { gameCode: code, seatToken: seat?.seatToken },
      reconnection: true,
      reconnectionAttempts: Infinity,
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;
    setLink(navigator.onLine ? 'connecting' : 'offline');

    socket.on('connect', () => {
      setLink('live');
      setReplaced(false);
      const current = snapshotRef.current;
      if (current) void flush(socket, current);
    });
    socket.on('disconnect', (reason) => {
      if (reason === 'io client disconnect') return;
      setLink(navigator.onLine ? 'reconnecting' : 'offline');
    });
    socket.io.on('reconnect_attempt', () => setLink('reconnecting'));
    socket.on('connect_error', () => setLink(navigator.onLine ? 'reconnecting' : 'offline'));
    socket.on('game:state', (next) => {
      apply(next);
      void flush(socket, next);
    });
    socket.on('session:replaced', () => {
      setReplaced(true);
      setLink('replaced');
      socket.disconnect();
    });
    socket.on('game:error', (error) => setNotice(error.message));
    socket.on('round:completed', ({ round }) => setNotice(`Round ${String(round).padStart(2, '0')} locked`));
    socket.on('game:finished', () => setNotice('Simulation complete. Open the debrief.'));
  }, [apply, code, flush, mode]);

  useEffect(() => {
    if (mode === 'off') {
      setLink('closed');
      return;
    }
    connect();
    const onOffline = () => setLink('offline');
    const onOnline = () => {
      setLink((current) => (current === 'offline' ? 'reconnecting' : current));
      if (!socketRef.current?.connected) socketRef.current?.connect();
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [connect, mode]);

  const submit = useCallback(
    async (quantity: number) => {
      const current = snapshotRef.current;
      if (!current || current.kind !== 'player' || current.status !== 'playing') {
        throw new Error('The round is not accepting orders');
      }
      const existing = readPending(code);
      const pending: PendingOrder =
        existing && existing.round === current.round
          ? { ...existing, quantity }
          : { submissionId: crypto.randomUUID(), round: current.round, quantity };
      writePending(code, pending);
      const socket = socketRef.current;
      if (!socket?.connected) {
        setNotice('Order queued. It will transmit when the link returns.');
        return;
      }
      setSending(true);
      try {
        const ack: Ack<SubmitOrderAck> = await socket.timeout(4000).emitWithAck('round:submit-order', pending);
        if (!ack.ok) {
          if (ack.error.code === 'ALREADY_SUBMITTED') {
            clearPending(code);
            return;
          }
          throw new Error(ack.error.message);
        }
        clearPending(code);
      } finally {
        setSending(false);
      }
    },
    [code],
  );

  const takeControl = useCallback(() => {
    setReplaced(false);
    setLink('connecting');
    connect();
  }, [connect]);

  const player: PlayerSnapshot | null = snapshot?.kind === 'player' ? snapshot : null;

  return { snapshot, player, link, notice, replaced, sending, submit, takeControl, clearNotice: () => setNotice(null) };
}
