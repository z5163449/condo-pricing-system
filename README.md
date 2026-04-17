# Condo Pricing System 公寓定价系统

A bilingual (English / Chinese) pricing management system for Singapore residential property developers. Manage multiple projects, blocks, and bedroom types with configurable floor increments, rank-based PSF, manual overrides, and Excel/PDF export.

---

## Tech Stack

| Layer     | Technology |
|-----------|-----------|
| Frontend  | React 18 + Vite, Tailwind CSS, React Router v6, i18next |
| Backend   | Node.js + Express 4 |
| Database  | Prisma ORM + SQLite (swap to PostgreSQL for production) |
| Export    | ExcelJS (Excel), PDF via browser print (server-side PDF TBD) |

---

## Project Structure

```
condo-pricing-system/
├── client/                   # React + Vite frontend
│   ├── src/
│   │   ├── components/       # Shared UI (Layout, …)
│   │   ├── pages/            # Dashboard, ProjectSetup, PricingEngine, Export
│   │   ├── locales/
│   │   │   ├── en/translation.json
│   │   │   └── zh/translation.json
│   │   ├── i18n.js
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── tailwind.config.js
│   └── vite.config.js
│
├── server/                   # Express + Prisma backend
│   ├── prisma/
│   │   └── schema.prisma
│   ├── src/
│   │   ├── lib/prisma.js     # Singleton Prisma client
│   │   ├── routes/
│   │   │   ├── projects.js
│   │   │   ├── blocks.js
│   │   │   └── ranks.js
│   │   └── index.js
│   └── .env.example
│
└── package.json              # Root scripts (runs both with concurrently)
```

---

## Prerequisites

- **Node.js** ≥ 18.x
- **npm** ≥ 9.x  *(or pnpm / yarn)*

---

## Setup

### 1. Clone & install dependencies

```bash
git clone <repo-url>
cd condo-pricing-system

# Install root + client + server dependencies in one command
npm run install:all
```

Or manually:

```bash
npm install                    # root (concurrently)
npm install --prefix client    # React / Vite
npm install --prefix server    # Express / Prisma
```

### 2. Configure the server environment

```bash
cp server/.env.example server/.env
```

`server/.env` defaults:
```
DATABASE_URL="file:./dev.db"
PORT=3001
NODE_ENV=development
```

### 3. Initialise the database

```bash
# Run Prisma migration (creates dev.db and all tables)
npm run prisma:migrate

# Prompt: enter a migration name, e.g. "init"
```

Or from within the server directory:
```bash
cd server
npx prisma migrate dev --name init
npx prisma generate          # regenerate the Prisma client
```

### 4. (Optional) Open Prisma Studio

```bash
npm run prisma:studio
# Opens http://localhost:5555 — browse and edit rows visually
```

---

## Running in Development

Start both servers in parallel with one command:

```bash
npm run dev
```

This runs:
- **Frontend** — `http://localhost:5173` (Vite dev server, hot-reload)
- **Backend**  — `http://localhost:3001` (nodemon, auto-restart on change)

Vite proxies `/api/*` requests to the backend, so no CORS issues during development.

Or run them separately:

```bash
npm run dev:server    # Express only
npm run dev:client    # Vite only
```

---

## API Reference

### Health

```
GET /api/health
→ { status: "ok", timestamp: "…", environment: "development" }
```

### Projects

| Method   | Path                    | Description              |
|----------|-------------------------|--------------------------|
| `GET`    | `/api/projects`         | List all projects        |
| `GET`    | `/api/projects/:id`     | Get project with details |
| `POST`   | `/api/projects`         | Create project           |
| `PATCH`  | `/api/projects/:id`     | Update project fields    |
| `DELETE` | `/api/projects/:id`     | Delete project (cascade) |

### Blocks

| Method   | Path                        | Description                        |
|----------|-----------------------------|------------------------------------|
| `GET`    | `/api/blocks?projectId=xxx` | List blocks (filter by project)    |
| `GET`    | `/api/blocks/:id`           | Get block with stacks              |
| `POST`   | `/api/blocks`               | Create block                       |
| `PATCH`  | `/api/blocks/:id`           | Update block                       |
| `DELETE` | `/api/blocks/:id`           | Delete block                       |

### Ranks

| Method   | Path                       | Description                       |
|----------|----------------------------|-----------------------------------|
| `GET`    | `/api/ranks?projectId=xxx` | List ranks with floor increments  |
| `GET`    | `/api/ranks/:id`           | Get single rank                   |
| `POST`   | `/api/ranks`               | Create rank (with increments)     |
| `PATCH`  | `/api/ranks/:id`           | Update rank                       |
| `DELETE` | `/api/ranks/:id`           | Delete rank                       |

---

## Data Model Summary

```
Project
  └── Block(s)
        └── Stack(s)  ──→  Rank
              └── Unit(s)
  └── Rank(s)
        └── FloorIncrement(s)
  └── PricingParameters  (1:1)
  └── Session(s)  (snapshots)
```

Key fields:
- **Unit**: stores `calculatedPSF/Price` (engine output), `manualOverridePSF/Price` (analyst input), and `finalPSF/Price` (override if set, else calculated)
- **Rank**: `basePSF` + `rankDifferential` define the stack's starting price, broken down per floor via `FloorIncrement` bands
- **PricingParameters**: target PSFs per bedroom type, penthouse multiplier, lucky floor premiums (JSON map), rounding unit

---

## Frontend Pages

| Route               | Page             | Description                                    |
|---------------------|------------------|------------------------------------------------|
| `/dashboard`        | Dashboard        | Project overview, status counts                |
| `/projects`         | Project Setup    | Create / edit projects; sidebar project list   |
| `/projects/:id`     | Project Setup    | Edit a specific project                        |
| `/pricing`          | Pricing Engine   | Configure ranks, parameters, trigger calc      |
| `/pricing/:id`      | Pricing Engine   | Pricing engine for a specific project          |
| `/export`           | Export           | Download Excel / PDF for a project             |
| `/export/:id`       | Export           | Export for a specific project                  |

Language toggle (EN ↔ 中文) is in the top-right of the nav bar. Selection is persisted to `localStorage`.

---

## Production Build

```bash
npm run build:client          # outputs to client/dist/
```

Serve `client/dist/` with any static host (Nginx, Vercel, etc.) and point the backend URL via environment variable.

---

## Roadmap (next features)

- [ ] Stack & Unit CRUD routes and UI
- [ ] Pricing engine calculation logic (floor increment + rank differential)
- [ ] Manual override UI with per-unit lock indicator
- [ ] Excel export via ExcelJS (unit price list + bedroom-type pivot)
- [ ] PDF export (print-optimised price list)
- [ ] Session / snapshot management
- [ ] User authentication & project sharing
