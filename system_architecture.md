STELLA ASTROLOGY PVT. LTD.
Executive Architecture Blueprint — Volume I
Version 1.0 — Architecture for Review

Status: Proposed Architecture
Purpose: Architecture approval before implementation
Target: Initial 10,000 registered users, with architecture capable of evolving substantially beyond that

Part I — Executive Vision
1. What Stella is

Stella should be designed around one central proposition:

Free astrology creates engagement. Trusted human consultation creates the core business. Technology makes the entire journey reliable, private, intelligent and scalable.

The existing master specification gets this fundamentally right.

Stella combines Vedic astrology, Kundli, Panchang, horoscope, Muhurta, Kundli Matching, Tarot, Numerology, Vastu, Pooja, reports and AI-assisted interpretation with a real-time consultation marketplace.

Therefore, I would define Stella internally as:

A technology-enabled astrology consultation marketplace with an integrated Vedic astrology intelligence platform.

This distinction is important because it determines what we optimize.

The most important metric is not simply:

How many people read today's horoscope?

It is:

How many users receive useful free value → develop trust → find the right astrologer → successfully complete a consultation → return when they need further guidance?

Part II — The Three-Sided Product

Stella has three primary operational actors.

Customer

The customer discovers astrology services, creates Kundlis and family profiles, browses astrologers, receives recommendations, recharges the wallet, chats/calls/video-calls, purchases reports, books services and manages consultation history.

Astrologer

The astrologer completes onboarding and KYC, creates a professional profile, specifies expertise/languages/pricing, controls availability, receives consultations, communicates with customers, produces reports, tracks performance and receives earnings.

Stella Administration

Administration operates the marketplace: customer management, astrologer approval, KYC, live consultation monitoring, financial reconciliation, commissions, payouts, disputes, fraud investigation, content, promotions, security and platform health.

The master specification already provides extensive RBAC roles and requires privileged Super Admin operations to be audited.

That should remain.

Part III — Recommended Technology Decision

This is the first major architectural change I recommend.

Your original document specifies:

React Native + Expo → Mobile
Core PHP → Web
FastAPI → authoritative backend
MySQL → Database

and explicitly prohibits PHP from independently implementing business logic.

After our discussion, I recommend simplifying this.

Proposed final stack
Layer	Recommendation
Customer Web	Next.js + TypeScript
Admin Web	Next.js + TypeScript
Customer Mobile	React Native + Expo + TypeScript
Astrologer Mobile	React Native + Expo + TypeScript
Primary Backend	Node.js + NestJS + TypeScript
Database	MySQL 8
ORM	Prisma or Drizzle
Cache / transient state	Redis
Queue	RabbitMQ
Authentication	Firebase Authentication
Push	Firebase Cloud Messaging
Payment	Razorpay
Voice/video	Provider abstraction → initially Agora/100ms
Chat	Provider abstraction; see Part VIII
Files	AWS S3-compatible object storage
Edge/security	Cloudflare
Web server / proxy	Nginx
Monitoring	Sentry + structured logs + metrics
Containers	Docker
CI/CD	GitHub Actions
Infrastructure	VPS initially
AI	Provider abstraction
Astrology calculations	Dedicated deterministic engine
Why this is better for Stella

The important advantage is TypeScript across almost the entire application.

Instead of maintaining:

PHP + JavaScript + Python + React Native,

your primary product can largely use:

TypeScript + SQL

across web, mobile and backend.

That matters particularly if Claude Code/Codex will assist heavily with development.

You get shared:

types
validation
API contracts
constants
design tokens
utility libraries
schemas

between applications.

Do we abandon Python?

No.

Python should remain available where it has a genuine advantage.

For example:

Astrology calculation service
or
specialized AI/data-processing workers

can later use Python.

But Python does not need to control the entire Stella backend.

Part IV — Architectural Style
Modular monolith first

Your original specification says:

“Use a MODULAR MONOLITH for V1. Do NOT create unnecessary microservices.”

I strongly agree.

For your initial customer base, microservices would create unnecessary operational burden.

The conceptual architecture becomes:

CUSTOMER MOBILE ──────┐
                      │
