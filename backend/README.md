# Furniture Marketplace — Backend API Documentation

A production-ready Node.js & Express API with MongoDB Atlas, Mongoose, and enterprise security architecture.

---

## 1. Setup & Environment

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure `.env` from `.env.example`:
   ```bash
   cp .env.example .env
   ```
3. Required Environment Variables:
   - `PORT`: Server port (default: 5000)
   - `NODE_ENV`: `development` | `production` | `test`
   - `MONGODB_URI`: MongoDB Atlas connection string
   - `JWT_ACCESS_SECRET`: Secret key for access tokens (min 32 characters)
   - `JWT_ACCESS_EXPIRES_IN`: Short-lived access token expiry (default: 15m)
   - `JWT_REFRESH_SECRET`: Secret key for refresh tokens (min 32 characters)
   - `JWT_REFRESH_EXPIRES_IN`: Refresh token validity (default: 7d)
   - `OTP_EXPIRY_MINUTES`: OTP validity window (default: 10 minutes)
   - `OTP_PROVIDER`: `console` for simulated local OTP delivery, or `smtp` for email OTP delivery
   - `CLIENT_ORIGINS`: Allowed CORS origins (e.g. `http://localhost:5173`)

### Email OTP with SMTP

The default `OTP_PROVIDER=console` intentionally simulates OTP delivery and does not send email. To send real email, set `OTP_PROVIDER=smtp` and configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and optionally `SMTP_FROM` in the private `backend/.env` file. Never commit or share that file.

For Gmail, use `SMTP_HOST=smtp.gmail.com`, port `465`, and `SMTP_SECURE=true`. `SMTP_USER` is the sending Gmail address and `SMTP_PASS` must be a Google App Password; do not use your regular Gmail password. Restart the backend after changing the environment. The SMTP request has a configurable timeout (`SMTP_TIMEOUT_MS`, default 10 seconds), and delivery errors return an explicit service-unavailable response without logging the email address, OTP, or credentials.

### First Admin Account Setup

Public registration creates customer accounts only; it cannot assign the `admin` role. Create the first admin with the interactive bootstrap command below. It does not create an account automatically when the backend starts.

#### Prerequisites

- Node.js dependencies are installed in `backend` (`npm install`).
- `backend/.env` is configured with a reachable MongoDB URI and the required JWT secrets.
- You can connect to the intended database and have permission to create users and the provisioning-lock collection.
- No admin account already exists in that database.
- Use a private, interactive PowerShell terminal. The bootstrap command refuses test mode and databases whose connected database name contains `test`.

#### Verify the backend environment

In VS Code, choose **Terminal → New Terminal**. From the project root, enter the backend directory:

```powershell
Set-Location .\backend
```

Open `backend/.env` in a trusted editor and verify `NODE_ENV` is not `test` and `MONGODB_URI` points to the intended database. Check the database name and server privately; do not paste, print, screenshot, or share the MongoDB URI because it may contain credentials. Do not put `ALLOW_ADMIN_BOOTSTRAP` in `.env`; it is a one-command opt-in.

#### Provision the account

Run this exact command from the `backend` directory:

```powershell
$env:ALLOW_ADMIN_BOOTSTRAP = 'true'
try {
  npm run admin:provision
} finally {
  Remove-Item Env:ALLOW_ADMIN_BOOTSTRAP -ErrorAction SilentlyContinue
}
```

Enter the administrator's name and email when prompted. The email is trimmed, normalized to lowercase, and validated. Enter a unique password of 12–128 characters twice; password input is hidden and is never printed. The password is hashed using the backend's bcrypt implementation. The command never changes an existing customer/vendor account and refuses to create another admin if one exists. A database-level lock prevents concurrent or repeated first-admin provisioning.

On success, the terminal prints:

```text
First admin account created. Sign in through the admin panel.
```

Start the backend and React Admin Panel as described in their READMEs. Sign in with the email and password entered during provisioning. The login endpoint intentionally shows the same generic invalid-credentials message for an unknown account and a wrong password.

#### Troubleshooting

