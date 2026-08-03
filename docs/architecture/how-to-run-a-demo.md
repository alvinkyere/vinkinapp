# How to run VinkIn for a demo

Everything runs locally: real PostgreSQL + Redis, a real API server, the real organizer
Flutter app on an iOS Simulator, and the real guest-web Next.js app in a browser. No mocks.

## 1. Backing services (once, if not already running)

```bash
brew services start postgresql@16
brew services start redis
```

## 2. API server

Must be started with these two env vars set, or guest-web/ops-console will fail on CORS:

```bash
cd apps/api
VINKIN_ENV=development PORT=3000 \
  VINKIN_PUBLIC_BASE_URL=http://127.0.0.1:3100 \
  OPERATIONS_CONSOLE_BASE_URL=http://127.0.0.1:3200 \
  node src/server.ts
```

Confirm it's healthy: `curl http://127.0.0.1:3000/health/ready` → `{"status":"ready",...}`.

## 3. Guest web app (the "no app install" participant/guest experience)

```bash
cd apps/guest-web
npm run build && npm run start -- -p 3100
```

Open **http://127.0.0.1:3100** in a browser (resize to a phone width, or use your browser's
device toolbar — it's a mobile-first page).

## 4. Operations console (optional — only needed to demo the merchant/ops side)

```bash
cd apps/operations-console
npm run build && npm run start -- -p 3200
```

Open **http://127.0.0.1:3200**.

## 5. Organizer app (Flutter, iOS Simulator)

```bash
# Boot a simulator if none is running
open -a Simulator
xcrun simctl list devices          # find a device UDID, or just let Xcode pick one

cd apps/mobile
flutter run -d <device-udid-or-name>
```

While it's running: press `r` in that terminal for hot reload, `R` for hot restart, `q` to quit.

## Demo script (the golden path)

1. In the app: **Create an account** → any username/password.
2. **Start a Vink** → pick a category → enter a total (e.g. `120.00`) → **Continue**.
3. **Add someone** → add another registered user by username, or **Add as guest** for someone
   with no account (you'll get a shareable link — open it in guest-web to join as that guest).
4. **Equal** split → **Continue** → **Review** → **Open Vink**.
5. In the lobby, tap **Pay my $X** — the organizer pays through the same flow as everyone else.
6. Have the other participant(s)/guest approve their share (guest via the link from step 3,
   member via their own account in the app or by hitting the API directly).
7. Watch the lobby update live: funded → a "pilot simulation" card gets issued → (via the ops
   console's merchant-simulation controls) → completed.

## Notes

- Everything is clearly labeled **pilot simulation** — no real card is ever issued, no real
  money moves.
- If you want a second, throwaway user quickly, just register a new username/password in the
  app — there's no email verification.
- Logs: API server output whatever terminal you ran `node src/server.ts` in.