ASTROLOGER MOBILE ────┤
                      │
CUSTOMER WEB ─────────┤
                      ├──► API GATEWAY / NGINX
ADMIN WEB ────────────┘
                              │
                              ▼
                    NESTJS APPLICATION
                              │
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
     USERS                ASTROLOGY             CONSULTATION
     AUTH                 KUNDLI                MATCHING
     KYC                  PANCHANG              REALTIME
     PROFILE              HOROSCOPE             SCHEDULING
       │                      │                      │
       ├──────────── WALLET / LEDGER ───────────────┤
       │                      │                      │
     PAYMENT              REPORTS                 CHAT
     PAYOUT               AI                     VOICE
     COMMISSION           CONTENT                VIDEO
       │                      │                      │
       └──────────────────────┼──────────────────────┘
                              │
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
           MySQL            Redis          RabbitMQ
                              │
                              ▼
                     EXTERNAL PROVIDERS
        Firebase / Razorpay / Realtime / S3 / AI

These are logical modules, not twenty independent servers.

Part V — Domain Architecture

I would divide Stella into approximately 15 bounded domains.

Identity & Access

Authentication, users, roles, sessions, devices, consent.

Customer

Profiles, birth profiles, family members, preferences, favorites.

Astrologer

Profile, expertise, languages, KYC, availability, pricing, tiers and performance.

Astrology

Kundli, planetary calculations, charts, Dashas, Panchang, Muhurta and compatibility.

Discovery & Matching

Search, filters, ranking, recommendations and intelligent matching.

Consultation

Instant consultation, scheduled appointments, lifecycle and session state.

Communications

Chat, voice, video, notifications and recording metadata.

Finance

Wallet, ledger, holds, debits, credits, refunds and reconciliation.

Marketplace Economics

Pricing, commission, settlement, astrologer earnings and payouts.

Reports & Services

Reports, Tarot, Numerology, Vastu and Pooja.

AI

Interpretation, summarization, matching assistance, content assistance and support.

Trust & Safety

Fraud detection, abuse, suspicious behavior, complaints and investigations.

Content

Horoscopes, articles, Panchang content, FAQs, banners and campaigns.

Administration

Operations, RBAC, settings, feature flags and audit.

Platform Operations

Monitoring, metrics, tracing, alerts, backups and incident management.

This separation becomes extremely important when Claude Code works on the repository because we can tell it:

Modify the consultation domain; do not modify financial settlement behavior.

That is much safer than allowing an AI coding agent to freely change the whole system.

Part VI — Authentication Architecture
Customer authentication

Recommended:

Mobile number + OTP as primary

with optional:

email
Google login
Apple login where appropriate

Firebase Authentication can provide the authentication layer.

But Firebase should authenticate identity, not become Stella's primary business database.

Flow:

Customer
   ↓
Firebase OTP
   ↓
Firebase ID Token
   ↓
Stella Backend
   ↓
Verify token
   ↓
Create / retrieve Stella user
   ↓
Issue Stella application session

Stella's database remains authoritative for:

user status
roles
wallet
birth profiles
consultations
permissions
KYC
business rules

For astrologers, I recommend collecting both verified phone and email.

Admin should require MFA, consistent with your existing security requirement.

Part VII — Customer Application

The customer application should revolve around five navigation areas:

Home | Discover | Consultations | Wallet | Profile

which matches the current specification.

Customer Home

Home should answer four questions immediately:

What can Stella tell me today?

What can I calculate free?

Who can help me personally?

What consultation/report do I already have?

Primary components:

Free Kundli
Today's Horoscope
Panchang
Talk to Astrologer
Recommended Astrologers
Upcoming consultation
Recent reports
Quick astrology tools

Astrologer discovery

Filters should include:

expertise, language, price, availability, experience, rating and consultation type.

An astrologer card should communicate:

photo
name
verification
experience
specialties
languages
rating
price/minute
availability
estimated waiting time

and actions:

Chat | Call | Video | View Profile

Part VIII — Chat Architecture

I would slightly modify my earlier recommendation.

At your starting scale of roughly 100 customers and 20–50 astrologers, you do not necessarily need an expensive third-party chat platform.

