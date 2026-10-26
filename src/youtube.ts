export function parseVideoId(input: string) {
  const value = input.trim();
  if (/^[\w-]{11}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.hostname === 'youtu.be') return url.pathname.slice(1).match(/^[\w-]{11}$/)?.[0] ?? null;
    if (url.hostname.endsWith('youtube.com')) return url.searchParams.get('v')?.match(/^[\w-]{11}$/)?.[0] ?? url.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1] ?? null;
  } catch { return null; }
  return null;
}
export function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(); };
    if (!document.querySelector('script[data-youtube-api]')) {
      const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; script.dataset.youtubeApi = 'true'; document.head.appendChild(script);
    }
  });
}