| Message or symptom | What to check |
|---|---|
| An admin account already exists | Provisioning makes no changes. Sign in with the existing admin account. Do not remove or alter user records to retry. |
| Enter a valid email address | Re-enter an address in a standard `name@example.com` format. |
| Password must contain 12 to 128 characters | Enter and confirm a unique password within that range. The input is hidden. |
| Database connection/permission failure | Verify the intended database host and name in `.env`, network access, and database user permissions. The command reports a safe error category rather than printing the URI or credentials. |
| Set ALLOW_ADMIN_BOOTSTRAP=true | Run the exact PowerShell command above in the same terminal session. The variable is removed when the command exits. |
| Invalid credentials at login | Confirm the panel targets the same backend/database used for provisioning, the email is correct, and the password matches exactly. The generic response does not reveal whether the account exists. |
| Provisioning is not allowed against a test database | Verify `NODE_ENV` and the connected MongoDB database name before retrying. Never point bootstrap at a test database. |

---

## 2. API Endpoints

### System Endpoints
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/health` | Service uptime and status check | None |
| `GET` | `/api/ready` | Verifies database connectivity | None |

### Authentication & Session Endpoints
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/api/auth/register` | Registers customer with validation and dispatches OTP | None |
| `POST` | `/api/auth/login` | Authenticates with email/phone & password (rate-limited) | None |
| `POST` | `/api/auth/refresh` | Rotates refresh token and issues new access token | None |
| `POST` | `/api/auth/logout` | Revokes refresh token session | None |
| `POST` | `/api/auth/otp/send` | Dispatches fresh 6-digit verification OTP | None (Rate-limited) |
| `POST` | `/api/auth/otp/verify` | Validates 6-digit OTP and activates account | None |
| `GET` | `/api/auth/me` | Fetches current user profile | Bearer Token |

### Phase 8: Admin Panel Endpoints

All `/api/admin/*` routes require a valid JWT belonging to an account with the `admin` role. Delivery administration routes use `/api/delivery/admin/*` and enforce the same role check.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/dashboard` | Marketplace totals, review queue counts, and payment statistics |
| `GET` | `/api/admin/customers` | Searchable, paginated customer list |
| `PATCH` | `/api/admin/customers/:id/status` | Update a customer account status |
| `GET` | `/api/admin/vendors` | Searchable, paginated vendor applications |
| `GET` | `/api/admin/vendors/:id` | Admin-only vendor details and KYC metadata (bank details are not returned) |
| `PATCH` | `/api/admin/vendors/:id/status` | Approve, reject, suspend, or return a vendor to review |
| `PATCH` | `/api/admin/vendors/:id/kyc/:documentId` | Verify or reject an uploaded KYC document |
| `GET` | `/api/admin/products` | Searchable, paginated product catalog |
| `PATCH` | `/api/admin/products/:id/status` | Approve, reject, or update product visibility |
| `GET` | `/api/admin/orders` | Searchable, paginated parent orders |
| `GET` | `/api/admin/vendor-orders` | Searchable, paginated vendor order splits |
| `GET` | `/api/admin/payments` | Read-only Razorpay and COD transactions; signatures and metadata are excluded |
| `GET` | `/api/delivery/admin/partners` | Searchable, paginated delivery partners, filterable by review and availability |
| `PATCH` | `/api/delivery/admin/partners/:id/status` | Approve, reject, or suspend a delivery partner |
| `PATCH` | `/api/delivery/admin/partners/:id/availability` | Set an approved partner available or offline when they have no active assignment |
| `GET` | `/api/delivery/admin/assignments` | Searchable, paginated delivery assignments |
| `POST` | `/api/delivery/admin/assign` | Assign an available approved delivery partner |
| `POST` | `/api/delivery/admin/assignments/:id/reassign` | Reassign a delivery assignment with a reason |

List endpoints accept `page` and `limit` parameters. Admin listing routes support `search` and relevant status filters. The admin panel does not initiate payments.

### Phase 3A: Vendor Management Endpoints
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/api/vendors/onboard` | Submits vendor profile registration (status: `pending`) | Bearer Token |
| `GET` | `/api/vendors/me` | Vendor retrieves own profile & KYC document status | Bearer (Vendor) |
| `PUT` | `/api/vendors/me` | Vendor updates own store details (excludes status/commission) | Bearer (Vendor) |
| `POST` | `/api/vendors/me/kyc` | Uploads KYC document metadata; status updates to `under_review` | Bearer (Vendor) |
| `GET` | `/api/admin/vendors` | Admin lists vendors with pagination & status filtering | Bearer (Admin) |
| `GET` | `/api/admin/vendors/:id` | Admin inspects vendor profile with private KYC & bank details | Bearer (Admin) |
| `PATCH` | `/api/admin/vendors/:id/status` | Admin approves, rejects, or suspends vendor profile | Bearer (Admin) |