A Node/NestJS architecture makes self-hosted chat much more practical.

Recommended:

React Native / Next.js
        ↓
WebSocket
        ↓
NestJS Realtime Gateway
        ↓
Redis
        ↓
MySQL

Use FCM when the recipient is offline.

Messages live permanently in MySQL; Redis manages transient presence/socket state.

This provides:

text chat
delivery status
read receipts
typing indicator
presence
attachments
consultation-linked conversations
server timestamps
billing integration

And critically:

chat billing remains server-authoritative.

You can abstract the chat provider so Stream/Sendbird/etc. can be introduced later without rewriting consultation logic.

Part IX — Voice and Video Architecture

Do not build raw WebRTC infrastructure yourself initially.

Create:

RealtimeProvider

createSession()
generateCustomerToken()
generateAstrologerToken()
endSession()
getUsage()
getRecording()
verifyWebhook()

Then implement:

AgoraRealtimeProvider

or:

HundredMsRealtimeProvider

This prevents Stella from becoming permanently locked to one company.

Twilio becomes more attractive if later you need PSTN/ordinary telephone-number calling.

For pure app-to-app consultation, Agora/100ms-style RTC is a better architectural fit.

Phone numbers therefore never need to be revealed to either party.

Part X — Consultation State Machine

Consultations should not simply have:

status = active

Use an explicit state machine.

REQUESTED
   ↓
MATCHING
   ↓
OFFERED
   ↓
ACCEPTED
   ↓
FUNDS_HELD
   ↓
CONNECTING
   ↓
ACTIVE
   ↓
ENDING
   ↓
COMPLETED
   ↓
RECONCILED
   ↓
SETTLED

Exceptional states:

REJECTED
EXPIRED
CANCELLED_CUSTOMER
CANCELLED_ASTROLOGER
FAILED_CONNECTION
DISPUTED
REFUNDED

Every transition generates an event.

This makes billing, debugging and disputes dramatically safer.

Part XI — Wallet and Financial Architecture

This is one of Stella's most critical systems.

Your existing specification correctly rejects a simple users.balance architecture and instead requires Wallet + Ledger + Transaction + Settlement, atomic transactions, idempotency and immutable financial history.

Keep this unchanged.

Example:

Customer recharges ₹1,000.

PAYMENT_CAPTURED
      ↓
LEDGER CREDIT ₹1,000
      ↓
AVAILABLE ₹1,000

Customer begins consultation costing ₹20/minute.

Stella may hold an authorized amount:

AVAILABLE ₹1,000
HELD      ₹300

Suppose actual usage is ₹184.

HOLD ₹300
    ↓
DEBIT ₹184
    ↓
RELEASE ₹116

The customer never loses money merely because ₹300 was reserved.

Fundamental rule

The mobile application must never determine:

final call duration
wallet balance
charge amount
refund
commission
payout

The server does.

Your original specification explicitly makes this principle mandatory.

Part XII — Razorpay Architecture

Flow:

Customer
   ↓
Stella Backend creates order
   ↓
Razorpay
   ↓
Customer completes payment
   ↓
Razorpay webhook
   ↓
Signature verification
   ↓
Idempotency verification
   ↓
Payment event
   ↓
Ledger credit

Never:

Mobile says "payment successful"
→ credit wallet

The existing specification already explicitly prohibits trusting client-declared payment success.

Part XIII — Astrologer Application

The astrologer's home screen should be operational rather than decorative.

At the top:

ONLINE | BUSY | OFFLINE

Then:

Incoming Requests
Current Consultation
Upcoming Appointments
Today's Earnings
Pending Earnings
Withdrawable Balance
Ratings
Performance

Your current specification already captures acceptance rate, response rate, cancellation rate and customer retention.

I would additionally show:

Average consultation duration
Repeat-customer percentage
Connection failure percentage

Astrologers should never see customer telephone numbers.

Part XIV — Astrology Engine

The astrology engine must be treated as a deterministic scientific/calculation component, separate from generative AI.

Birth Data
   ↓
Geocoding / Coordinates
   ↓
Timezone Resolution
   ↓
Ephemeris
   ↓
Calculation Engine
   ↓
