# GoGMI LMS — Backend API

Express + Prisma + PostgreSQL backend for the GoGMI Learning Management System.

## Setup

### 1. Create the database on your PostgreSQL server

```sql
CREATE DATABASE gogmi_lms;
```

### 2. Install dependencies

```bash
cd gogmi-lms-api
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your database credentials and generate JWT secrets:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Run this twice — once for ACCESS_TOKEN_SECRET, once for REFRESH_TOKEN_SECRET. They MUST be different.

### 4. Create database tables

```bash
npx prisma migrate dev --name init
```

### 5. Seed the database

```bash
npm run db:seed
```

This creates:
- Admin: `admin@gogmi.org.gh` / `GoGMI@Admin2026!`
- Student: `student@gogmi.org.gh` / `Student@2026!`

**Change these passwords immediately.**

### 6. Start the server

```bash
npm run dev
```

API runs on `http://localhost:3001`.

## Project Structure

```
gogmi-lms-api/
├── prisma/
│   └── schema.prisma          # Database models
├── src/
│   ├── config/
│   │   └── env.ts             # Environment validation
│   ├── lib/
│   │   ├── prisma.ts          # Database client singleton
│   │   ├── jwt.ts             # Token generation/verification
│   │   └── audit.ts           # Security audit logging
│   ├── middleware/
│   │   └── auth.ts            # authenticate + authorize middleware
│   ├── routes/
│   │   ├── auth.ts            # Login, logout, refresh, change password
│   │   └── admin.ts           # User CRUD (admin only)
│   ├── seed.ts                # Initial data
│   └── server.ts              # Express app entry point
├── .env.example
├── package.json
└── tsconfig.json
```

## API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/login | Login with email/password |
| POST | /api/auth/refresh | Refresh access token |
| POST | /api/auth/logout | Logout current session |
| POST | /api/auth/logout-all | Logout all sessions |
| POST | /api/auth/change-password | Change password |
| GET | /api/auth/me | Get current user profile |

### Admin (requires ADMIN role)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/admin/users | Create new user |
| GET | /api/admin/users | List users (search, filter, paginate) |
| GET | /api/admin/users/:id | Get user details |
| PATCH | /api/admin/users/:id | Update user |
| POST | /api/admin/users/:id/unlock | Unlock locked account |
| POST | /api/admin/users/:id/reset-password | Reset user password |

### Utility
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/health | Health check |
# gogmi-lms-api
