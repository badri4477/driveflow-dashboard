# Project Memory

## 1. Project Snapshot
- backend/: Node (ESM) + Express + Mongoose, MongoDB Atlas, S3 uploads (`carzzi_uploads/`), Cashfree payments (`CASHFREE_ENV` = `sandbox` | `production`), Socket.IO 4.8. `APP_ENV=testing` disables OTP send/verify.
- frontend/: React + Vite + TS + shadcn/Tailwind (customer, merchant, admin, staff pages).
- mobile/: Flutter customer app (parity with frontend customer pages).
- staff/: Flutter app for merchants (merchant_* pages) and staff/drivers.
- Surface pairs for parity: frontend customer ⇄ mobile; frontend merchant ⇄ staff/lib/pages/merchant.

## 2. Architecture notes
- Booking status changes: `PUT /bookings/:id/status` (side effects: stock deduction, customer push). `PUT /bookings/:id/details` merges inspection/serviceExecution/qc/billing/parts; saving a bill auto-moves SERVICE_STARTED → SERVICE_COMPLETED (without those side effects).
- Admin payments list = `cashfreePaymentController.getAllPayments` (route `/payments/all`). `paymentController.getAllPayments` is an unused legacy copy.
- Vehicle health indicators live on the VEHICLE, not the booking. Completing any general service re-stamps every indicator's `lastUpdated`.
- Pickup/drop price comes from the vehicle reference (S3 price list, `pickup_drop_price`), falling back to booking. As of 2026-10-29 every reference row has it blank, so bookings show ₹0.

## 3. Design System (staff app)
- Purple accent `#7C3AED` (`AppColors.primaryPurple` in dark mode). Cards: white, radius 20, border `#EDE9FE`, soft purple shadow. Section header = 40–44px round tinted icon tile + 17px w700 title.
- Merchant order detail helpers: `_overviewCard`, `_overviewPill`, `_cardDecoration`, `_sectionTitle`, `_iconTab`. Tabs use `_fabClearance` (104) bottom padding so the chat FAB never covers the last button.
- Feedback = coloured floating toasts via `StatusFeedback.success/error/warning/info/auto` (`AppToast` delegates). Full-screen status cards were tried and rejected (see Do Not Repeat).
- Page states: `SkeletonList`/`SkeletonCard` while loading, `StateView.error(onRetry)`/`.empty`/`.wrong` (`refreshable: true` inside RefreshIndicator). Inline error only when there's no data; a failed background refresh keeps the data and toasts.
- Photos: `chooseImageSource` (camera/gallery) + `pickImageSafely` (staff/lib/widgets/image_source_sheet.dart). Tap-to-zoom viewer: `ViewableImage` / `showImageViewer` / `openDocumentInApp` (widgets/image_viewer.dart).

## 4. Engineering Decisions
- Periodic/general services are paid AFTER service; totals recalc on parts/billing edits and inspection-part approval. Customer Pay enabled only from SERVICE_COMPLETED on. Car wash/essentials/battery/tyre are prepaid. My Payments (web + mobile) shows "Est. ₹… / Due after service" until the final bill; mobile amount = finalAmount → billing.total → totalAmount (same as web). Date: 2026-10-29
- Admin DELIVERED (OTP override) ⇒ `paymentStatus='paid'` + `booking.manualPayment {markedBy, markedAt, amount}` (no Payment doc). Admin payments page adds synthetic rows: unpaid bookings at SERVICE_COMPLETED+ as "pending", paid bookings without a paid Payment as "paid". Date: 2026-10-29
- QC unlock = "Save Service Data" only: it records `serviceExecution.jobEndTime` (web + app). Auto-saved part/after images don't unlock QC. App jumps to QC after save; button shows "Service Data Saved" when clean. Date: 2026-10-29
- Health per order: values shown only if `booking.healthSavedAt` is set (backend stamps it when details update sends `healthSaved: true`). New orders for the same car start empty (web + app). Save Health → Billing tab; button shows "Health Stats Saved" when clean. Date: 2026-10-29
- Health % = remaining life (same rule as web `vehicleHealthRemaining.ts`): with Fixed KM/Days it's 100% until lastServiceDate, then decays. Date: 2026-10-29
- Approved inspection parts auto-join Service Parts (web + app), ids `inspection_<index in ALL additionalParts>`; part after-images auto-save on pick. Date: 2026-10-29
- Billing (app = web BillUploadPanel): parts prefilled from recorded parts, pickup/drop read-only from vehicle reference, read-only live Total incl. base service, invoice alnum ≤20, no future date, amounts ≤6 digits. Bill locked (no submit/change) from SERVICE_COMPLETED or paid. Submit skips the status call when already SERVICE_STARTED+. Date: 2026-10-29
- Merchant invoice download: `GET /api/upload/download-url` signs an S3 GET with `Content-Disposition: attachment` (own bucket + `carzzi_uploads/` only). Used by web customer track page, admin booking page, customer app. Date: 2026-10-29
- Sockets: client `auth` is a function (fresh token per reconnect); server tries handshake token then cookie. `newApproval` is emitted once across rooms. Customer gets one booking toast (no "New Booking"/"CREATED" toasts). Date: 2026-10-29
- Chat unread badge: per-booking last-seen time in localStorage (web) / SharedPreferences (both apps, `ChatSeenStore`). Date: 2026-10-29
- Live staff location = road route (OSRM) to customer, or to the workshop after pickup; hidden after DELIVERED/COMPLETED/CANCELLED everywhere. Web staff page stops sharing GPS on finished orders. Date: 2026-10-29
- Merchant app back gesture: from any tab → Home (PopScope in MerchantScaffold); only Home exits. Orders open order detail with pushNamed. Date: 2026-10-29
- Merchant app speed: bookings fetched once per Home load (stats computed locally), parallel fetches, in-memory `BookingService.cachedMerchantBookings` for instant Home/Orders. Date: 2026-10-29
- Hidden in merchant UIs (code kept): Add New Discovery, Request Extra Cost Approval, Mark Delay / Hold, "Complete QC Check and Health…" hint, Customer Notes card. Recent Orders on merchant home = max 3 (web + app). Date: 2026-10-29
- Mobile testing setup: staff app uses `http://localhost:5000` + `adb reverse tcp:5000 tcp:5000` on a physical phone (`Env.isPhysicalDevice`); cleartext only in the debug manifest. Testing-mode `skipOtp` is handled on phone/email login in both apps. Date: 2026-10-29

## 7. Known Issues
- Approving inspection parts recalculates totals but not the coupon discount.
- Bill save auto-completing the service skips stock deduction + the customer "payment due" push (true on web too).
- Three older admin-delivered bookings (INV2026102801, INV2026101702, INV2026092301) are still `paymentStatus: pending`; a DB update was blocked pending user approval.
- `payments` collection was emptied on 2026-10-29 (backup in the session scratchpad); old paid bookings appear via synthetic admin rows.

## 8. Important Constraints
- staff/android stays on Gradle 8.14 / AGP 8.11.1 / Kotlin 2.2.20. AGP 9 breaks the Flutter build script (`android{}`/`kotlinOptions` deprecated-as-error); upgrade on a separate branch only.

## 11. Do Not Repeat
- Full-screen status cards instead of toasts — user rejected; use toasts.
- Using the vehicle indicator `lastUpdated` to decide which order owns health values — re-stamped on every service completion.
- `lastUpdated`-based or count-based "service saved" checks (any part/photo) — unlocked QC too early.
- Editing `paymentController.getAllPayments` — the live route uses cashfreePaymentController.

## 12. Last Updated
2026-10-29
