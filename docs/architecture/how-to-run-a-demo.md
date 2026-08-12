# How to run VinkIn for a demo

Everything runs locally: real PostgreSQL + Redis, a real API server, the real organizer
Flutter app on an iOS Simulator, and the real guest-web Next.js app in a browser. No mocks.

**Move fast once you open the Vink.** As of D47/RM4A, a Vink's open window is **7 minutes**
by default (`VINK_OPEN_DURATION_SECONDS`, was 24h before the Real-Money Beta lifecycle
work) — add participants, split, and get every contribution in within that window, or the
Vink expires and any captured contributions auto-refund. Do the account-creation/exploring
part *before* you tap **Open Vink**, not after.

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

## 4. Operations console (needed to demo funding through completion — see step 7 below)

```bash
cd apps/operations-console
npm run build && npm run start -- -p 3200
```

Open **http://127.0.0.1:3200** and sign in with:
- **Your name**: anything (e.g. `Demo Operator`) — it's just the audit-log label, not an
  account.
- **Operator password**: `dev-only-operator-password` (the `OPERATOR_PASSWORD` dev default —
  `apps/api/src/config/env.ts`; only refused in `demo`, fine in `development`).

You only strictly need this for step 7's merchant simulation, but sign in early — the
7-minute Vink window is ticking once you open it.

## 5. Seed the card pool (once per fresh database)

Since RM1–RM3B, a `FUNDED` Vink is issued a card from a reusable pool (`cards` table), not
minted from thin air — and a fresh local database's pool is **empty** (`apps/api/src/seed.ts`
only seeds demo users). Without this step, funding will complete but the Vink will silently
never reach `CARD_READY`. Seed a couple of cards through the API server directly (needs the
operator token from step 4's login — grab it from the ops console's network tab, or just log
in via `curl` first):

```bash
curl -s -X POST http://127.0.0.1:3000/internal/ops/auth/login \
  -H 'content-type: application/json' \
  -d '{"operatorName":"Demo Operator","password":"dev-only-operator-password"}' \
  | tee /tmp/op-login.json

TOKEN=$(node -pe "require('/tmp/op-login.json').operatorToken")

curl -s -X POST http://127.0.0.1:3000/internal/simulator/card-pool/seed \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"count": 3}'
```

This creates real mock-provider cards (via `createCardholder`/`issueTemporaryCard`) and adds
them to the pool in the disabled resting state the pool expects. Do this once per fresh
database — seeded cards return to the pool automatically after each Vink completes, so you
don't need to reseed between demo runs against the same database.

## 6. Organizer app (Flutter, iOS Simulator)

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
4. **Equal** split → **Continue** → **Review** → **Open Vink**. The 7-minute countdown starts
   now — have the other steps ready to go before you tap this.
5. In the lobby, tap **Pay my $X** — the organizer pays through the same flow as everyone else.
6. Have the other participant(s)/guest approve their share (guest via the link from step 3,
   member via their own account in the app or by hitting the API directly) — within the
   7-minute window.
7. Watch the lobby update live: funded → a "pilot simulation" card gets issued automatically
   (the sweep provisions it from step 5's seeded pool, no manual action needed) → use the ops
   console's merchant-simulation controls (signed in per step 4) to authorize and capture a
   purchase → completed.

## Notes

- Everything is clearly labeled **pilot simulation** — no real card is ever issued, no real
  money moves. (`VINKIN_FINANCIAL_PROVIDER` defaults to `mock`; this doc doesn't cover the
  separate, credential-gated real-Stripe-sandbox path.)
- If you want a second, throwaway user quickly, just register a new username/password in the
  app — there's no email verification.
- If a Vink expires before everyone's paid (7-minute window), any captured contributions
  auto-refund — that's expected, not a bug; just start a new Vink.
- Logs: API server output whatever terminal you ran `node src/server.ts` in.
