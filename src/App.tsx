import { useCallback, useEffect, useRef, useState } from 'react';
import { signInAnonymously } from 'firebase/auth';
import { onDisconnect, onValue, ref, serverTimestamp, set, update } from 'firebase/database';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, CircleHelp, Copy, ExternalLink, Headphones, Link2, LoaderCircle, Music2, Pause, Play, Plus, Radio, Share2, Signal, Smartphone, Upload, Volume2, VolumeX, Wifi } from 'lucide-react';
import { auth, configured, db } from './firebase';
import type { Member, Playback, YTPlayer } from './types';
import { loadYouTubeApi } from './youtube';

const roomRef = (id: string, path = '') => ref(db!, `rooms/${id}${path ? `/${path}` : ''}`);
const getRoomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const formatTime = (time: number) => `${Math.floor((time || 0) / 60)}:${String(Math.floor((time || 0) % 60)).padStart(2, '0')}`;

export default function App() {
  const [uid, setUid] = useState('');
  const [roomId, setRoomId] = useState(new URLSearchParams(location.search).get('room')?.toUpperCase() || '');
  const [room, setRoom] = useState<Playback | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState(localStorage.getItem('syncmusic-name') || 'Listener');
  const [inputCode, setInputCode] = useState(new URLSearchParams(location.search).get('room') || '');
  const [status, setStatus] = useState('Connecting your session…');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [playerBooting, setPlayerBooting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [clockOffset, setClockOffset] = useState(0);
  const [volume, setVolume] = useState(76);
  const [muted, setMuted] = useState(false);
  const [uploading, setUploading] = useState(false);
  const playerRef = useRef<YTPlayer | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const roomLiveRef = useRef<Playback | null>(room);
  roomLiveRef.current = room;
  const playerHost = useRef<HTMLDivElement>(null);
  const applying = useRef(false);
  const lastCommand = useRef('');
  const driftTimer = useRef<number | undefined>();
  const writeTimer = useRef<number | undefined>();

  useEffect(() => {
    if (!configured || !auth) return;
    signInAnonymously(auth)
      .then((credential) => setUid(credential.user.uid))
      .catch((error: Error & { code?: string }) => {
        setStatus(error.code === 'auth/operation-not-allowed'
          ? 'Anonymous sign-in is disabled. In Firebase Console, open Authentication → Sign-in method → Anonymous and enable it.'
          : `Firebase sign-in failed${error.code ? ` (${error.code})` : ''}: ${error.message}`);
      });
  }, []);

  useEffect(() => {
    if (!db) return;
    return onValue(ref(db, '.info/serverTimeOffset'), (snapshot) => setClockOffset(snapshot.val() || 0));
  }, []);

  useEffect(() => {
    if (!roomId || !db || !uid) return;
    const unsubRoom = onValue(roomRef(roomId, 'state'), (snapshot) => {
      const state = snapshot.val() as Playback | null; setRoom(state);
      if (!state) setStatus('This room is no longer available');
    }, (error) => setStatus(`Room connection lost: ${error.message}`));
    const unsubMembers = onValue(roomRef(roomId, 'members'), (snapshot) => {
      const data = snapshot.val() as Record<string, Omit<Member, 'uid'>> | null;
      setMembers(data ? Object.entries(data).map(([memberUid, member]) => ({ ...member, uid: memberUid })) : []);
    }, (error) => setStatus(`Connection issue: ${error.message}`));
    return () => { unsubRoom(); unsubMembers(); window.clearInterval(driftTimer.current); window.clearTimeout(writeTimer.current); playerRef.current?.destroy(); playerRef.current = null; setReady(false); };
  }, [roomId, uid]);

  useEffect(() => {
    if (!roomId || !uid || !db) return;
    const member = roomRef(roomId, `members/${uid}`);
    const myName = name.trim() || 'Listener';
    void set(member, { name: myName, online: true, joinedAt: Date.now() }).catch((error: Error) => setStatus(`Could not register this listener: ${error.message}`));
    const disconnect = onDisconnect(member); void disconnect.update({ online: false });
    return () => { void disconnect.cancel(); void update(member, { online: false }); };
  }, [roomId, uid]); // presence is associated with this connection, not a name edit

  useEffect(() => { if (uid && name) localStorage.setItem('syncmusic-name', name); }, [uid, name]);

  useEffect(() => {
    if (!room) return;
    playerRef.current?.destroy(); playerRef.current = null;
    setReady(false); setPlayerBooting(false); setPlaying(false);
  }, [room?.source]);

  const currentTrack = room?.localPlaylist?.[room.currentTrackIndex || 0];
  const localUrl = currentTrack?.url || '';

  const publish = useCallback((patch: Partial<Playback>) => {
    if (!db || !roomId || !room || room.masterUid !== uid) return;
    const next = { ...patch, serverTimestamp: serverTimestamp(), commandId: crypto.randomUUID() };
    void update(roomRef(roomId, 'state'), next).catch((error: Error) => setStatus(`Could not sync: ${error.message}`));
  }, [roomId, room, uid]);

  const applyRemote = useCallback((state: Playback) => {
    if (state.source === 'local') return;
    const player = playerRef.current;
    if (!player || !state.videoId || state.commandId === lastCommand.current) return;
    lastCommand.current = state.commandId; applying.current = true;
    const elapsed = state.playbackState === 'playing' ? Math.max(0, (Date.now() + clockOffset - state.serverTimestamp) / 1000) * state.playbackRate : 0;
    const expected = Math.max(0, state.playbackPosition + elapsed);
    const currentId = player.getVideoData?.().video_id;
    if (currentId !== state.videoId) { setStatus('Loading shared track…'); if (state.playbackState === 'playing') player.loadVideoById(state.videoId, expected); else player.cueVideoById(state.videoId, expected); }
    else if (Math.abs((player.getCurrentTime?.() || 0) - expected) > 1.8) player.seekTo(expected, true);
    if (state.playbackState === 'playing') { player.setPlaybackRate(state.playbackRate || 1); player.playVideo(); setStatus('In sync with the room'); }
    else { player.pauseVideo(); setStatus('Paused by the host'); }
    window.setTimeout(() => { applying.current = false; }, 800);
  }, [clockOffset]);

  useEffect(() => { if (room && ready) applyRemote(room); }, [room?.commandId, ready, applyRemote]);

  const localMatchesRoom = Boolean(room?.source === 'local' && room.localPlaylist?.length && room.localPlaylist.every((track) => Boolean(track.url)));
  useEffect(() => {
    if (!ready || room?.source !== 'local' || !localMatchesRoom || !audioRef.current || !room.localTrackName || !localUrl) return;
    const audio = audioRef.current;
    const effectiveStart = Math.max(room.serverTimestamp, room.startAt || 0);
    const elapsed = room.playbackState === 'playing' ? Math.max(0, (Date.now() + clockOffset - effectiveStart) / 1000) * (room.playbackRate || 1) : 0;
    const expected = Math.max(0, room.playbackPosition + elapsed);
    applying.current = true;
    if (Math.abs(audio.currentTime - expected) > 1.25) audio.currentTime = expected;
    if (room.playbackState === 'playing') {
      const delay = Math.max(0, effectiveStart - (Date.now() + clockOffset));
      if (delay) {
        const timer = window.setTimeout(() => { applying.current = true; void audio.play().then(() => setStatus('Local track synced with the room')).catch(() => setStatus('Tap Join & enable audio to allow playback')); window.setTimeout(() => { applying.current = false; }, 500); }, delay);
        return () => window.clearTimeout(timer);
      }
      void audio.play().then(() => setStatus('Local track synced with the room')).catch(() => setStatus('Tap Join & enable audio to allow playback'));
    } else { audio.pause(); setStatus('Paused by the host'); }
    window.setTimeout(() => { applying.current = false; }, 500);
  }, [room?.commandId, room?.source, room?.currentTrackIndex, room?.startAt, ready, localMatchesRoom, clockOffset, localUrl]);

  const createRoom = async () => {
    if (!db || !uid) return;
    setBusy(true);
    try {
      const code = getRoomCode();
      await set(roomRef(code, 'state'), { roomId: code, masterUid: uid, source: 'local', videoId: '', playlistName: 'Aarti', localPlaylist: [], currentTrackIndex: 0, playbackState: 'paused', playbackPosition: 0, serverTimestamp: serverTimestamp(), playbackRate: 1, commandId: crypto.randomUUID() });
      setRoomId(code); setRoom(null); history.pushState({}, '', `?room=${code}`); setStatus('Room created — invite your people');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not create room'); }
    finally { setBusy(false); }
  };

  const joinRoom = async (code = inputCode) => {
    if (!db || !uid || !code.trim()) return;
    const cleaned = code.trim().toUpperCase(); setBusy(true);
    try {
      const myName = name.trim() || 'Listener';
      await set(roomRef(cleaned, `members/${uid}`), { name: myName, online: true, joinedAt: Date.now() });
      const snapshot = await new Promise<Playback | null>((resolve, reject) => onValue(roomRef(cleaned, 'state'), (value) => { resolve(value.val()); }, reject, { onlyOnce: true }));
      if (!snapshot) { setStatus('Room not found. Check the code and try again.'); return; }
      setRoomId(cleaned); setRoom(snapshot); history.pushState({}, '', `?room=${cleaned}`); setStatus('Connected to the room');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Unable to join room'); }
    finally { setBusy(false); }
  };

  const setupPlayer = async () => {
    if (!room || !playerHost.current) return;
    if (room.source === 'local') {
      if (!localMatchesRoom || !audioRef.current) { setStatus('Waiting for the host to upload the MP3 playlist'); return; }
      const audio = audioRef.current;
      applying.current = true;
      audio.muted = true;
      audio.load();
      void audio.play().then(() => { audio.pause(); audio.muted = muted; }).catch(() => { audio.muted = muted; });
      window.setTimeout(() => { applying.current = false; }, 800);
      setReady(true); setStatus('Joined the room — following the host'); return;
    }
    setPlayerBooting(true); setStatus('Waking up the player…'); await loadYouTubeApi();
    const host = playerHost.current;
    host.innerHTML = '<div id="youtube-player"></div>';
    const player = new window.YT!.Player('youtube-player', {
      width: '100%', height: '100%', videoId: room.videoId || undefined,
      playerVars: { autoplay: 0, controls: 1, rel: 0, playsinline: 1, enablejsapi: 1, origin: location.origin },
      events: {
        onReady: (event: { target: YTPlayer }) => { playerRef.current = event.target; event.target.setVolume(volume); setTime(event.target.getCurrentTime()); setDuration(event.target.getDuration()); setPlayerBooting(false); setReady(true); setStatus('Player ready on this device'); if (room.videoId) applyRemote(room); },
        onStateChange: (event: { data: number; target: YTPlayer }) => {
          const states = window.YT!.PlayerState;
          if (event.data === states.PLAYING) {
            if (event.target.getPlayerState() !== states.PLAYING) return;
            setPlaying(true); setStatus('Playing');
            const liveRoom = roomLiveRef.current;
            const actualPosition = event.target.getCurrentTime();
            const expectedPosition = liveRoom ? liveRoom.playbackPosition + (liveRoom.playbackState === 'playing' ? Math.max(0, (Date.now() + clockOffset - liveRoom.serverTimestamp) / 1000) * liveRoom.playbackRate : 0) : 0;
            const videoId = event.target.getVideoData().video_id || liveRoom?.videoId || '';
            if (liveRoom?.masterUid === uid && (liveRoom.playbackState !== 'playing' || liveRoom.videoId !== videoId || Math.abs(actualPosition - expectedPosition) > 2)) {
              publish({ playbackState: 'playing', playbackPosition: actualPosition, videoId, title: event.target.getVideoData().title });
            }
          }
          else if (event.data === states.PAUSED) {
            if (event.target.getPlayerState() !== states.PAUSED) return;
            setPlaying(false); setTime(event.target.getCurrentTime()); setDuration(event.target.getDuration());
            const liveRoom = roomLiveRef.current;
            const actualPosition = event.target.getCurrentTime();
            const expectedPosition = liveRoom ? liveRoom.playbackPosition + (liveRoom.playbackState === 'playing' ? Math.max(0, (Date.now() + clockOffset - liveRoom.serverTimestamp) / 1000) * liveRoom.playbackRate : 0) : 0;
            if (liveRoom?.masterUid === uid && (liveRoom.playbackState !== 'paused' || Math.abs(actualPosition - expectedPosition) > 1.5)) {
              publish({ playbackState: 'paused', playbackPosition: actualPosition });
            }
          }
          else if (event.data === states.BUFFERING) setStatus('Buffering…');
          else if (event.data === states.ENDED) { setPlaying(false); const liveRoom = roomLiveRef.current; if (liveRoom?.masterUid === uid && liveRoom.playlist?.length) { const index = ((liveRoom.currentTrackIndex || 0) + 1) % liveRoom.playlist.length; publish({ currentTrackIndex: index, videoId: liveRoom.playlist[index], playbackState: 'playing', playbackPosition: 0 }); } }
        },
        onError: (event: { data: number }) => { setPlayerBooting(true); setStatus(event.data === 101 || event.data === 150 ? 'This video cannot be embedded by YouTube' : event.data === 153 ? 'YouTube needs the site referrer to play this video. Open this room on localhost or your deployed site, not from a file preview.' : `YouTube player error (${event.data})`); },
        onAutoplayBlocked: () => setStatus('Playback needs a tap on this device — press Play when you’re ready'),
      },
    });
    playerRef.current = player;
    if (room.masterUid === uid) setStatus('Tap play when everyone is ready');
    else setStatus('Player ready — waiting for the host');
  };

  const lastCheckpoint = useRef(0);
  useEffect(() => {
    if (!ready || !room || (room.source === 'local' ? !audioRef.current : !playerRef.current)) return;
    window.clearInterval(driftTimer.current);
    driftTimer.current = window.setInterval(() => {
      const audio = room.source === 'local' ? audioRef.current : null;
      const player = room.source === 'local' ? null : playerRef.current;
      if ((!audio && !player) || (audio && !localMatchesRoom) || applying.current) return;
      const current = audio ? audio.currentTime : player!.getCurrentTime();
      setTime(current); setDuration(audio ? audio.duration || 0 : player!.getDuration());
      if (room.source === 'local' && room.playbackState === 'playing' && room.startAt && Date.now() + clockOffset < room.startAt) return;
      const effectiveStart = Math.max(room.serverTimestamp, room.startAt || 0);
      const elapsed = Math.max(0, (Date.now() + clockOffset - effectiveStart) / 1000) * (room.playbackRate || 1);
      const expected = room.playbackPosition + (room.playbackState === 'playing' ? elapsed : 0);
      const drift = expected - current;
      if (room.playbackState === 'paused') {
        if (room.masterUid !== uid) {
          if (audio && !audio.paused) { applying.current = true; audio.pause(); window.setTimeout(() => { applying.current = false; }, 500); }
          if (player) {
            const state = player.getPlayerState();
            if (state === window.YT!.PlayerState.PLAYING || state === window.YT!.PlayerState.BUFFERING) {
              applying.current = true; player.pauseVideo(); window.setTimeout(() => { applying.current = false; }, 500);
            }
            if (room.videoId && player.getVideoData().video_id !== room.videoId) { applying.current = true; player.cueVideoById(room.videoId, expected); window.setTimeout(() => { applying.current = false; }, 500); }
            if (Math.abs(drift) > 1.5) player.seekTo(expected, true);
          }
        }
        return;
      }
      if (room.masterUid !== uid && audio?.paused) void audio.play().catch(() => setStatus('Tap Play to resume this local track on your device'));
      if (room.masterUid !== uid && player) {
        if (room.videoId && player.getVideoData().video_id !== room.videoId) {
          applying.current = true; player.loadVideoById(room.videoId, expected); window.setTimeout(() => { applying.current = false; }, 700); return;
        }
        const state = player.getPlayerState();
        if (state !== window.YT!.PlayerState.PLAYING && state !== window.YT!.PlayerState.BUFFERING) player.playVideo();
      }
      if (Math.abs(drift) > 2.2) { if (audio) audio.currentTime = expected; else player!.seekTo(expected, true); }
      else if (!audio && Math.abs(drift) > 0.45) player!.setPlaybackRate(drift > 0 ? 1.05 : 0.95);
      else if (player) player.setPlaybackRate(1);
      if (room.masterUid === uid && Date.now() - lastCheckpoint.current >= 15000) {
        lastCheckpoint.current = Date.now();
        publish({ playbackPosition: audio ? audio.currentTime : player!.getCurrentTime(), playbackState: 'playing' });
      }
    }, 1500);
    return () => window.clearInterval(driftTimer.current);
  }, [ready, room?.source, room?.videoId, room?.playbackState, room?.serverTimestamp, room?.masterUid, uid, publish, clockOffset, localMatchesRoom]);

  const selectLocalFiles = async (selectedFiles: File[]) => {
    const files = selectedFiles
      .filter((file) => file.name.toLowerCase().endsWith('.mp3') || file.type === 'audio/mpeg')
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    if (!files.length || files.length !== selectedFiles.length) { setStatus('Choose MP3 files only.'); return; }
    if (room?.masterUid === uid) {
      setUploading(true); setStatus('Uploading MP3 playlist to this Wi‑Fi room…');
      try {
        const playlist = [];
        for (const [index, file] of files.entries()) {
          const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/tracks/${index}`, { method: 'PUT', headers: { 'Content-Type': 'audio/mpeg', 'X-Track-Name': encodeURIComponent(file.name) }, body: file });
          if (!response.ok) throw new Error(await response.text() || `Upload failed (${response.status})`);
          playlist.push({ name: file.name, size: file.size, url: `${location.origin}/api/rooms/${encodeURIComponent(roomId)}/tracks/${index}` });
        }
        publish({ source: 'local', videoId: '', playlist: [], localPlaylist: playlist, playlistName: 'Aarti', currentTrackIndex: 0, localTrackName: files[0].name, localTrackSize: files[0].size, localTrackDuration: 0, playbackPosition: 0, playbackState: 'paused', title: `Aarti · ${files[0].name}` });
        setStatus(`${files.length} MP3 tracks ready. Listeners can join and listen.`);
      } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not upload MP3 files. Open this app from the host computer’s Wi‑Fi address.'); }
      finally { setUploading(false); }
    }
  };
  const togglePlayback = () => {
    const isFollower = room?.masterUid !== uid;
    if (isFollower && room?.playbackState !== 'playing') { setStatus('Waiting for the host to start playback'); return; }
    if (room?.source === 'local') {
      const audio = audioRef.current; if (!audio || !localMatchesRoom) { setStatus('Waiting for the host to upload the MP3 playlist'); return; }
      if (isFollower) { void audio.play().catch(() => setStatus('Tap Play again to allow local audio on this device')); return; }
      if (playing) audio.pause(); else publish({ playbackState: 'playing', playbackPosition: audio.currentTime, startAt: Date.now() + clockOffset + 1500 });
      return;
    }
    if (!playerRef.current) { void setupPlayer(); return; }
    if (isFollower) { playerRef.current.playVideo(); return; }
    if (playing) playerRef.current.pauseVideo(); else { playerRef.current.playVideo(); if (!room?.videoId) setStatus('Add a YouTube track first'); }
  };
  const seek = (value: number) => { if (room?.source === 'local' && audioRef.current) audioRef.current.currentTime = value; else playerRef.current?.seekTo(value, true); setTime(value); if (room?.masterUid === uid) publish({ playbackPosition: value, playbackState: playing ? 'playing' : 'paused' }); };
  const changeTrack = (delta: number) => {
    if (room?.source === 'local') {
      if (room.masterUid !== uid || !room.localPlaylist?.length) return;
      const index = (Math.max(0, room.currentTrackIndex || 0) + delta + room.localPlaylist.length) % room.localPlaylist.length;
      const track = room.localPlaylist[index];
      applying.current = true;
      window.setTimeout(() => { applying.current = false; }, 800);
      publish({ currentTrackIndex: index, localTrackName: track.name, localTrackSize: track.size, localTrackDuration: 0, title: `${room.playlistName || 'Aarti'} · ${track.name}`, playbackPosition: 0, playbackState: 'playing', startAt: Date.now() + clockOffset + 1500 });
      return;
    }
    if (room?.masterUid !== uid || !room.playlist?.length) return;
    const index = (Math.max(0, room.currentTrackIndex || 0) + delta + room.playlist.length) % room.playlist.length;
    publish({ currentTrackIndex: index, videoId: room.playlist[index], playbackPosition: 0, playbackState: 'playing' });
  };
  const copyLink = async () => { await navigator.clipboard.writeText(`${location.origin}/?room=${roomId}`); setCopied(true); window.setTimeout(() => setCopied(false), 1800); };
  const shareLink = async () => { const shareData = { title: 'Join my SyncMusic room', text: `Room ${roomId} — listen together`, url: `${location.origin}/?room=${roomId}` }; if (navigator.share) await navigator.share(shareData); else await copyLink(); };

  if (!configured) return <main className="setup-screen"><div className="setup-card"><div className="brand-mark"><Headphones size={24}/></div><span className="eyebrow">SYNC MUSIC</span><h1>One room.<br/><em>Everywhere.</em></h1><p>Connect a Firebase project to start listening together from any network.</p><ol><li>Create a Firebase project and enable Anonymous Authentication.</li><li>Create a Realtime Database and deploy the included rules.</li><li>Copy <code>.env.example</code> to <code>.env</code>, then add your Firebase web app values.</li></ol><a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer">Open Firebase Console <Link2 size={15}/></a></div></main>;

  if (!uid) return <main className="loading-screen"><LoaderCircle className={status.startsWith('Connecting') ? 'spin' : ''}/><span>{status}</span>{!status.startsWith('Connecting') && <button className="retry-button" onClick={() => location.reload()}>Try again</button>}</main>;

  if (!roomId || !room) return <main className="home-screen"><nav className="top-nav"><a className="brand" href="/"><span className="brand-icon"><Headphones size={18}/></span> sync<span>music</span></a><div className="nav-state"><span className="live-dot"/> All systems ready</div></nav><section className="hero"><div className="hero-copy"><span className="eyebrow"><span className="wave-icon">〰</span> YOUR MUSIC, IN THE SAME MOMENT</span><h1>Good songs<br/>sound better <em>together.</em></h1><p>Make a room, share the link, and listen in sync — wherever everyone is.</p><div className="hero-badges"><span><Wifi size={14}/> Any network</span><span><Smartphone size={14}/> Every phone</span><span><Signal size={14}/> Live sync</span></div></div><div className="hero-orbit"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit-core"><Headphones size={35}/></div><span className="orbit-note note-a">✳</span><span className="orbit-note note-b">♫</span><span className="orbit-note note-c">✦</span><span className="orbit-ping ping-a"/><span className="orbit-ping ping-b"/></div></section><section className="lobby"><div className="lobby-intro"><span className="eyebrow">GET THE GROUP TOGETHER</span><h2>Start listening</h2><p>Create a room for your crew, or jump into one that’s already playing.</p></div><label className="name-field"><span>YOUR LISTENER NAME</span><input value={name} maxLength={24} onChange={(event) => setName(event.target.value)} placeholder="What should we call you?"/></label><div className="lobby-actions"><button className="create-card" onClick={() => void createRoom()} disabled={busy}><span className="action-icon purple"><Plus size={22}/></span><span><b>Create a room</b><small>Start a new listening session</small></span><ChevronRight size={18}/></button><div className="join-card"><span className="action-icon green"><Link2 size={19}/></span><div className="join-content"><b>Join a room</b><small>Enter the code your friend shared</small><div className="join-input"><input value={inputCode} onChange={(event) => setInputCode(event.target.value.toUpperCase().slice(0, 6))} placeholder="ROOM CODE" maxLength={6} onKeyDown={(event) => event.key === 'Enter' && void joinRoom()}/><button aria-label="Join room" onClick={() => void joinRoom()} disabled={busy || inputCode.length < 6}>{busy ? <LoaderCircle size={17} className="spin"/> : <ChevronRight size={19}/>}</button></div></div></div></div>{status !== 'Ready when you are' && <p className="inline-status">{status}</p>}<div className="privacy-note"><CircleHelp size={14}/> Rooms are private to people with the invite link.</div></section><footer className="home-footer">MADE FOR THE MOMENTS THAT DESERVE A SOUNDTRACK <span>✦</span></footer></main>;

  const isHost = room.masterUid === uid;
  const title = room.title || (room.videoId ? 'Shared YouTube track' : 'Your next song goes here');
  return <main className="room-screen"><nav className="top-nav room-nav"><a className="brand" href="/" onClick={(event) => { event.preventDefault(); setRoomId(''); setRoom(null); history.pushState({}, '', '/'); }}><span className="brand-icon"><Headphones size={18}/></span> sync<span>music</span></a><div className="room-code-wrap"><span className="live-dot"/> ROOM <b>{roomId}</b></div><button className="icon-button" aria-label="Share room" onClick={() => void shareLink()}><Share2 size={17}/></button></nav><section className="room-layout"><div className="room-main"><div className="room-heading"><div><span className="eyebrow"><Radio size={13}/> LISTENING ROOM</span><h1>A little more <em>together.</em></h1></div><div className={`role-pill ${isHost ? 'host' : ''}`}>{isHost ? '✦  You’re the host' : '◉  Listening in'}</div></div><div className="player-card"><div className="video-frame">{(room.source || 'youtube') === 'youtube' && <div className="player-mount" ref={playerHost}/>} {room.source === 'local' && ready && <div className="local-stage"><div className="vinyl-art"><div className="vinyl-center"><Music2 size={22}/></div><span className="vinyl-groove groove-one"/><span className="vinyl-groove groove-two"/></div><span>{localMatchesRoom ? room.localTrackName : 'Waiting for the host to upload the MP3 playlist'}</span></div>}{!ready && !playerBooting && <div className="player-placeholder"><div className="vinyl-art"><div className="vinyl-center"><Headphones size={22}/></div><span className="vinyl-groove groove-one"/><span className="vinyl-groove groove-two"/></div><span className="player-placeholder-label">{room.source === 'local' ? (localMatchesRoom ? room.localTrackName : 'Join the room to hear the host’s playlist') : room.videoId ? 'A shared track is ready' : 'The room is yours'}</span><button className="ready-button" onClick={() => void setupPlayer()}><Play size={15} fill="currentColor"/> Join & enable audio</button><small>Tap once to enable playback on this device</small></div>}</div>{room.source === 'local' && <audio ref={audioRef} src={localUrl || undefined} preload="auto" onLoadedMetadata={(event) => { const audio = event.currentTarget; setDuration(audio.duration || 0); if (room.masterUid === uid) publish({ localTrackDuration: audio.duration || 0 }); }} onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)} onPlay={(event) => { setPlaying(true); if (!applying.current && room.masterUid === uid) publish({ playbackState: 'playing', playbackPosition: event.currentTarget.currentTime }); }} onPause={(event) => { setPlaying(false); if (!applying.current && room.masterUid === uid) publish({ playbackState: 'paused', playbackPosition: event.currentTarget.currentTime }); }} onEnded={(event) => { setPlaying(false); if (room.masterUid === uid) { const playlist = room.localPlaylist || []; if (playlist.length > 1 && (room.currentTrackIndex || 0) < playlist.length - 1) { const next = (room.currentTrackIndex || 0) + 1; const track = playlist[next]; applying.current = true; window.setTimeout(() => { applying.current = false; }, 800); publish({ currentTrackIndex: next, localTrackName: track.name, localTrackSize: track.size, localTrackDuration: 0, title: 'Aarti · ' + track.name, playbackPosition: 0, playbackState: 'playing', startAt: Date.now() + clockOffset + 1500 }); } else publish({ playbackState: 'paused', playbackPosition: event.currentTarget.duration || 0 }); } }}/>}<div className="track-meta"><div className="track-art"><Music2 size={19}/></div><div className="track-copy"><span>{room.source === 'local' ? 'LOCAL TRACK' : room.videoId ? 'NOW IN THE ROOM' : 'UP NEXT'}</span><b>{title}</b></div>{room.source !== 'local' && room.videoId && <a className="youtube-open" href={`https://www.youtube.com/watch?v=${room.videoId}`} target="_blank" rel="noreferrer"><ExternalLink size={12}/> Open in YouTube</a>}<div className="track-live"><span className="live-dot"/>{playing ? 'LIVE' : 'READY'}</div></div><div className="player-controls"><div className="progress-row"><span>{formatTime(time)}</span><input aria-label="Seek in track" type="range" min={0} max={Math.max(duration, 1)} value={Math.min(time, duration || 1)} onChange={(event) => seek(Number(event.target.value))} disabled={!isHost || !ready}/><span>{formatTime(duration)}</span></div><div className="controls-row"><div className="volume-control"><button className="quiet-button" aria-label="Toggle mute" onClick={() => { const value = muted ? volume : 0; setMuted(!muted); playerRef.current?.setVolume(value); if (audioRef.current) audioRef.current.muted = value === 0; }}><VolumeX size={17}/></button><input aria-label="Volume" type="range" min={0} max={100} value={muted ? 0 : volume} onChange={(event) => { const value = Number(event.target.value); setVolume(value); setMuted(value === 0); playerRef.current?.setVolume(value); if (audioRef.current) audioRef.current.volume = value / 100; }}/><Volume2 size={16}/></div><div className="transport"><button aria-label="Previous track" disabled={!isHost || !(room.source === 'local' ? room.localPlaylist?.length : room.playlist?.length)} onClick={() => changeTrack(-1)}><ChevronLeft size={20}/></button><button className="play-button" aria-label={playing ? 'Pause' : 'Play'} disabled={(room.source === 'local' ? !localMatchesRoom : !room.videoId) || (!isHost && room.playbackState !== 'playing') || (!isHost && playing)} onClick={togglePlayback}>{playing ? <Pause size={19} fill="currentColor"/> : <Play size={19} fill="currentColor"/>}</button><button aria-label="Next track" disabled={!isHost || !(room.source === 'local' ? room.localPlaylist?.length : room.playlist?.length)} onClick={() => changeTrack(1)}><ChevronRight size={20}/></button></div><span className="control-hint">{isHost ? 'HOST CONTROLS' : 'FOLLOWING HOST'}</span></div></div><div className="source-panel"><div className="local-file-row">{isHost && <label className="file-pick"><Upload size={15}/><span>{uploading ? 'Uploading MP3s…' : 'Upload Aarti MP3 files'}</span><input type="file" accept=".mp3,audio/mpeg" multiple disabled={uploading} onChange={(event) => void selectLocalFiles(Array.from(event.target.files || []))}/></label>}<small>{isHost ? 'Upload from the host device. Listeners join over the same Wi‑Fi and do not choose files.' : 'The host’s MP3 playlist will play here automatically when you join.'}</small></div></div></div><div className="sync-note"><span className="sync-indicator"><span/></span><span><b>{status}</b><small>Room controls sync through Firebase; audio streams over this Wi‑Fi</small></span><span className="sync-strength"><span/><span/><span/><span/></span></div></div><aside className="room-sidebar"><section className="invite-card"><div className="section-title"><div><span className="eyebrow">SPREAD THE SOUND</span><h2>Bring your people</h2></div><span className="invite-star">✦</span></div><p>Send this room to anyone, anywhere. They’ll join in a tap.</p><div className="room-code-box"><span>ROOM CODE</span><b>{roomId}</b><button aria-label="Copy room link" onClick={() => void copyLink()}>{copied ? <Check size={17}/> : <Copy size={17}/>}</button></div><button className="share-button" onClick={() => void shareLink()}><Share2 size={16}/> Share invite link</button></section><section className="listeners-card"><div className="section-title"><div><span className="eyebrow">THE LISTENING PARTY</span><h2>Your people <span>{members.length}</span></h2></div><span className="listener-wave">♫</span></div><div className="member-list">{members.map((member) => <div className="member-row" key={member.uid}><span className={`avatar ${member.uid === room.masterUid ? 'avatar-host' : ''}`}>{member.name.slice(0, 1).toUpperCase()}<span className={member.online ? 'online-dot' : 'offline-dot'}/></span><span className="member-name"><b>{member.name}{member.uid === uid ? ' (you)' : ''}</b><small>{member.uid === room.masterUid ? 'Room host' : member.online ? 'Listening now' : 'Reconnecting…'}</small></span>{member.uid === room.masterUid && <span className="host-label">HOST</span>}</div>)}</div><div className="member-footer"><span className="live-dot"/>{members.filter((member) => member.online).length} listening now</div></section><div className="host-note"><span>✳</span><p>{isHost ? 'You’re setting the pace. Everyone else follows your playback.' : 'The host has the controls. Your player follows along automatically.'}</p></div></aside></section><footer className="room-footer"><button onClick={() => { setRoomId(''); setRoom(null); setReady(false); history.pushState({}, '', '/'); }}><ArrowLeft size={14}/> Back to your library</button><span>SYNC IS A LITTLE THING THAT MAKES A BIG DIFFERENCE <span>✦</span></span></footer></main>;
}
