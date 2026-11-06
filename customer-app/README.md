# FurniSpace Customer App

The customer-facing Flutter app for browsing approved marketplace furniture and managing customer orders. It connects to the existing Express API; product, cart, checkout, inventory, and payment values are not fabricated or trusted from the device.

## Technologies

- Flutter / Dart
- Material 3
- `http` for REST requests
- `flutter_secure_storage` for access and refresh tokens
- `razorpay_flutter` for Razorpay Checkout in TEST mode only

## Run locally

Requirements: Flutter stable, Android SDK/emulator, and the marketplace backend running with MongoDB configured.

```powershell
cd customer-app
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:5000/api
```

`10.0.2.2` is the Android emulator's route to the host computer. For an Android physical device, use the computer's LAN IP and ensure both devices are on the same trusted network. iOS simulator/physical-device builds should use an HTTPS API endpoint; ATS does not permit the default local HTTP URL. Do not expose a development HTTP API to the public internet.

The API root can be changed without source edits:

```powershell
flutter run --dart-define=API_BASE_URL=https://your-api-host.example/api
```

The default value is `http://10.0.2.2:5000/api`. Android cleartext traffic is enabled only in the debug manifest for local development; release builds should use HTTPS.

## Implemented customer workflows

- Session restore, customer login/registration, backend email/mobile OTP verification, token refresh/rotation, and logout.
- Public catalog and category browsing, server search/sort/category filtering, product detail/specifications, stock display, and paginated loading.
- Authenticated cart updates, custom color/material/note selection, wishlist and move-to-cart.
- Authenticated address create/edit/delete/default selection.
- Server-validated COD and checkout, order history/details, vendor-wise status, permitted vendor-order cancellation, and status timeline.
- Razorpay Checkout only when the backend returns a `rzp_test_` key. The app submits gateway responses to the backend for verification; it never includes a Razorpay secret or marks payment captured locally.
- Loading, retryable error, and empty states for the main API-backed lists.

## API connection

The app uses the existing backend routes:

- `/api/auth`: register, login, refresh, logout, profile, OTP send/verify
- `/api/categories` and `/api/products`: public catalog
- `/api/customer`: cart, wishlist, and address book
- `/api/orders`: checkout, customer history/details, and cancellation
- `/api/payments`: create gateway order, verify payment, and read server payment status

All authenticated calls send a bearer access token. On the backend's `TOKEN_EXPIRED` response, the app rotates the stored refresh token and retries the original request once. Tokens are stored using the platform secure-storage plugin, not ordinary preferences or logs.

## Testing and analysis

```powershell
flutter analyze
flutter test
```

Tests cover API query/response parsing, secure bearer-token use, server cart totals, backend error propagation, access-token refresh, catalog rendering/error state, and sign-in form validation.

## Payment and security notes

- The backend remains authoritative for cart prices, stock validation, order totals, payment status, and payment signature verification. The UI displays monetary values in INR from integer paise.
- Online payment is blocked unless the backend returns a TEST-mode Razorpay key (`rzp_test_...`). If the backend returns a mock order or no test key, the order remains pending and the app explicitly does not simulate payment.
- Configure Razorpay test credentials on the backend only. Never put the key secret in Flutter or commit credentials.
- OTP delivery depends on the configured backend email/SMS provider. The app does not generate, reveal, or pretend to deliver OTPs.

## Current limitations

- GPS/live delivery tracking, live payments, and refund initiation are not implemented.
- The Razorpay gateway UI launches only with a non-mock TEST key. Checkout can leave an online order pending when the backend is in mock mode or lacks a TEST key; no payment is simulated, and the order can be inspected or retried later when correctly configured.
- The current backend does not expose featured/recommended-product or campaign-banner APIs. The home screen uses a generic introduction and the public catalog rather than inventing campaign or recommendation data.
- The project was validated with Flutter analysis and automated tests; physical Android and iOS device testing and iOS build verification still require the corresponding device/macOS tooling.
- API availability and authenticated workflows require a configured backend and database; this app does not include production sample products or local fallback data.
