"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, type RemoteParticipant } from "livekit-client";

interface TurnLine {
  who: string;
  text: string;
  reply: boolean;
}

export default function Page() {
  const roomRef = useRef<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("Not connected. Join the room and speak.");
  const [lines, setLines] = useState<TurnLine[]>([]);

  const disconnect = useCallback(async () => {
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setConnected(false);
    setStatus("Disconnected.");
  }, []);

  const connect = useCallback(async () => {
    try {
      setStatus("Connecting…");
      const res = await fetch("/api/token?room=soulbound");
      const data = (await res.json()) as { token?: string; error?: string };
      if (!data.token) throw new Error(data.error ?? "no token returned");
      const url = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? "ws://localhost:7880";
      const room = new Room();
      roomRef.current = room;
      room.on(RoomEvent.DataReceived, (payload: Uint8Array, _p?: RemoteParticipant, _k?: unknown, topic?: string) => {
        if (topic !== "turn") return;
        try {
          const rec = JSON.parse(new TextDecoder().decode(payload)) as {
            speaker: string | null; kind: string; transcript: string; reply: string; model: string;
          };
          setLines((prev) => [
            ...prev,
            { who: `diarized speaker=${rec.speaker ?? "?"} (${rec.kind})`, text: rec.transcript, reply: false },
            { who: `SOULBOUND · ${rec.model}`, text: rec.reply, reply: true },
          ]);
        } catch { /* ignore malformed data packets */ }
      });
      room.on(RoomEvent.Disconnected, () => { setConnected(false); setStatus("Disconnected."); });
      await room.connect(url, data.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      setConnected(true);
      setStatus("Connected. Speak — your words will appear below.");
    } catch (err) {
      setStatus(`Could not connect: ${(err as Error).message}`);
    }
  }, []);

  useEffect(() => () => { void roomRef.current?.disconnect(); }, []);

  return (
    <main>
      <h1>SOULBOUND</h1>
      <p className="sub">Talk to it and it changes — and every change is provable.</p>
      <div className="stage">
        <div className="avatar" aria-label="Character placeholder">S</div>
        <div>
          <p className="status" role="status">{status}</p>
          <button onClick={connected ? disconnect : connect}>{connected ? "Leave" : "Join room"}</button>
        </div>
      </div>
      <section className="log" aria-live="polite">
        {lines.map((line, i) => (
          <div key={i} className={line.reply ? "line reply" : "line"}>
            <span className="who">{line.who}</span>
            {line.text}
          </div>
        ))}
      </section>
    </main>
  );
}