Structured Astrology JSON
   ↓
Interpretation Layer

The structured calculation output may contain:

planet positions
houses
Nakshatras
Rashi
Dasha
divisional charts
Doshas
Ashtakoota results
transits

Then AI may interpret that data.

AI must never invent the planetary calculation.

That requirement is already explicit in the master plan.

Part XV — AI Architecture

Create a provider-neutral AI gateway.

Stella Application
       ↓
AI Orchestrator
       ↓
Safety / Privacy Layer
       ↓
Context Builder
       ↓
Provider Adapter
       ↓
OpenAI / Anthropic / Gemini / future model

AI jobs could include:

Kundli explanation
report drafting
horoscope personalization
astrologer matching assistance
consultation summary, with appropriate consent
support assistant
content drafting
fraud signal analysis

But AI is not an astrologer.

The master specification already establishes these restrictions and prohibits AI from making dangerous medical/legal/financial certainty claims or fabricating calculations/history.

Part XVI — New: Event-Driven Business Audit Trail

This is one of the additions I specifically recommend.

Every important business operation should produce a domain event.

Examples:

USER_REGISTERED
ASTROLOGER_APPLIED
KYC_SUBMITTED
KYC_APPROVED

CONSULTATION_REQUESTED
CONSULTATION_ACCEPTED
CONSULTATION_STARTED
CONSULTATION_PAUSED
CONSULTATION_RESUMED
CONSULTATION_COMPLETED

PAYMENT_CREATED
PAYMENT_CAPTURED
PAYMENT_FAILED

WALLET_CREDITED
WALLET_HELD
WALLET_DEBITED
WALLET_RELEASED

REFUND_CREATED
COMMISSION_CALCULATED
PAYOUT_REQUESTED
PAYOUT_COMPLETED

ADMIN_OVERRIDE
SECURITY_ALERT

Architecture:

Business Operation
       ↓
Database Transaction
       ↓
Domain Event / Outbox
       ↓
RabbitMQ
       ↓
 ┌─────┼─────────┬─────────┐
 ↓     ↓         ↓         ↓
Audit Analytics Notify   Fraud

Use a transactional outbox pattern for important events so database state and event publishing cannot silently diverge.

This is stronger than ordinary log files.

Part XVII — New: Trust, Risk & Fraud Engine

This deserves its own domain.

TRUST & RISK
│
├── Account risk
├── Payment risk
├── Consultation abuse
├── Astrologer behavior
├── Review manipulation
├── Referral abuse
├── Device abuse
└── Administrative anomalies

Potential signals:

multiple accounts from suspicious device patterns
repeated refund behavior
rapid wallet recharge/refund cycles
fake consultations
astrologer/customer collusion
self-generated reviews
referral farming
abnormally high cancellation behavior
unusual payout changes
repeated OTP attacks
credential stuffing
impossible session patterns

Important principle

The system should generally:

DETECT → SCORE → FLAG → REVIEW

rather than:

AI DETECTS → ACCOUNT AUTOMATICALLY BANNED

Your original plan already takes this philosophy for astrologers and suspicious reviews: flag and escalate rather than automatically punish.

Extend that philosophy across Stella.

Part XVIII — New: Operational Observability

Sentry alone isn't enough.

Stella needs three observability categories.

Application health

Track:

API request count
p50/p95/p99 latency
HTTP 4xx/5xx
DB query latency
Redis latency
queue backlog
worker failures
CPU
RAM
disk
database connections

Consultation health

Track:

consultation requests
acceptance rate
connection success
time-to-connect
call drop rate
reconnect success
average duration
provider errors
token-generation failures
billing reconciliation mismatch

Financial health

Track:

payment success rate
webhook failures
wallet reconciliation differences
refund rate
payout failures
ledger mismatch
recharge success rate

These should appear in the Technical Admin dashboard.

For example:

SYSTEM HEALTH
────────────────────────────
API availability       99.98%
p95 API latency         184ms
DB latency               21ms
Queue backlog               3

CONSULTATION HEALTH
────────────────────────────
Active calls                38
Connection success       98.7%
Call failure              1.3%
Reconnect success        94.2%

