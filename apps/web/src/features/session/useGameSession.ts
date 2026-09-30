import type {
  Ack,
  ClientToServerEvents,
  GameSnapshot,
  PlayerSnapshot,
  PublicPresence,
  ServerToClientEvents,
  SubmitOrderAck,
} from '@beer-game/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { acceptSnapshot } from '../../lib/snapshots';
import {
  clearPending,
  readPending,
  readSeat,
  writePending,
  type PendingOrder,
} from '../../lib/storage';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const QUEUED_NOTICE = 'Order queued. It will transmit when the link returns.';
const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;

export type LinkStatus = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'replaced' | 'closed';
export type SessionMode = 'player' | 'spectator' | 'lobby' | 'off';

export function useGameSession(code: string, mode: SessionMode) {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [presence, setPresence] = useState<PublicPresence | null>(null);
  const [missing, setMissing] = useState(false);
  const [link, setLink] = useState<LinkStatus>(mode === 'off' ? 'closed' : 'connecting');
  const [notice, setNotice] = useState<string | null>(null);
  const [replaced, setReplaced] = useState(false);
  const [sending, setSending] = useState(false);
  const socketRef = useRef<Client | null>(null);
  const snapshotRef = useRef<GameSnapshot | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const inflight = useRef(false);
  const seenCode = useRef(code);

  const apply = useCallback((next: GameSnapshot) => {
    setSnapshot((current) => {
      const accepted = acceptSnapshot(current, next);
      snapshotRef.current = accepted;
      return accepted;
    });
  }, []);

  const send = useCallback(
    async (socket: Client, pending: PendingOrder) => {
      if (inflight.current) return;
      inflight.current = true;
      setSending(true);
      try {
        const ack: Ack<SubmitOrderAck> = await socket
          .timeout(4000)
          .emitWithAck('round:submit-order', pending);
        if (!ack.ok && ack.error.code !== 'ALREADY_SUBMITTED') throw new Error(ack.error.message);
        clearPending(code);
        setNotice((current) => (current === QUEUED_NOTICE ? null : current));
      } finally {
        inflight.current = false;
        setSending(false);
      }
    },
    [code],
  );

  const flush = useCallback(
    async (socket: Client, current: GameSnapshot) => {
      if (current.kind !== 'player') return;
      const pending = readPending(code);
      if (!pending) return;
      if (
        current.station?.submitted ||
        current.round !== pending.round ||
        current.status !== 'playing'
      ) {
        clearPending(code);
        return;
      }
      try {
        await send(socket, pending);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : 'Order is still queued. It will transmit when the link returns.',
        );
      }
    },
    [code, send],
  );

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current !== null) {
      window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    const seat = readSeat(code);
    stopHeartbeat();
    socketRef.current?.disconnect();
    socketRef.current = null;
    if (mode === 'off' || (mode === 'player' && !seat)) {
      setLink('closed');
      return;
    }
    setMissing(false);
    const auth =
      mode === 'spectator'
        ? { gameCode: code, spectator: true }
        : mode === 'lobby'
          ? { gameCode: code, lobby: true }
          : { gameCode: code, seatToken: seat?.seatToken };
    const socket: Client = io({
      auth,
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;
    const isCurrent = () => socketRef.current === socket;
    setLink(navigator.onLine ? 'connecting' : 'offline');

    const startHeartbeat = () => {
      stopHeartbeat();
      heartbeatRef.current = window.setInterval(() => {
        if (!isCurrent() || !socket.connected) return;
        void socket
          .timeout(HEARTBEAT_TIMEOUT_MS)
          .emitWithAck('connection:ping')
          .catch(() => {
            if (!isCurrent() || !socket.connected) return;
            stopHeartbeat();
            setLink(navigator.onLine ? 'reconnecting' : 'offline');
            if (socket.io.engine) {
              socket.io.engine.close();
              return;
            }
            socket.disconnect();
            socket.connect();
          });
      }, HEARTBEAT_INTERVAL_MS);
    };

    socket.on('connect', () => {
      if (!isCurrent()) return;
      setLink('live');
      setReplaced(false);
      setMissing(false);
      startHeartbeat();
      const current = snapshotRef.current;
      if (current) void flush(socket, current);
    });
    socket.on('disconnect', (reason) => {
      stopHeartbeat();
      if (!isCurrent() || reason === 'io client disconnect') return;
      setLink(navigator.onLine ? 'reconnecting' : 'offline');
    });
    socket.io.on('reconnect_attempt', () => {
      if (isCurrent()) setLink('reconnecting');
    });
    socket.on('connect_error', (error) => {
      if (!isCurrent()) return;
      if (error.message === 'GAME_NOT_FOUND') {
        stopHeartbeat();
        socket.io.reconnection(false);
        socket.disconnect();
        setMissing(true);
        setLink('closed');
        return;
      }
      setLink(navigator.onLine ? 'reconnecting' : 'offline');
    });
    socket.on('lobby:updated', (next) => {
      if (!isCurrent()) return;
      setPresence((current) => acceptSnapshot(current, next));
    });
    socket.on('game:state', (next) => {
      if (!isCurrent()) return;
      apply(next);
      void flush(socket, next);
    });
    socket.on('session:replaced', () => {
      if (!isCurrent()) return;
      setReplaced(true);
      setLink('replaced');
      socket.disconnect();
    });
    socket.on('game:error', (error) => {
      if (isCurrent()) setNotice(error.message);
    });
    socket.on('round:completed', ({ round }) => {
      if (isCurrent()) setNotice(`Round ${String(round).padStart(2, '0')} locked`);
    });
    socket.on('game:finished', () => {
      if (isCurrent()) setNotice('Simulation complete. Open the debrief.');
    });
  }, [apply, code, flush, mode, stopHeartbeat]);

  useEffect(() => {
    if (seenCode.current !== code) {
      seenCode.current = code;
      setSnapshot(null);
      snapshotRef.current = null;
      setPresence(null);
      setMissing(false);
    }
    connect();
    if (mode === 'off') return;
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
      stopHeartbeat();
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [code, connect, mode, stopHeartbeat]);

  const submit = useCallback(
    async (quantity: number) => {
      const current = snapshotRef.current;
      if (!current || current.kind !== 'player' || current.status !== 'playing') {
        throw new Error('The round is not accepting orders');
      }
      if (inflight.current) return;
      const existing = readPending(code);
      const pending: PendingOrder =
        existing && existing.round === current.round
          ? { ...existing, quantity }
          : { submissionId: crypto.randomUUID(), round: current.round, quantity };
      writePending(code, pending);
      const socket = socketRef.current;
      if (!socket?.connected) {
        setNotice(QUEUED_NOTICE);
        return;
      }
      await send(socket, pending);
    },
    [code, send],
  );

  const takeControl = useCallback(() => {
    setReplaced(false);
    setLink('connecting');
    connect();
  }, [connect]);

  const player: PlayerSnapshot | null = snapshot?.kind === 'player' ? snapshot : null;

  return {
    snapshot,
    presence,
    missing,
    player,
    link,
    notice,
    replaced,
    sending,
    submit,
    takeControl,
  };
}
