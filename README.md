# SyncMusic

A mobile first synchronized MP3 listening room. The host uploads MP3s to the room server on the same Wi-Fi. Firebase Realtime Database carries playlist and playback state; listeners join without selecting files. YouTube links are not converted to MP3.

## Local setup

1. Create a Firebase project. Add a Web App and enable **Authentication → Sign-in method → Anonymous**.
2. Create a **Realtime Database**. In Firebase Console → Realtime Database → Rules, deploy the contents of `database.rules.json` (or run `firebase deploy --only database` after installing and logging into the Firebase CLI).
3. Copy `.env.example` to `.env` and fill in the Web App config values from Firebase Project settings. The database URL should be the URL shown in the Realtime Database console. These are public client config values; never put an Admin SDK key in the frontend.
4. Install and run on the computer that will host the music. Start the server so it is reachable on your Wi-Fi:

   ```sh
   npm install
   npm run dev
   ```

5. Find the host computer’s Wi-Fi IP address (`hostname -I` on Linux; `ipconfig` on Windows; `ipconfig getifaddr en0` on macOS). Open `http://192.168.1.20:5173` on both the host and listeners. Create a room, upload the Aarti MP3 files on the host, then share the room link. If you change `database.rules.json`, publish those rules in Firebase Console → Realtime Database → Rules. Listeners join from that same Wi-Fi address and do not pick files. If a browser blocks audio, tap **Join & enable audio** once.

## Deploy

Build with `npm run build`, then run `npm start` on the host computer and keep it on the same Wi-Fi. This server serves the built app and the MP3 stream. A cloud-only static hosting deploy does not provide the local Wi-Fi audio server.

## How rooms work

- Firebase Anonymous Auth assigns a stable user ID per browser profile. The room creator's UID is stored as `masterUid`; only that UID can update shared state.
- Participants register only their own member record. Room codes are six-character invite secrets; someone who knows a code can join. The database rules deny unauthenticated reads and writes and deny state writes by non-hosts.
- The host's player events publish commands. Participants apply commands without publishing them back. Listeners calculate expected position from the last timestamp, correct drift by seeking or a small playback-rate adjustment, and resume from the latest room state after reconnecting.
- Presence uses Realtime Database `onDisconnect` to mark a participant offline after connection loss.
- The host uploads MP3 files to the room server, which stores them in `.local-audio/` and streams them to listeners on the LAN. Firebase shares track names, sizes, stream URLs, and playback timing. Keep the host computer and server running while listening.

## Testing on phones

Start the app on the host computer, open the host computer’s Wi-Fi IP on both devices, create a room, upload MP3s, and join from the listener device. Try play, pause, seek, and track changes.

## Known limitations

- Mobile browsers may require a tap on each device before local audio can start. A host's Play action cannot override that restriction.
- Sync is best effort, not sample accurate. Network latency, buffering, background-tab throttling, and device clock differences can produce drift. Position is corrected periodically and on shared commands.
- Room expiry/garbage collection and cloud MP3 storage are not provided. The host’s LAN server must stay online; this setup works for devices on that Wi-Fi.
- Firebase client rules provide authenticated, room-code access; for high abuse-risk public deployments, add App Check and a trusted backend to rate-limit room creation and invitations.