PAYMENTS
────────────────────────────
Success                  97.8%
Webhook failures             2
Reconciliation issues        0

Those numbers are illustrative UI examples only—not Stella production statistics.

Part XIX — Privacy Architecture

Astrology applications hold unusually personal information:

birth date
birth time
birthplace
relationship concerns
family information
consultation conversations

So privacy must be architectural, not merely a Privacy Policy page.

Your specification already requires consent tracking, recording consent, AI consent, location consent, export and deletion workflows.

Add explicit data classifications:

PUBLIC
INTERNAL
CONFIDENTIAL
HIGHLY SENSITIVE
FINANCIAL
KYC

Consultation content should be HIGHLY SENSITIVE.

KYC should be KYC/RESTRICTED.

Support personnel should not automatically be able to listen to recordings simply because they work for Stella.

Part XX — Call Recording

Recording must be configurable.

Before recording:

Customer consent
+
Astrologer consent
+
Policy/legal eligibility

Then:

Realtime Provider
       ↓
Encrypted recording
       ↓
Private object storage
       ↓
Access-controlled metadata

Never create publicly accessible recording URLs.

Every playback by authorized operational staff should itself create an audit event.

Part XXI — Admin Command Center

I would organize Admin into six major workspaces rather than exposing dozens of unrelated menu entries.

Operations

Live consultations
customers
astrologers
appointments
support

Finance

payments
wallet
ledger
refunds
commission
settlements
payouts
reconciliation

Trust & Compliance

KYC
fraud flags
disputes
reviews
security incidents
audit

Content

horoscope
Panchang
articles
Pooja
promotions
notifications

Analytics

customers
conversion
consultation
astrologers
revenue
retention

Platform

system health
API health
realtime provider
queues
jobs
feature flags
AI usage
security

That will make the already extensive Admin Command Center much easier to operate.

Part XXII — Notification Architecture

Create a common notification service.

Business Event
      ↓
Notification Orchestrator
      ↓
Preference Check
      ↓
Template
      ↓
 ┌────┼─────┬─────┐
Push Email SMS WhatsApp

Channels can include:

FCM
email provider
SMS provider
WhatsApp Business Platform

The existing specification already defines push/email/SMS/WhatsApp and event-driven notification scenarios.

Part XXIII — Database Strategy

I recommend keeping MySQL.

There is no compelling reason for you to move to PostgreSQL merely because Node.js is introduced.

Your master specification is already designed around MySQL and strong module boundaries.

For your requirements, MySQL 8 is perfectly capable.

Important principles:

foreign keys
explicit indexes
migrations
UTC timestamps internally
soft deletion only where justified
immutable ledger entries
UUID/ULID public identifiers
strict financial transaction isolation
idempotency keys

Do not switch databases simply for fashion.

Part XXIV — Repository Architecture

I recommend the new repository become approximately:

stella/
│
├── apps/
│   ├── customer-web/
│   ├── admin-web/
│   ├── customer-mobile/
│   └── astrologer-mobile/
│
├── services/
│   ├── api/
│   ├── astrology-engine/
│   └── workers/
│
├── packages/
│   ├── api-contracts/
│   ├── shared-types/
│   ├── validation/
│   ├── design-system/
│   ├── config/
│   └── utilities/
│
├── infrastructure/
│   ├── docker/
│   ├── nginx/
│   ├── mysql/
│   ├── redis/
│   ├── rabbitmq/
│   └── deployment/
│
├── docs/
│   ├── architecture/
│   ├── database/
│   ├── api/
│   ├── security/
│   ├── payments/
│   ├── astrology/
│   ├── operations/
│   └── product/
│
├── CLAUDE.md
├── AGENTS.md
└── README.md

But—as your source document correctly says—do not blindly overwrite the existing repository.

Phase 0 determines how much of this structure should actually be adopted.

Part XXV — Infrastructure

For V1:

                CLOUDFLARE
                    │
                  NGINX
                    │
          ┌─────────┴─────────┐
          │                   │
       NEXT.JS              NESTJS
                              │
                 ┌────────────┼───────────┐
                 │            │           │
               MySQL        Redis     RabbitMQ
                                           │
                                        Workers

