# Doral Academy Library — Setup Guide

A single-file library web app. White + red, clean animations. Students browse the
catalog and track their own borrowing; only the librarian (admin) can check books
in and out. Backend is Firebase (free tier).

The site runs in **Demo Mode** out of the box (sample data, in-memory) so you can
click around immediately. Add your Firebase config to make it live.

---

## 1. Create a Firebase project (free)

1. Go to https://console.firebase.google.com → **Add project**.
2. Once created, click the **Web** icon (`</>`) to register a web app.
3. Copy the `firebaseConfig` object it gives you.

## 2. Plug in your config

Open `index.html`, find the block marked:

```js
/* ===== 1. PASTE YOUR FIREBASE CONFIG HERE ===== */
const firebaseConfig = { ... };
```

Replace the placeholder values with the ones from your Firebase project.
That's the only code change required — the app auto-switches out of Demo Mode.

## 3. Enable Authentication

In the Firebase console → **Build → Authentication → Get started**:

- Enable **Email/Password** (required — student IDs and admin logins use this).
- (Optional) Enable **Google** if you want the "Continue with Google" button to work.
  - Students who use Google must still enter their **Student ID + full name** the
    first time, which the app prompts for automatically.

> **How Student IDs work:** Firebase Auth needs an email, so a student with ID
> `1234567` is stored internally as `1234567@students.dorallibrary.app`. Students
> never see this — they just type their Student ID. You can change the domain in
> `index.html` via the `STUDENT_DOMAIN` constant.

## 4. Create the Firestore database

- Console → **Build → Firestore Database → Create database** (Production mode).
- Go to the **Rules** tab, paste the contents of `firestore.rules`, and **Publish**.

## 5. Seed the first librarian (admin)

Admins can't be self-created (the rules block it on purpose). To make one:

1. In **Authentication → Users → Add user**, create an account with the
   librarian's email + a password (e.g. `librarian@school.org`).
2. Copy that user's **UID**.
3. In **Firestore → Start collection** `users`, add a document whose **ID is that UID**, with fields:
   - `role` (string) = `admin`
   - `name` (string) = e.g. `Ms. Rivera`
   - `email` (string) = the librarian's email
4. Done. That person logs in via the **Librarian** tab using their email + password.

To add more librarians later, repeat, or just change a user's `role` field to `admin`.

## 6. Deploy to GitHub Pages

1. Create a GitHub repo and upload `index.html` (rename to `index.html` at the repo root).
2. Repo **Settings → Pages → Source: Deploy from branch**, pick `main` / root.
3. Your site goes live at `https://<username>.github.io/<repo>/`.

No build step, no framework, no basePath issues — it's a single static file.

---

## Data model (Firestore)

**`books/{id}`**
| field | meaning |
|---|---|
| `title` | book name |
| `author` | author |
| `isbn` | ISBN |
| `state` | `"in library"` or `"checked out"` |
| `holderSid` / `holderName` | current borrower (blank when available) |
| `lastCheckout` | last checked-out date |

**`history/{id}`** — one row per checkout/return event:
`action` (`checked out` / `returned`), `bookTitle`, `bookIsbn`, `sid`, `name`, `date`.

**`users/{uid}`** — `role` (`student`/`admin`), `sid`, `name`, `email`.

## Who can do what
- **Students:** browse catalog, view availability, see *their own* checkouts/returns with dates. Cannot check books out.
- **Librarian (admin):** add/edit/delete books, check out, return, and view all activity.
