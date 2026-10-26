# SyncMusic

A mobile first shared YouTube listening room. A room host controls playback and Firebase Realtime Database carries the shared track, position, and play state to authenticated listeners. Playback uses the official YouTube IFrame Player; this app does not download or extract audio.

## Local setup

1. Create a Firebase project. Add a Web App and enable **Authentication → Sign-in method → Anonymous**.
2. Create a **Realtime Database**. In Firebase Console → Realtime Database → Rules, deploy the contents of `database.rules.json` (or run `firebase deploy --only database` after installing and logging into the Firebase CLI).
3. Copy `.env.example` to `.env` and fill in the Web App config values from Firebase Project settings. The database URL should be the URL shown in the Realtime Database console. These are public client config values; never put an Admin SDK key in the frontend.
4. Install and run:

   ```sh
   npm install
   npm run dev
   ```

5. Open the Vite URL, create a room, add a YouTube video URL or ID, and share the invite link. Every phone must tap **Ready / Join Player** once to satisfy mobile browser playback rules. Use separate browser profiles or devices to check host and participant views.

## Deploy

Build with `npm run build`, then deploy Hosting and the database rules with `firebase deploy`. The included `firebase.json` serves the Vite `dist` directory and rewrites app routes to `index.html`. Add the deployed domain to Firebase Authentication's authorized domains. Configure the same `VITE_FIREBASE_*` values in the build environment.

## How rooms work

- Firebase Anonymous Auth assigns a stable user ID per browser profile. The room creator's UID is stored as `masterUid`; only that UID can update shared state.
- Participants register only their own member record. Room codes are six-character invite secrets; someone who knows a code can join. The database rules deny unauthenticated reads and writes and deny state writes by non-hosts.
- The host's player events publish commands. Participants apply commands without publishing them back. Listeners calculate expected position from the last timestamp, correct drift by seeking or a small playback-rate adjustment, and resume from the latest room state after reconnecting.
- Presence uses Realtime Database `onDisconnect` to mark a participant offline after connection loss.
- The host can choose YouTube or local audio. For local audio, each listener must select their own copy of the same file; the app never uploads it. Local playback syncs play/pause and seeks, subject to each browser allowing the audio to start.

## Testing on phones

Create a room on one device, open the share URL on another device using a different network, and tap **Ready / Join Player** on both. Add a video from the host, then try pause, seek, and a network interruption/reload on the listener. Check that a non-host cannot change shared controls. Check video availability in your region and device browser.

## Known limitations

- YouTube or the browser may block autoplay. Each device needs a user gesture before playback can begin; a host's Play action cannot override that restriction.
- Sync is best effort, not sample accurate. Network latency, buffering, background-tab throttling, device clock differences, and YouTube's own playback behavior produce drift. Position is corrected periodically and on shared commands.
- Some videos disallow embedding, are age or region restricted, or may show YouTube ads independently on each device. The app reports player errors but cannot bypass YouTube restrictions.
- The embedded player does not provide a YouTube account login flow. The **Open in YouTube** link opens the video on YouTube, where a signed-in Premium account can use its benefits; playback in YouTube itself is outside the room's synchronized controls.
- The IFrame API's controls and volume behavior vary by browser. Mobile operating systems may own device volume, and playback may pause when a tab is backgrounded.
- Room expiry/garbage collection and playlist editing are not provided. Playlist synchronization fields are supported for host supplied tracks, while the interface focuses on single track control.
- Firebase client rules provide authenticated, room-code access; for high abuse-risk public deployments, add App Check and a trusted backend to rate-limit room creation and invitations.