External:
Firebase
Razorpay
S3
Realtime provider
Email/SMS/WhatsApp
AI providers

A good VPS can host the application initially.

Media traffic should not flow through your VPS. Your realtime provider handles that.

This aligns with the original target architecture, which deliberately avoids Kubernetes/multi-region overengineering at V1.

Part XXVI — Environment Strategy

You need three isolated environments:

Development

AI agents can work aggressively here.

Staging

Production-like integration testing.

Production

Highly controlled.

Separate:

databases
Firebase configuration
Razorpay keys
realtime keys
S3 buckets
AI credentials
webhooks
domains

Never let Claude Code receive authority to autonomously deploy arbitrary changes to production.

Part XXVII — Security Architecture

Security boundaries:

INTERNET
   │
Cloudflare
   │
Nginx
   │
Authentication
   │
Authorization
   │
Application
   │
Domain permissions
   │
Database

Critical controls:

MFA for admins
RBAC
rate limiting
Firebase token verification
session revocation
device management
input validation
secure uploads
private S3
encrypted backups
secret management
audit trails
financial immutability
re-authentication for sensitive actions

These principles are already well represented in your master document.

Part XXVIII — API Architecture

Use:

/api/v1/

REST initially.

Examples:

/api/v1/auth
/api/v1/users
/api/v1/astrologers
/api/v1/kundli
/api/v1/astrology
/api/v1/consultations
/api/v1/chat
/api/v1/realtime
/api/v1/wallet
/api/v1/payments
/api/v1/reports
/api/v1/notifications
/api/v1/admin

Use OpenAPI contracts.

With NestJS, generate Swagger/OpenAPI documentation directly from the application contracts.

Mobile and web should never access MySQL directly.

Part XXIX — Design Architecture

Preserve Stella's visual DNA:

Midnight Navy + Sapphire + Antique Gold + Ivory + Sky Blue

and the existing Stella monogram.

The design should communicate:

Premium + Trusted + Spiritual + Modern + Technological

exactly as specified in the source.

But the three products need different emphasis.

Customer:

emotional + spiritual + premium

Astrologer:

professional + operational

Admin:

data-dense + analytical

Do not make the Admin dashboard look like a horoscope website.

Part XXX — Development Strategy

The existing document's vertical-slice approach is exactly right.

Do not say:

Claude, build the backend.

Instead:

FEATURE: Astrologer onboarding

1. Database migration
2. Domain model
3. API
4. Validation
5. KYC upload
6. Astrologer UI
7. Admin approval UI
8. Permissions
9. Audit events
10. Tests
11. Documentation

Finish that feature completely.

Then move forward.

Part XXXI — Revised Implementation Roadmap

I recommend reorganizing the existing 23 phases slightly so that financial correctness and observability arrive earlier.

Phase 0 — Repository Audit

No feature coding.

Deliver:

REPOSITORY_AUDIT.md
CURRENT_ARCHITECTURE.md
TARGET_ARCHITECTURE.md
GAP_ANALYSIS.md
DECISION_LOG.md
IMPLEMENTATION_PLAN.md

Your original specification already mandates repository inspection before major implementation.

Phase 1 — Engineering Foundation

Monorepo
Next.js
NestJS
React Native
MySQL
Redis
RabbitMQ
Docker
CI/CD
environments
logging
configuration

Phase 2 — Identity

Firebase Auth
customer registration
astrologer identity
admin identity
sessions
devices
RBAC
MFA

Phase 3 — Customer Profiles

customer profile
birth profile
family profiles
consent
preferences

Phase 4 — Astrologer Onboarding

application
profile
KYC
expertise
languages
pricing
availability
admin verification

Phase 5 — Astrology Foundation

astrology engine
reference charts
Kundli
engine versioning
reproducibility

Phase 6 — Discovery & Matching

search
filters
ranking
availability
matching engine

Phase 7 — Consultation Core

state machine
requests
accept/reject
scheduled consultation
session lifecycle

Phase 8 — Wallet & Ledger

ledger
wallet
hold/release
idempotency
concurrency
reconciliation

Phase 9 — Payment

Razorpay
recharge
webhooks
refunds
reconciliation

