# MediReech Backend

Node.js + Express + MongoDB API for the MediReech platform.

## Support tickets (Phase 11)

Customers and pharmacy owners can open support tickets; platform admins manage assignment, status, and replies.

### Workflow

1. **Create** — `POST /api/v1/support/tickets` (CUSTOMER or PHARMACY_OWNER).
2. **Thread** — `POST /api/v1/support/tickets/:ticketId/messages` (not allowed when status is `CLOSED`).
3. **Resolve** — admin sets status to `RESOLVED` or `CLOSED`.
4. **Reopen** — creator may `POST .../reopen` when status is `RESOLVED`.

Internal admin notes are stored separately and are never returned on customer/pharmacy APIs or notifications.

### Example — create ticket (customer)

```http
POST /api/v1/support/tickets
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "category": "ORDER_ISSUE",
  "subject": "Missing medicine at pickup",
  "description": "One item from reservation RES-001 was not available.",
  "relatedReservation": "665f1f77bcf86cd799439011"
}
```

### Example — assign ticket (super admin)

```http
PATCH /api/v1/admin/support/tickets/:ticketId/assign
Authorization: Bearer <super_admin_token>
Content-Type: application/json

{
  "assigneeId": "665f1f77bcf86cd799439099"
}
```

### Attachments

Attachment fields are **private storage metadata** (`fileKey`, `fileType`, `sizeBytes`). Uploads require `PRIVATE_OBJECT_STORAGE_ENABLED=true` in non-test environments; keys must start with `private/`.

## Scripts

- `npm test` — full Jest suite
- `npm run process:notifications` — drain notification outbox
