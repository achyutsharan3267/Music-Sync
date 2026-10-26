export type Playback = {
  roomId: string; masterUid: string; videoId: string; playbackState: 'playing' | 'paused';
  playbackPosition: number; serverTimestamp: number; playbackRate: number; commandId: string;
  source?: 'youtube' | 'local'; title?: string; localTrackName?: string; localTrackSize?: number;
  localTrackDuration?: number; playlist?: string[]; currentTrackIndex?: number;
};
export type Member = { uid: string; name: string; online: boolean; joinedAt: number };
export type YTPlayer = { playVideo(): void; pauseVideo(): void; seekTo(seconds: number, allowSeekAhead: boolean): void; loadVideoById(videoId: string, startSeconds?: number): void; cueVideoById(videoId: string, startSeconds?: number): void; getCurrentTime(): number; getDuration(): number; getPlayerState(): number; getVideoUrl(): string; getVideoData(): { title?: string; video_id?: string }; setPlaybackRate(rate: number): void; setVolume(volume: number): void; destroy(): void };
declare global { interface Window { YT?: { Player: new (id: string, options: object) => YTPlayer; PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number; CUED: number; UNSTARTED: number } }; onYouTubeIframeAPIReady?: () => void } }