Phase 10 — Chat

WebSockets
messages
presence
receipts
FCM
chat billing

Phase 11 — Voice

RTC abstraction
Agora/100ms implementation
tokens
duration reconciliation
wallet integration

Phase 12 — Video

Video consultation
network recovery
recording where enabled

Phase 13 — Commission & Payout

commission rules
earnings
settlement
withdrawal
payout

Phase 14 — Reports

report engine
PDF generation
report vault

Phase 15 — Astrology Services

Horoscope
Panchang
Muhurta
Kundli Matching
Varshaphal

Phase 16 — Additional Services

Tarot
Numerology
Vastu
Pooja

Phase 17 — AI

AI gateway
interpretation
reports
support
matching assistance

Phase 18 — Content & Engagement

CMS
notifications
promotions
referrals
rewards

Phase 19 — Trust & Safety

fraud engine
risk scoring
review abuse
account risk
payment risk
investigation tools

Phase 20 — Admin Command Center

operations
finance
trust
content
analytics
technical administration

Phase 21 — Observability

metrics
dashboards
alerts
API performance
RTC quality
financial monitoring

Phase 22 — Security Hardening

penetration testing
permissions review
secret audit
dependency scanning
financial attack scenarios

Phase 23 — Performance

load tests
concurrency
database tuning
queue tests
consultation simulations

Phase 24 — Controlled Beta

Initially:

50–100 customers
10–20 astrologers

Measure actual behavior.

Phase 25 — Production Rollout

Gradually increase traffic and astrologer onboarding.

Part XXXII — Claude Code + Codex Development Governance

For this project I recommend:

YOU
 │
 ├──── ChatGPT → Architecture / specifications /
 │               debugging / design / review
 │
 ├──── Claude Code → Primary repository implementation
 │
 └──── Codex → Independent code review /
               implementation / test verification

Your existing master document already defines Claude Code repository rules and requires Codex cross-review rather than blindly accepting either agent when they disagree.

That is an excellent policy.

For protected areas:

Wallet
Ledger
Payment
Authentication
KYC
Astrology calculations
Payouts
Database migrations

require a stronger review gate.

Part XXXIII — Architecture Decision Records

Every significant technical decision should create an ADR.

Example:

ADR-001
Use NestJS as Stella's primary backend

STATUS:
Proposed

CONTEXT:
Existing architecture proposed FastAPI.

DECISION:
Use NestJS/TypeScript for primary business services.

RATIONALE:
Shared language across web/mobile/backend,
strong modular architecture,
good realtime support,
reduced technology fragmentation.

CONSEQUENCES:
Python remains available for specialized
astrology/AI computation services.

This prevents Claude Code—or any future developer—from later wondering:

Why did they choose NestJS?

Part XXXIV — What Should NOT Be Built in V1

This is important.

Do not initially build:

Kubernetes
microservices everywhere
your own WebRTC infrastructure
complex loyalty economy
physical Pooja marketplace
Prasad logistics
advanced Numerology ecosystem
sponsored astrologer ranking
multi-region infrastructure
custom SMS infrastructure
custom payment gateway
custom authentication server

The existing specification already intentionally restricts several of these areas, including microservices, loyalty complexity, Pooja logistics and Kubernetes.

Focus engineering effort on the thing Stella must do exceptionally well:

Find a suitable astrologer, connect the customer reliably, bill accurately, protect both parties, and settle the astrologer's earnings correctly.

Part XXXV — V1 Definition

I would call Stella V1 successful when a customer can:

Register
   ↓
Create birth profile
   ↓
Generate Kundli
   ↓
Discover astrologer
   ↓
Recharge wallet
   ↓
Request consultation
   ↓
Astrologer accepts
   ↓
Chat / Call
   ↓
Correct real-time billing
   ↓
Complete consultation
   ↓
Receive history/report
   ↓
Rate astrologer

and simultaneously the astrologer can:

Register
 ↓
KYC
 ↓
Approval
 ↓
Set expertise/pricing
 ↓
Go online
 ↓
Receive customer
 ↓
Consult
 ↓
See earnings
 ↓
Receive settlement

and Stella Admin can oversee the entire journey.