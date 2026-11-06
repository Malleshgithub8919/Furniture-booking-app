# FurniSpace Admin Panel

The React admin panel uses the backend API and requires an existing account with the `admin` role.

## Start the admin panel

1. Configure and start the backend API using its development database. The default local API port is `5000`.
2. From the `admin-panel` directory, install dependencies and start Vite:
   ```bash
   npm install
   npm run dev
   ```
3. Open the local URL printed by Vite (normally `http://localhost:5173`). Vite proxies `/api` requests to `http://localhost:5000` by default.

## Production API configuration

For local development with a different backend port or host, set `VITE_API_PROXY_TARGET` before starting Vite (for example, in PowerShell: `$env:VITE_API_PROXY_TARGET = 'http://localhost:5001'`). The proxy target is the backend origin; it must not include `/api`.

For a deployment that does not serve the API at the same origin under `/api`, set `VITE_API_BASE_URL` to the API base URL, including `/api` (for example, `https://api.example.com/api`) before `npm run build`, or place it in an uncommitted `admin-panel/.env.local`. This is public URL configuration, not a credential. The backend must allow the deployed admin-panel origin through `CLIENT_ORIGINS`. Never put passwords, JWT secrets, MongoDB URIs, or other credentials in frontend environment variables.

## Admin login

The panel requires an account whose backend role is `admin`. Public registration only creates customer accounts; create the first admin through the interactive `admin:provision` command in the [backend setup documentation](../backend/README.md#first-admin-account-setup). Sign in with the admin email (or mobile number, if configured) and password used during provisioning.

The panel authenticates through `POST /api/auth/login` and rejects successful logins for non-admin roles. Backend admin routes independently enforce JWT authentication and admin RBAC. Access/refresh tokens are stored in tab-scoped `sessionStorage`; access tokens are refreshed through the backend's rotating refresh-token endpoint, and sign out revokes the refresh token. No passwords, API keys, payment credentials, or OTPs are stored in the frontend.

### Troubleshooting login

- **Invalid credentials:** Verify that the admin was provisioned in the same database used by the running backend, and check the email/password. The backend intentionally uses one generic response for an unknown account and an incorrect password.
- **This account does not have admin access:** The account exists but is not an admin. Customer/vendor accounts cannot access the admin panel; public registration cannot promote them. Do not change their role to work around RBAC.
- **Network/API error:** Confirm the backend is running, the Vite proxy target or `VITE_API_BASE_URL` points to its API, and `CLIENT_ORIGINS` allows the panel origin when using a direct cross-origin API URL.
- **Token/session error:** Sign out and sign in again. The backend validates JWTs and role authorization on protected routes; frontend session state does not grant admin access by itself.

## Admin capabilities

The dashboard and tables consume authenticated admin APIs for vendor/KYC moderation, products, customers, parent/vendor orders, payments, delivery partners, and delivery assignments. Payment views are read-only; the panel does not create Razorpay orders or initiate payments.

Vendor KYC review currently displays metadata and supports document-status decisions. The backend does not yet store uploaded file contents or provide a secure document preview/download endpoint, so reviewers cannot inspect the actual file from this panel.