### Phase 3B: Categories & Furniture Product Catalog Endpoints
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/categories` | Public: List active hierarchical category tree | None |
| `GET` | `/api/categories/:slug` | Public: Get category details and subcategories | None |
| `POST` | `/api/categories` | Admin: Create category | Bearer (Admin) |
| `PUT` | `/api/categories/:id` | Admin: Update category | Bearer (Admin) |
| `GET` | `/api/products` | Public: Search & filter approved products (pagination, price range, materials) | None |
| `GET` | `/api/products/:slugOrId` | Public: View approved product details | None |
| `GET` | `/api/products/vendor/mine` | Vendor: View all products owned by authenticated vendor | Bearer (Vendor) |
| `POST` | `/api/products` | Vendor: Create furniture product (requires `approved` vendor status) | Bearer (Vendor) |
| `PUT` | `/api/products/:id` | Vendor: Update product (only own products permitted) | Bearer (Vendor) |
| `DELETE` | `/api/products/:id` | Vendor: Deactivate product (only own products permitted) | Bearer (Vendor) |
| `PATCH` | `/api/admin/products/:id/status` | Admin: Moderate product catalog status (`approved`, `rejected`) | Bearer (Admin) |

### Phase 4: Customer Cart, Wishlist & Address Management Endpoints
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/customer/cart` | View customer cart with live price recalculation & stock checks | Bearer Token |
| `POST` | `/api/customer/cart` | Add product to cart with customization options & live stock check | Bearer Token |
| `PUT` | `/api/customer/cart/items/:itemId` | Update quantity of cart item | Bearer Token |
| `DELETE` | `/api/customer/cart/items/:itemId` | Remove item from cart | Bearer Token |
| `DELETE` | `/api/customer/cart` | Clear entire cart | Bearer Token |
| `GET` | `/api/customer/wishlist` | View favorite products | Bearer Token |
| `POST` | `/api/customer/wishlist` | Add product to wishlist | Bearer Token |
| `DELETE` | `/api/customer/wishlist/:productId` | Remove product from wishlist | Bearer Token |
| `POST` | `/api/customer/wishlist/move-to-cart` | Atomically move product from wishlist to cart | Bearer Token |
| `GET` | `/api/customer/addresses` | List customer delivery addresses | Bearer Token |
| `POST` | `/api/customer/addresses` | Create delivery address (auto-sets default if first) | Bearer Token |
| `PUT` | `/api/customer/addresses/:id` | Update delivery address (ownership enforced) | Bearer Token |
| `DELETE` | `/api/customer/addresses/:id` | Delete delivery address (ownership enforced) | Bearer Token |
| `PATCH` | `/api/customer/addresses/:id/default` | Set address as default delivery destination | Bearer Token |

