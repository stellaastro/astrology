# Cloudflare R2 — bucket layout

**Status:** in force · **Adopted:** 2026-09-15 (ADR-042) · Supplements ADR-014,
ADR-032 and ADR-036.

Every bucket is **private**. R2 buckets are not public by default and none of
these has public access enabled — verified by an unauthenticated request to the
S3 endpoint, which returns `InvalidArgument / Authorization` and no data.
Objects are reached with signed requests only (CLAUDE.md, Storage).

| Bucket | Holds | Written by | Status |
|---|---|---|---|
| `stella-kyc` | **Customer and astrologer KYC documents.** Nothing else | The API, Phase 9+ | Created, empty |
| `stella-kyc-dev` | **Synthetic** KYC only — every file visibly marked `SAMPLE / NOT VALID` (ADR-036) | Dev seeds | Created, empty |
| `stella-backups` | Nightly MySQL dumps, binlogs, the encrypted secrets archive | `infrastructure/backup/backup.sh` | **In use** |
| `stellaastro` | Nothing. Pre-existing, empty | — | Unused — see below |

## KYC is isolated, and this is the point

KYC documents are the most sensitive data this project will ever hold:
government identity documents belonging to real people. They get **their own
bucket**, and the separation is structural rather than a naming convention:

- **A token scoped to `stella-kyc` cannot read backups, and the backup token
  cannot read KYC.** That is the whole reason they are separate buckets rather
  than two prefixes in one bucket. Prefixes share a blast radius; buckets do
  not.
- **Synthetic KYC never shares a bucket with real KYC.** ADR-036 requires a
  separate dev bucket, explicitly "not `stella-backups`". A fixture identity
  document sitting next to a real one is how a fixture gets served as real.
- **Backups do not sweep up KYC.** `backup.sh` backs up MySQL, binlogs and the
  secrets directory. It does not copy R2 objects, so a KYC document cannot end
  up inside a backup archive that has a different retention and a different
  set of readers.

## The backup bucket is not an exception to "R2 is for KYC"

Backups live on R2 because ADR-032 put them there, and that decision predates
and is independent of KYC. The two uses share a provider and share nothing
else: different buckets, different lifecycles, and ideally different tokens.

Removing backups from R2 without naming a replacement destination would leave
the project with **no offsite backup at all**, which is the single largest
unmitigated risk the plan identified (three source documents, 23 ADRs, and no
backup existed until task 1.4).

## Tokens — the standing gap

Both R2 tokens currently in `config.txt` are **admin-level**: each can list,
create and delete buckets. Proven by the fact that either can call
`ListBuckets`, which an `Object Read & Write` token cannot.

That means the nightly backup cron holds a credential that could delete the
bucket it writes to, and — once KYC exists — could read KYC documents.

**What it should be**, before any real KYC document is stored:

| Consumer | Token | Scope |
|---|---|---|
| `backup.sh` | Object Read & Write | `stella-backups` only |
| The API (Phase 9+) | Object Read & Write | `stella-kyc` only |
| Dev seeds | Object Read & Write | `stella-kyc-dev` only |

Scoping is done when creating the token in the Cloudflare dashboard: R2 → API →
Manage API Tokens → *Object Read & Write*, then select the buckets. This is an
owner action; it cannot be done from the server.

## `stellaastro` — the empty bucket

Pre-existing, empty, and referenced by nothing. An unexplained bucket is where
things end up by accident, so it is recorded here as unused. Delete it or give
it a documented purpose; do not let it become the default destination for
whatever comes next.
