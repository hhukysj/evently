# Evently --- Design System and UX Specification

## 1. Design direction

Build a credible, modern marketplace for event services. Prioritize
trust, legibility, clear pricing/quotes, and task completion over
decorative animation. The interface should feel professional enough for
customers making consequential bookings and simple enough for
independent artists to manage enquiries.

No emoji in interface copy, no fake counters, no fake testimonials, no
placeholder controls presented as functional, and no excessive
gradients/glows or generic AI-generated marketing language.

## 2. Information architecture

### Public

-   Home / landing page
-   Discover professionals
-   Category results
-   Professional profile
-   Sign in / create account / account recovery
-   Terms, privacy, community guidelines, contact/support

### Customer workspace

-   Overview
-   My events
-   Booking requests and bookings
-   Messages
-   Saved professionals
-   Notifications
-   Account and privacy settings

### Professional workspace

-   Overview
-   Profile and public preview
-   Services and packages
-   Portfolio
-   Availability
-   Enquiries and bookings
-   Messages
-   Reviews
-   Business settings

### Administration

-   Reports queue
-   Profile/content moderation
-   User/account actions
-   Audit history

Navigation and routes must be permission-aware, but server authorization
remains mandatory.

## 3. Visual system

-   Use a restrained neutral foundation with one accessible primary
    accent. Choose final brand colors only after checking contrast in
    light and dark contexts.
-   Typography: one readable sans-serif family, clear hierarchy,
    comfortable line height, and consistent text widths.
-   Layout: responsive grid, consistent spacing scale, aligned cards,
    generous whitespace, and predictable page headers.
-   Components: buttons, inputs, selects, date/time controls, budget
    range, category chips, profile cards, status labels, dialogs,
    tables/lists, pagination, toasts, skeletons, empty states, and
    confirmation prompts.
-   Use icons only where they improve comprehension; include accessible
    labels for icon-only controls.
-   Motion is optional and subtle. Respect reduced-motion preferences.
    Do not make animation necessary to understand state.
-   Images must have a defined aspect ratio and sensible fallback; avoid
    layout shifts.

## 4. Key screens and required states

### Discovery results

-   Search field, category selector, and only filters supported by real
    backend fields.
-   Professional card shows name/business name, categories, service
    area, indicative price or "Request a quote," rating/review count
    only when real, and a clear profile action.
-   Loading skeleton, no results, network error/retry, and partial-data
    states.
-   Preserve filters in the URL when practical so results can be shared.

### Professional profile

-   Profile summary, services/packages, portfolio, service area,
    availability if accurate, real reviews, and clear enquiry/booking
    action.
-   Distinguish indicative price from a confirmed quote.
-   Do not expose personal phone/email or private customer information
    without a deliberate policy.

### Event creation

-   Use a short, validated, multi-step form only if it reduces cognitive
    load; show progress and allow back navigation without losing entered
    data.
-   Collect event type/date/time/timezone, location, guest count,
    budget, required services, and notes.
-   Display field-level errors, preserve input after recoverable
    failures, and prevent double submission.

### Booking detail

-   Show event summary, professional, request/quote details, current
    status, status history where useful, messages, and available next
    actions.
-   Render actions based on the server-provided state, but still handle
    server rejection and stale state.
-   Confirm irreversible or consequential actions such as cancellation.
-   Never show a payment-success state when payment integration is
    absent.

### Messaging

-   Clear sender/time labels, unread state, pagination or load-more,
    empty state, send failure and retry.
-   Prevent sending while the same request is in flight; do not silently
    drop messages.
-   Only display conversations the authenticated user can access.

### Forms and account

-   Label every field; do not use placeholders as the only labels.
-   Provide password visibility toggle, password requirements, and
    accessible validation.
-   Use neutral authentication errors that avoid account enumeration.
-   Show pending verification and reset-email states without exposing
    whether an account exists.

## 5. Interaction rules

-   Every button, link, menu item, filter, tab, and form must have a
    defined, tested behavior.
-   Use links for navigation and buttons for actions.
-   Destructive actions require confirmation and clear consequences.
-   Disable controls only while an action is genuinely unavailable or in
    flight; explain permanent unavailability.
-   Display success only after the server confirms success.
-   Display errors with a recovery path; never swallow failed requests.
-   Handle loading, empty, success, validation-error, permission-denied,
    not-found, and server-error states.
-   Avoid optimistic updates for consequential booking transitions
    unless rollback and conflict handling are implemented.
-   Prevent double submits and preserve safe user input after
    recoverable errors.

## 6. Accessibility and responsive behavior

-   Target WCAG 2.2 AA where applicable.
-   Full keyboard navigation, visible focus, semantic headings, correct
    form labels, accessible dialog focus handling, and status
    announcements for async updates.
-   Do not rely on color alone for booking states.
-   Test contrast, zoom/reflow, reduced motion, screen-reader names, and
    keyboard-only flows.
-   Start with mobile layouts, then expand for tablet and desktop. On
    small screens, prioritize the primary action and avoid dense tables.

## 7. Content rules

-   Use direct, specific language. Example: "Request booking," "Awaiting
    response," "Booking accepted," "No professionals match these
    filters."
-   Distinguish "Request sent" from "Booking accepted" and from "Payment
    received."
-   Do not invent ratings, reviews, provider availability, savings,
    popularity, verification, or response-time claims.
-   Include useful empty states with a next step.
-   Confirm destructive actions with plain language.

## 8. Design QA checklist

-   All routes have loading, empty, error, and permission-denied states
    where relevant.
-   No dead buttons, fake data, dead-end forms, or success messages
    after failed requests.
-   Forms validate on client for usability and on server for security.
-   Focus order and keyboard interactions work.
-   Layouts work at narrow mobile, tablet, and wide desktop sizes.
-   Booking states are consistent across lists, details, notifications,
    and messages.
-   Real data is clearly distinguished from indicative or unavailable
    data.
