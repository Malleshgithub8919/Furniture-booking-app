# Antigravity Master Prompt — Furniture Marketplace

Act as a senior software architect and a cross-platform engineering team. Work inside this existing repository; do not replace it with a generic template.

## Product
Build a production-grade furniture booking and multi-vendor marketplace with:
- Customer mobile app: Flutter
- Vendor mobile app: Flutter
- Delivery mobile app: Flutter
- Admin web panel: React + Vite
- Backend: Node.js + Express
- Database: MongoDB Atlas + Mongoose
- REST API, JWT authentication, OTP verification
- Razorpay + Cash on Delivery
- Firebase Cloud Messaging, Cloudinary, Socket.IO
- Swagger/OpenAPI documentation
- GPS live tracking is a later phase, not part of the initial MVP.

## Working rules
1. First inspect the whole repository and report the current structure before editing.
2. Preserve the agreed stack. Do not switch to Firebase as the primary database.
3. Do not add Tailwind or Bootstrap unless explicitly approved. Use clean, maintainable CSS for the admin panel and Flutter Material components with a consistent design system.
4. Do not generate fake backend success responses or pretend integrations work without credentials.
5. Use feature-based architecture, reusable components, typed models, service/repository boundaries, validation and centralized error handling.
6. Never put secrets in source code. Use `.env.example`; keep `.env` ignored by Git.
7. Implement server-side authorization for every protected operation. Hiding a button is not authorization.
8. Use integer paise for all money calculations.
9. Add unit/integration tests for business-critical logic.
10. At the end of each phase, run relevant tests/builds, list changed files, report exact results and known gaps. Do not claim production readiness without evidence.
11. Work in small phases. Ask for approval before beginning the next phase.

## Core workflows
- Customer browses categories/products, selects variants/customization, manages addresses/cart/wishlist, checks out, pays or chooses COD, tracks orders, reviews delivered products and raises complaints.
- Vendor registers, submits KYC, waits for admin approval, manages catalog/inventory, accepts and processes only their own vendor orders, marks ready/handed over, views earnings.
- Admin approves vendors/products/delivery staff, manages users/categories/orders/payments/coupons/complaints/refunds/settlements/reports.
- Delivery staff sees assigned jobs only, accepts delivery, picks up, verifies delivery OTP/proof and records COD collection for later reconciliation.

## Order architecture
A checkout may contain items from several vendors. Create:
- One parent `Order` for the customer checkout/payment.
- One `VendorOrder` per vendor.
- One `Delivery` per vendor order where applicable.
Use MongoDB transactions for related database writes where supported. Do not keep external payment provider calls inside a database transaction. Store immutable item/address/price snapshots. Maintain `OrderStatusHistory`.

## Security
Use password hashing (bcrypt or Argon2), short-lived access tokens, refresh-token rotation/revocation, OTP expiry and attempt limits, rate limiting, Helmet, strict CORS allowlist, input validation, safe file upload validation, private KYC storage, audit logs for privileged actions and no public admin registration. Verify Razorpay payment signatures and raw-body webhook signatures. Make payment/webhook processing idempotent.

## Phase 1 request
Inspect the starter repository. Implement only backend foundation improvements:
- Express app/server separation
- environment validation
- MongoDB connection lifecycle
- centralized 404/error middleware
- request logging without secrets
- `/api/health` and `/api/ready`
- basic automated tests
Do not implement all business modules in one pass. Report commands to run locally and wait for approval.
