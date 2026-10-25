# MedOrg - Medical Records Platform

MedOrg gives patients full ownership of their medical records while providing doctors with secure, time-limited, consent-driven access and automated AI-powered summaries of on-file records.

---

## Tech Stack

- **Client**: React 18, Vite, TypeScript, Vanilla CSS design system (hosted on GitHub Pages)
- **Server**: Node.js, Express, TypeScript (hosted on Render Free Web Service)
- **Database**:
  - **Local Development**: SQLite (`file:../data/medorg.db`) with Prisma ORM
  - **Hosted Production**: [Neon Lakebase Postgres](https://neon.tech/) with connection pooling and scale-to-zero compute
- **Document & PDF Storage**:
  - **Local Development**: Filesystem disk storage (`data/uploads`)
  - **Hosted Production**: [Neon Object Storage](https://neon.tech/docs/storage/overview) (S3-compatible, private bucket `records`, AWS SDK v3)
- **AI Provider**: [Groq](https://groq.com/) using the `openai/gpt-oss-20b` reasoning model via OpenAI-compatible Chat Completions API
- **Email / OTP**: Brevo (Sendinblue) transactional email API / SMTP

---

## Architecture Diagram

```
+-----------------------------------------------------------------+
|               Client (React / Vite on GitHub Pages)             |
|   +-------------------+                     +---------------+   |
|   |   Patient Portal  |                     | Doctor Portal |   |
|   |  - Grant Access   |                     | - Patient View|   |
|   |  - View Records   |                     | - AiSummary   |   |
|   +-------------------+                     +---------------+   |
+--------------------------------+--------------------------------+
                                 | HTTPS / REST API
                                 v
+-----------------------------------------------------------------+
|               Backend Server (Express on Render Free Tier)      |
|                                                                 |
|   +-----------------+   +------------------+   +------------+   |
|   | Auth Middleware |-->| Patient & Record |-->| Storage    |   |
|   | & Access Check  |   | Services         |   | Driver     |   |
|   +-----------------+   +------------------+   +------------+   |
|            |                      |                   |         |
|            v                      v                   v         |
|   +-----------------+    +------------------+  +--------------+ |
|   | Groq AI API     |    | Neon Postgres    |  | Neon S3      | |
|   | (LLM Summaries) |    | (Pooled DB)      |  | Object Store | |
|   +-----------------+    +------------------+  +--------------+ |
+-----------------------------------------------------------------+
```

---

## Storage & Database Modes

MedOrg supports dual execution modes:

| Mode | Database | File Storage Driver | Environment Trigger |
|---|---|---|---|
| **Local** (default) | SQLite (`file:../data/medorg.db`) | Local Disk (`data/uploads`) | Default when running `npm run dev` |
| **Hosted** | Neon PostgreSQL (`DATABASE_URL`) | Neon S3 Object Storage (`STORAGE_DRIVER=s3`) | `DB_MODE=hosted` |

### Database Provider Switching

Prisma schema provider can be switched seamlessly using the CLI scripts:
```bash
# Switch to SQLite for local development
npm run db:use:sqlite

# Switch to PostgreSQL for Neon hosting / testing
npm run db:use:postgres
```

---

## AI Key Setup (Groq)

MedOrg utilizes Groq's high-speed inference engine for medical records summarization with the reasoning model `openai/gpt-oss-20b`.

1. Go to the [Groq Console](https://console.groq.com/).
2. Log in or create an account.
3. Navigate to **API Keys** (`https://console.groq.com/keys`).
4. Click **Create API Key**, give it a name (e.g. `medorg-dev`), and copy the key (`gsk_...`).
5. Open your `.env` file and set:
   ```env
   GROQ_API_KEY=gsk_your_groq_api_key_here
   GROQ_BASE_URL=https://api.groq.com/openai/v1
   GROQ_MODEL=openai/gpt-oss-20b
   ```
6. The key is accessed solely on the server and is never transmitted to the frontend or exposed in API responses or audit logs.

> **Note**: If `GROQ_API_KEY` is omitted, the application runs normally; the AI summary status endpoint reports `configured: false`, and the doctor portal displays an "AI is not configured" placeholder.

---

## Environment Variables

| Variable | Description | Default | Required |
|---|---|---|---|
| `DB_MODE` | Runtime mode: `local` (SQLite/disk) or `hosted` (Neon Postgres/S3) | `local` | No |
| `STORAGE_DRIVER` | Storage driver: `disk` or `s3` | `disk` (or `s3` when hosted) | No |
| `S3_BUCKET_NAME` | Neon Object Storage private bucket name | `records` | If S3 |
| `AWS_ACCESS_KEY_ID` | Neon S3 Access Key ID | `""` | If S3 |
| `AWS_SECRET_ACCESS_KEY` | Neon S3 Secret Access Key | `""` | If S3 |
| `AWS_ENDPOINT_URL_S3` | Neon S3 endpoint URL | `""` | If S3 |
| `AWS_REGION` | Neon S3 Region (`us-east-2`, `us-east-1`, etc.) | `us-east-2` | If S3 |
| `NEON_BRANCH` | Neon active branch name (`production` / `dev`) | `""` | No |
| `ALLOW_PRODUCTION_RESET`| Protection against wiping production database | `false` | No |
| `PORT` | Backend server port | `5000` | No |
| `NODE_ENV` | Environment mode (`development` / `production`) | `development` | No |
| `DATABASE_URL` | Prisma database connection string | `file:../data/medorg.db` | Yes |
| `DIRECT_URL` | Direct non-pooled URL for Postgres migrations | `""` | When Postgres |
| `CLIENT_URL` | Client application URL | `http://localhost:3000` | No |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) | `http://localhost:3000` | No |
| `GROQ_API_KEY` | Groq API Key | `""` | Optional |
| `GROQ_BASE_URL` | Groq OpenAI-compatible API base URL | `https://api.groq.com/openai/v1` | No |
| `GROQ_MODEL` | Groq model identifier | `openai/gpt-oss-20b` | No |
| `BREVO_API_KEY` | Brevo API key for OTP emails | `""` | Optional in dev |
| `BREVO_FROM_EMAIL` | Sender email address for OTPs | `no-reply@medorg.com` | No |
| `BREVO_FROM_NAME` | Sender name for OTPs | `MedOrg` | No |
| `MAX_FILE_SIZE_MB` | Maximum medical record file upload size (MB) | `10` (local) / `3` (hosted) | No |
| `SESSION_DAYS` | Auth session validity in days | `7` | No |
| `ENABLE_DB_VIEWER` | Enable database viewer endpoint | `true` (dev) / `false` (prod)| No |
| `ALLOW_DB_RESET` | Enable database reset endpoint | `true` (dev) / `false` (prod)| No |

---

## Health Checks & Probes

- `GET /api/health`: Ultra-lightweight endpoint returning `{ status: "ok" }`. Completely database-free and does not wake Neon Postgres from scale-to-zero. Configured for Render health probes.
- `GET /api/health/db`: Actively verifies Postgres/SQLite database connectivity with automatic retry and backoff for cold-starting compute endpoints.

---

## Getting Started Locally

1. **Install dependencies and setup database**:
   ```bash
   npm run setup
   ```
2. **Start development servers**:
   ```bash
   npm run dev
   ```
   - Client: `http://localhost:3000`
   - Server: `http://localhost:5000`

3. **Run automated end-to-end test suite**:
   ```bash
   npm run test:e2e
   npm run test:live
   ```

---

## Render & GitHub Pages Hosting

MedOrg is configured for free cloud hosting:
1. **Frontend**: Static React build deployed to GitHub Pages via `.github/workflows/deploy-pages.yml`.
2. **Backend**: Render Free Web Service deployed via `render.yaml` using ephemeral disk.
3. **Database & Storage**: Neon PostgreSQL + Neon Object Storage.
