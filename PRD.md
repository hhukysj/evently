# Evently --- Product Requirements Document

**Status:** MVP specification\
**Product:** Evently\
**Primary market:** India initially; design currency, locale, and
compliance boundaries so additional markets can be added later.

## 1. Product definition

Evently is a two-sided services marketplace connecting people planning
events with event organizers, event managers, and independent artists or
vendors. Customers describe an event, discover suitable professionals,
compare verified profiles and packages, request bookings, communicate,
and review completed work. Professionals manage their profiles,
services, availability, enquiries, and bookings.

Evently is not an event ticketing platform. Ticket sales, venue ticket
scanning, social feeds, AI matching, and multi-country operations are
out of MVP scope.

## 2. Goals and success measures

-   A customer can create an event brief and send a booking request to a
    professional.
-   A professional can respond to a request and manage confirmed work.
-   Every core workflow uses the API and persistent database; no fake
    success states or mock production data.
-   Authorization is enforced on the server for every private resource
    and state transition.
-   Product performance, reliability, accessibility, and operational
    visibility can be measured.

Suggested initial metrics: event briefs created, profile-to-enquiry
conversion, enquiry response time, request acceptance rate, completed
bookings, review rate, error rate, and p95 API latency. Establish
baselines before setting targets.

## 3. User roles and permissions

### Customer

-   Register, sign in, sign out, verify email, recover account, and
    manage own profile.
-   Create and edit own event briefs.
-   Search and filter professionals, view public profiles, portfolios,
    services, packages, and availability.
-   Save/favourite professionals.
-   Send booking requests with event details; view and cancel eligible
    requests.
-   Message professionals only through an authorized conversation.
-   Review a professional only after an eligible booking is completed.
-   Report a profile, message, or booking and manage notification
    preferences.

### Professional

A professional account can represent an organizer, event manager,
artist, or vendor. A user may select multiple service categories. -
Create and maintain a professional profile, service areas, portfolio,
services/packages, indicative prices, and availability. - Receive,
accept, decline, or propose changes to booking requests. - View only
enquiries and bookings they are authorized to access. - Communicate with
customers attached to a valid conversation. - Mark eligible bookings
completed, subject to the agreed completion workflow. - Respond to
reviews where enabled; report abuse. - See basic business activity
metrics. No fabricated analytics.

### Administrator

-   Access a separate, tightly controlled administrative interface.
-   Review reports, moderate profiles/portfolio content, suspend
    accounts, and audit sensitive actions.
-   Admin access requires server-side authorization, least privilege,
    and audit logging.
-   Do not allow admins to impersonate users silently.

## 4. MVP functional requirements

### Discovery

-   Search professionals by keyword and category.
-   Filter by event/service category, service area or distance when
    coordinates are available, price range, rating, and availability
    where data supports it.
-   Sort by relevance, rating, and price. Do not claim a filter works
    unless the backend actually applies it.
-   Show loading, empty, error, and retry states.
-   Public profiles expose only intentionally public fields.

### Event brief

Required fields: event type, event date/time or date range, location,
estimated guest count, budget range, requested services, and customer
notes. Validate fields on both client and server. Store timestamps
consistently; display them in the event's local timezone where known.
Location text alone must not be presented as precise distance.

### Booking lifecycle

Use explicit, server-validated states:
`requested → accepted | declined | cancelled` An accepted booking may
proceed to `completed`; disputes/reports are separate records rather
than improvised status strings. Change requests must be represented
explicitly or recorded as a proposed revision, not silently overwrite
agreed details. - Prevent duplicate submissions with idempotency or
request deduplication. - Enforce valid transitions on the server in a
database transaction. - Define cancellation permissions and cut-offs
before enabling cancellation. - A professional's acceptance does not
charge a customer in the MVP. - Do not imply that a booking is paid or
guaranteed unless a payment workflow exists.

### Messaging

-   Persistent, paginated messages.
-   Only participants can read or send messages in a conversation.
-   A conversation must be linked to an eligible enquiry/booking or
    otherwise created through a deliberate authorized flow.
