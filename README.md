# Furniture Marketplace — Starter Project

This is a runnable **starter foundation**, not a finished production marketplace.
It creates the agreed workspace for:
- Customer Flutter app
- Vendor Flutter app
- Delivery Flutter app
- Node.js + Express API
- React + Vite Admin Panel

The starter includes a working API health endpoint, MongoDB connection setup, basic User model/auth endpoints, role-based Flutter app shells, and an admin dashboard shell. Payments, OTP provider integration, KYC, order lifecycle, vendor settlements, FCM, Socket.IO, Cloudinary and production security hardening must be implemented and tested in later phases.

## 1. Requirements
Install:
- Flutter SDK (stable)
- Android Studio (Android SDK + emulator)
- Node.js LTS and npm
- Git
- Antigravity editor
- MongoDB Atlas account

Check in a terminal:
```bash
flutter --version
node -v
npm -v
```

## 2. Open in Antigravity
1. Extract `furniture-marketplace-starter.zip`.
2. Open the extracted `furniture-marketplace` folder in Antigravity.
3. Open the integrated terminal at the project root.

## 3. Generate Flutter platform folders
The ZIP includes Flutter `lib/` source and `pubspec.yaml` for each app. From the project root run:

```bash
cd customer-app
flutter create --project-name customer_app .
flutter pub get
cd ..

cd vendor-app
flutter create --project-name vendor_app .
flutter pub get
cd ..

cd delivery-app
flutter create --project-name delivery_app .
flutter pub get
cd ..
```

If Flutter asks to overwrite existing files, keep the supplied `lib/main.dart` and `pubspec.yaml`. The command is needed to generate Android/iOS platform folders.

Run one app:
```bash
cd customer-app
flutter run
```
Use `vendor-app` or `delivery-app` similarly.

## 4. Start the backend
```bash
cd backend
npm install
```
Copy `.env.example` to `.env` and set your own MongoDB Atlas connection string and a long random JWT secret. Do not share `.env` or commit it to Git.

```bash
npm run dev
```
Check:
- http://localhost:5000/api/health

The API can connect to MongoDB if `MONGODB_URI` is configured. The API starts without MongoDB too, but database-backed routes will not work until the connection succeeds.

## 5. Start Admin Panel
Open another terminal:
```bash
cd admin-panel
npm install
npm run dev
```
Open the local URL printed by Vite (normally http://localhost:5173).

## 6. Important local networking note
- Android emulator usually reaches the host computer using `http://10.0.2.2:5000`.
- iOS simulator can generally use `http://localhost:5000`.
- A physical phone needs your computer's LAN IP, and both devices must be on the same network. Do not expose the API publicly without HTTPS and security controls.
- Update the API base URL in each Flutter app's `lib/config/api_config.dart`.

## 7. Suggested build order in Antigravity
Do not ask the agent to generate the entire system in one prompt. Build and verify in small phases:
1. Inspect this repository and explain its architecture. Do not delete working files.
2. Complete backend foundations, configuration, validation, error handling and tests.
3. Implement authentication and role permissions.
4. Implement vendor onboarding/KYC and category/product management.
5. Implement customer browsing, product detail, cart and wishlist.
6. Implement parent orders + per-vendor orders, inventory reservation and status history.
7. Implement Razorpay + COD with webhook verification and idempotency.
8. Implement delivery assignment, OTP handover/delivery proof and COD reconciliation.
9. Implement admin management, complaints, refunds and vendor settlements.
10. Implement FCM/Socket.IO/Cloudinary integrations, then integration tests and deployment.

For every phase: list files changed, explain decisions, run tests/builds, report failures honestly, and wait for approval before moving to the next phase.

## 8. Business rules to preserve
- One checkout can contain products from multiple vendors: create one parent order and separate vendor orders.
- Vendors can access only their own products and vendor orders.
- Delivery staff can access only deliveries assigned to them.
- Customers can access only their own account, addresses, cart and orders.
- Admin account creation must not be public.
- Calculate prices and discounts on the server; never trust totals from Flutter.
- Store money as integer paise (₹1 = 100 paise).
- Verify Razorpay signatures and webhooks on the server; process callbacks idempotently.
- COD is not financially settled merely because a delivery person marks cash collected; reconcile collections.
- Store order item/address/price snapshots so historical orders do not change when catalog data changes.
- Reserve inventory atomically and release it on failed/expired orders.
- Keep private KYC/bank documents private; never log passwords, OTPs, tokens or bank data.
- GPS live tracking is deferred to a later phase.

## 9. Current status
This ZIP is a development starter. It is **not** production-ready and does not yet implement all proposal features. Never use real customer data or live payment credentials until security review, tests, webhook verification and deployment hardening are complete.