### Phase 5: Multi-Vendor Orders, Checkout & Inventory Reservation Endpoints
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/api/orders/checkout` | Customer checkout: atomic stock reservation, multi-vendor order split, MongoDB transaction | Bearer (Customer) |
| `GET` | `/api/orders/mine` | Customer: List own orders with pagination and status filters | Bearer (Customer) |
| `GET` | `/api/orders/mine/:idOrNumber` | Customer: Detailed order view with immutable snapshots and sub-orders | Bearer (Customer) |
| `POST` | `/api/orders/mine/:id/cancel` | Customer: Cancel eligible sub-orders with automatic inventory release | Bearer (Customer) |
| `GET` | `/api/vendors/orders/mine` | Vendor: List own fulfillment sub-orders with pagination & status filters | Bearer (Vendor) |
| `GET` | `/api/vendors/orders/:id` | Vendor: View own vendor sub-order details | Bearer (Vendor) |
| `PATCH` | `/api/vendors/orders/:id/status` | Vendor: Advance fulfillment status (`confirmed`, `preparing`, `shipped`, `delivered`) | Bearer (Vendor) |
| `POST` | `/api/vendors/orders/:id/cancel` | Vendor: Cancel own sub-order and release reserved inventory | Bearer (Vendor) |

### Phase 6: Payments, Razorpay & Cash on Delivery (COD) Endpoints
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/api/payments/create-order` | Customer creates Razorpay payment order for placed ParentOrder | Bearer (Customer) |
| `POST` | `/api/payments/verify` | Customer verifies payment using cryptographic signature | Bearer (Customer) |
| `GET` | `/api/payments/order/:orderId` | Customer/Admin retrieves payment transaction details | Bearer Token |
| `POST` | `/api/payments/webhook` | Official Razorpay webhook handler (HMAC-SHA256 signature verified) | Razorpay Signature |
| `POST` | `/api/payments/confirm-cod` | Admin / Delivery confirms Cash on Delivery collection upon handover | Bearer (Admin/Delivery) |
| `POST` | `/api/payments/expire-unpaid` | Admin or Cron triggers inventory release for unpaid expired orders | Bearer (Admin) |

---

## 3. Server-Side Price Calculation & Integer Paise Architecture

1. **Never Trust Client Prices (Rule 7)**:
   - When items are added to the cart or checked out, any client-submitted `price`, `total`, or `discount` is ignored.
   - Prices are read strictly from the MongoDB `Product` record in **integer paise** (₹1.00 = 100 paise).
   - If a product has a valid `salePrice`, the sale price is applied automatically.
2. **Dynamic Live Rechecks (Rule 8)**:
   - On every cart retrieval (`GET /api/customer/cart`) and checkout (`POST /api/orders/checkout`), product existence, approval status (`status: 'approved'`), and current stock are verified.
   - If stock is insufficient or a product has been unlisted, checkout is rejected.
3. **Atomic Stock Reservation & Multi-Vendor Splitting (Phase 5)**:
   - Multi-document MongoDB transactions guarantee that stock is atomically reserved across all products using `{ $inc: { reservedStock: quantity } }`.
   - Single unified customer checkout creates one `ParentOrder` and cleanly splits into isolated `VendorOrder` sub-orders per vendor.
   - Immutable snapshots store item details, prices, and shipping addresses so subsequent catalog edits never corrupt historic order data.
4. **Idempotency & Partial Cancellation**:
   - `idempotencyKey` prevents duplicate orders from network retries or double clicks.
   - Multi-vendor partial cancellation allows one vendor's sub-order to be cancelled while preserving the rest of the parent order, accurately releasing only that vendor's reserved inventory.
5. **Customer & Vendor Data Isolation**:
   - Customers see only their own parent orders.
   - Vendors see only their own sub-orders and cannot view products or payouts of other vendors in the same parent order.
6. **Payments & Cryptographic Verification Architecture (Phase 6)**:
   - **External Payment Calls Outside DB Transactions (Rule 9)**: Provider API calls (`razorpayService.createOrder`) are executed outside MongoDB transactions.
   - **Zero-Trust Payment Amounts (Rule 11)**: Frontend-submitted payment status or amounts are never trusted. The server verifies that captured payments strictly equal `ParentOrder.pricing.grandTotal`.
   - **Cryptographic HMAC-SHA256 Verification (Rule 2)**: Both client payment callbacks and incoming webhook events are validated using constant-time `crypto.timingSafeEqual` over SHA-256 HMACs.
   - **Webhook Idempotency (Rule 4)**: Processed webhook event IDs are saved in `WebhookEvent`; duplicate deliveries from the payment gateway return HTTP 200 without duplicate state mutations.
   - **Safe Inventory Reservation Expiry (Rule 8)**: Orders remaining unpaid past `PAYMENT_EXPIRY_MINUTES` automatically release their reserved stock. Successfully paid orders are never cancelled or released.
   - **Cash on Delivery (COD)**: Orders placed via COD initialize in `paymentStatus: 'pending'`. Only authorized delivery agents or admins can confirm cash collection upon delivery.

---

## 4. Running Automated Tests

Run the complete test suite:
```bash
npm test
```
Tests automatically execute against the isolated `furniture_marketplace_test` database and safely purge synthetic test records upon completion.
