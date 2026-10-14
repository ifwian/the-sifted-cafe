# API reference

Base URL (local): `http://localhost:3000`. All bodies are JSON. Errors look like `{ "error": "text" }`; validation errors also include `"errors": { "field": "message" }`.

**Staff routes** need the `sifted_admin` cookie (set by login). Every non-GET staff request must also send the header `X-Requested-With: fetch` (the pages do this automatically). Without a valid session the answer is `401`; without the header, `403`.

| Method | Path | Who | Purpose | Success |
|---|---|---|---|---|
| GET | `/api/config` | public | Branches, hours and limits used by the form | 200 |
| GET | `/api/health` | public | Is MySQL reachable? | 200 / 503 |
| POST | `/api/reservations` | public | Create a request (status `pending`) | 201 |
| POST | `/api/auth/login` | public | `{username, password}` → sets cookie | 200 |
| POST | `/api/auth/logout` | staff | Ends the session | 200 |
| GET | `/api/auth/me` | staff | Who is signed in | 200 |
| GET | `/api/reservations` | staff | List with filters (below) | 200 |
| GET | `/api/reservations/summary` | staff | Counts per status | 200 |
| GET | `/api/reservations/:id` | staff | One reservation | 200 |
| PUT | `/api/reservations/:id` | staff | Replace editable fields incl. `status`, `admin_notes` | 200 |
| PATCH | `/api/reservations/:id/status` | staff | `{status}` only | 200 |
| DELETE | `/api/reservations/:id` | staff | Delete | 200 |

## POST /api/reservations
Body: `customer_name`, `phone`, `email?`, `branch`, `reservation_date` (`YYYY-MM-DD`), `reservation_time` (`HH:MM`), `guests`, `special_requests?`, and the hidden `website` field (must stay empty).
`201` → `{ message, reservation: { reference, customer_name, branch_name, reservation_date, reservation_time, guests, status: "pending" } }`.
`400` validation or honeypot · `429` too many saved requests from one device (10 per 15 min) · `503` database unavailable (nothing was saved).
Any `status` or `admin_notes` sent by the public is ignored.

## GET /api/reservations — query parameters
`status`, `branch`, `dateFrom`, `dateTo` (`YYYY-MM-DD`), `search` (name, phone, email, or `SC-00012`), `sort` = `newest` (default) | `upcoming` | `latest_date`, `page` (1+), `pageSize` (1–100, default 15). Unknown values → `400`.
Response: `{ reservations: [...], pagination: { page, pageSize, total, totalPages } }`. Each reservation has `id, reference, customer_name, phone, email, branch, branch_name, reservation_date, reservation_time, guests, special_requests, status, admin_notes, created_at, updated_at`.

## Status codes used
`400` bad input · `401` not signed in / wrong password · `403` missing security header · `404` not found · `413` body too large · `429` rate limited · `500` unexpected error · `503` database unavailable.

## Login limits
10 login attempts per device per 15 minutes (counter resets after a successful login).
