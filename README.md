# OPNsense Captive Portal with Nextcloud Contacts

A captive portal for OPNsense that authenticates WiFi users against Nextcloud contacts. Users verify their identity with a phone number and birthday, then get their device MAC address whitelisted on the firewall. Includes an admin dashboard for managing users, devices, and access.

## How It Works

```
User connects to WiFi
        │
        ▼
OPNsense redirects to portal ──► /api/create-handoff-token
        │
        ▼
Portal login page (/handoff?token=xxx)
        │
        ▼
User enters phone + birthday
        │
        ▼
CardDAV lookup against Nextcloud contacts
        │
        ▼
Match found ──► Device registered ──► MAC whitelisted on OPNsense
        │
        ▼
User gets internet access
```

**Key features:**
- Phone number + birthday verification against Nextcloud contacts via CardDAV
- Automatic MAC address whitelisting on OPNsense firewall
- Admin approval workflow for new users (optional auto-approve for returning users)
- Device presence detection via ARP table polling
- Login attempt rate limiting and lockout
- Admin dashboard for managing persons, devices, attempts, and settings
- Funny Terms & Conditions and Privacy Policy on the portal landing page

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ (20 recommended)
- An [OPNsense](https://opnsense.org/) firewall with Captive Portal enabled
- A [Nextcloud](https://nextcloud.com/) instance with contacts (CardDAV)

### 1. Clone and install

```bash
git clone https://github.com/shreyasajj/Opensense-captive-portal.git
cd Opensense-captive-portal
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
# Server
PORT=3000
SESSION_SECRET=your-secret-here

# Nextcloud CardDAV
NEXTCLOUD_URL=https://your-nextcloud.example.com
NEXTCLOUD_USER=admin
NEXTCLOUD_PASSWORD=your-password
NEXTCLOUD_ADDRESSBOOK=contacts

# OPNsense API
OPNSENSE_URL=https://your-opnsense.example.com
OPNSENSE_API_KEY=your-api-key
OPNSENSE_API_SECRET=your-api-secret
OPNSENSE_ZONE_ID=0
OPNSENSE_VERIFY_SSL=false

# Optional
ARP_POLL_INTERVAL_MS=60000
MAX_LOGIN_ATTEMPTS=3
LOG_LEVEL=info
```

### 3. Run

```bash
npm start
```

The portal runs on `http://localhost:3000`. Access the admin panel at `/admin/`.

## Docker

### Build and run locally

```bash
docker compose up -d
```

This builds two containers:
- **frontend** — Nginx serving static files, proxying API calls to backend
- **backend** — Node.js Express API server with SQLite

The portal is available at `http://localhost:8080` (configurable via `PORTAL_PORT`).

### Pull pre-built images from GHCR

No source code needed — just create a `.env` file and run:

```bash
docker compose -f docker-compose.ghcr.yml up -d
```

Images:
- `ghcr.io/shreyasajj/opensense-captive-portal/frontend:latest`
- `ghcr.io/shreyasajj/opensense-captive-portal/backend:latest`

Available for `linux/amd64` and `linux/arm64`.

### Docker environment

The backend container reads from `.env`. The SQLite database is persisted in a Docker volume (`db-data`).

```bash
# Stop
docker compose down

# Stop and remove data
docker compose down -v

# Rebuild after code changes
docker compose build && docker compose up -d
```

## OPNsense Setup

1. Enable **Captive Portal** on your OPNsense firewall
2. Create an API key/secret under **System > Access > Users**
3. Set the captive portal's redirect URL to point to this portal:
   ```
   http://<portal-host>:<port>/api/create-handoff-token
   ```
4. The portal will automatically whitelist authenticated devices via the OPNsense API

## Admin Dashboard

Access at `/admin/`. The admin panel has **no built-in authentication** — it's designed to be protected by an external auth proxy like [Authelia](https://www.authelia.com/), [Authentik](https://goauthentik.io/), or similar. Make sure to secure the `/admin` path in your reverse proxy before exposing it.

| Feature | Description |
|---------|-------------|
| **Persons** | View, search, and remove verified users |
| **Devices** | List all devices, approve pending ones, revoke access |
| **Attempts** | Monitor login attempts, grant additional chances for locked-out users |
| **Unknown MACs** | See unregistered devices on the network, tag or dismiss them |
| **Settings** | Configure max login attempts, auto-approval, and other options |
| **Errors** | View and clear application error logs |

## API Routes

### Portal (public)

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/create-handoff-token` | Create a one-time handoff token (called by OPNsense) |
| GET | `/handoff?token=xxx` | Validate token and start user session |
| POST | `/api/lookup` | Search contacts by phone + birthday |
| POST | `/api/register-device` | Register the current device for a verified person |

### Admin (protect with external auth proxy)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/admin/api/persons` | List all persons with device counts |
| DELETE | `/admin/api/persons/:id` | Remove person and revoke all their MACs |
| GET | `/admin/api/devices` | List all registered devices |
| DELETE | `/admin/api/devices/:id` | Remove device and revoke MAC |
| POST | `/admin/api/devices/:id/approve` | Approve a pending device |
| POST | `/admin/api/devices/:id/set-phone` | Mark device as presence tracker |
| GET | `/admin/api/attempts` | List login attempt records |
| POST | `/admin/api/attempts/:phone/grant` | Grant more login attempts |
| GET/PUT | `/admin/api/settings` | View or update system settings |
| GET | `/admin/api/errors` | View error logs (paginated) |
| DELETE | `/admin/api/errors` | Clear all error logs |
| GET | `/admin/api/unknown-macs` | List unregistered MACs seen on network |
| POST | `/admin/api/unknown-macs/:id/tag` | Tag an unknown MAC |
| DELETE | `/admin/api/unknown-macs/:id` | Remove unknown MAC entry |

## Testing

```bash
# Run all tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# With coverage report
npm run test:ci
```

The test suite includes 80 tests across 7 suites:
- **Unit tests** — CardDAV parsing, phone normalization, MAC validation, rate limiting
- **Integration tests** — Full API endpoint testing for portal flow, admin endpoints, and handoff tokens

## CI/CD

GitHub Actions runs automatically on push and PRs:

- **CI Pipeline** (`.github/workflows/ci.yml`) — Runs tests on Node 18/20/22 matrix, linting, and Docker build validation
- **Docker Publish** (`.github/workflows/docker-publish.yml`) — Builds multi-platform images and pushes to GHCR on merge to `main` or version tags

## Project Structure

```
├── server.js              # Express app setup and startup
├── config.js              # Configuration from environment variables
├── package.json
├── .env.example           # Environment variable template
├── docker-compose.yml     # Local build + GHCR image compose
├── docker-compose.ghcr.yml # Pull-only compose (no build)
│
├── db/
│   └── init.js            # SQLite schema and initialization
│
├── middleware/             # Reserved for future middleware
│
├── routes/
│   ├── portal.js          # Public portal routes (lookup, register, handoff)
│   └── admin.js           # Admin API routes
│
├── services/
│   ├── carddav.js         # Nextcloud CardDAV contact search
│   ├── opnsense.js        # OPNsense API (MAC whitelist, ARP table)
│   ├── attempts.js        # Login attempt tracking and lockout
│   ├── presence.js        # Background ARP polling for device presence
│   └── logger.js          # Logging utility
│
├── public/
│   ├── portal/            # Captive portal frontend (HTML/CSS/JS)
│   └── admin/             # Admin dashboard frontend (HTML/CSS/JS)
│
├── docker/
│   ├── backend/Dockerfile
│   └── frontend/
│       ├── Dockerfile
│       └── nginx.conf
│
├── tests/
│   ├── setup.js           # Global test setup
│   ├── teardown.js        # Global test teardown
│   ├── unit/              # Unit tests
│   └── integration/       # Integration tests
│
└── .github/workflows/
    ├── ci.yml             # Test and lint pipeline
    └── docker-publish.yml # GHCR image publishing
```

## License

MIT