-   Sanitize/render text safely; limit message length and rate.
-   Start with API polling or refresh-on-open. Add WebSockets only when
    product needs justify their operational cost.
-   Attachments are out of MVP unless secure upload, limits, malware
    scanning, and authorization are implemented.

### Reviews and trust

-   One review per eligible completed booking, enforced in the database.
-   Store rating and text with validation and moderation/reporting
    support.
-   Never accept a client-provided reviewer identity or booking
    ownership.
-   "Verified" badges must be based on a documented verification
    process, not merely account registration.

### Notifications

-   In-app notifications for booking requests, decisions, messages,
    cancellations, and relevant account events.
-   Mark-as-read and pagination.
-   Email notifications can be added through a provider; failures must
    not roll back the booking transaction.
-   Avoid duplicate notifications using idempotent event handling.

### Uploads

-   Profile/portfolio media stored in object storage, not the
    application server filesystem.
-   Validate file type by content as well as extension, size, and image
    dimensions; generate safe derivatives.
-   Use signed upload/download URLs where appropriate, ownership checks,
    and deletion handling.
-   Never trust a submitted file URL or allow arbitrary remote URL
    fetching.

### Account and privacy

-   Email verification and password reset with short-lived, single-use
    tokens.
-   Profile editing, account deactivation, and a documented
    deletion/data-retention workflow.
-   Collect only necessary personal data; never expose private contact
    details by default.
-   Provide privacy notice, terms, community guidelines, and a
    contact/report path before public launch.

## 5. MVP non-functional requirements

-   Responsive, keyboard-accessible interface with visible focus,
    labels, and understandable errors.
-   Server-side validation for every mutation; client validation is only
    for usability.
-   Database constraints for invariants, transactions for multi-row
    state changes, and indexes for real query patterns.
-   Structured logs, request IDs, error monitoring, health/readiness
    endpoints, backups, and a tested restore procedure.
-   Rate limiting and abuse controls for authentication, messaging,
    search, and reports.
-   Secure headers, restricted CORS, CSRF protection when cookie
    sessions are used, and safe cookie settings.
-   No secrets in source control, client bundles, logs, or error
    responses.
-   Automated tests for authorization, booking transitions, validation,
    and critical user journeys.
-   Target scalable deployment through stateless app instances and a
    managed PostgreSQL service; validate capacity with load tests rather
    than promising arbitrary scale.

## 6. Out of scope until the core booking loop is reliable

-   Razorpay or other payments, refunds, commissions, escrow, invoices,
    and tax automation.
-   Microservices, Kubernetes, event streaming infrastructure, and
    premature multi-region deployment.
-   AI-generated recommendations, chatbots, or automatic matching.
-   Ticketing, attendee check-in, seating plans, social feeds, and
    native mobile apps.
-   Complex disputes and insurance claims. Create a manual support
    process first.

## 7. Acceptance criteria

A release is not complete unless: 1. All visible buttons/links have a
defined action, or are clearly disabled with a reason. No dead controls.
2. No production route uses mock data or simulates a successful
mutation. 3. A user cannot read or change another user's private event,
booking, conversation, message, or profile settings by changing an ID.
4. Invalid booking transitions and duplicate reviews are rejected
server-side. 5. Failed API requests show useful error states and do not
display success. 6. Search filters are applied by the backend and have
tests. 7. Database migrations run from a clean database and can be
deployed repeatably. 8. Critical flows pass automated tests:
registration/login, event brief, search, request, accept/decline,
messaging, completion, review. 9. Logs and error responses do not expose
passwords, tokens, session IDs, or unnecessary personal data. 10. A
documented staging deployment and database restore test exist.

## 8. Product decisions to settle before launch

-   Whether customers may contact professionals before creating an event
    brief.
-   Exact cancellation rules and when a booking becomes completed.
-   Whether professional profiles require manual approval before public
    listing.
-   Which location provider/geocoding service is permitted and its cost.
-   Whether prices are indicative, fixed package prices, or quote-based.
-   Legal entity, marketplace terms, privacy policy, and India-specific
    tax/payment obligations before collecting money.
