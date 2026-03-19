# Agent Management: Complete Implementation Guide

A detailed, actionable playbook for each of the 5 core skills. Every section includes what to do, how to do it, ready-to-use templates, and how to iterate over time.

---

## Skill 1: Save Points (Version Control with Git)

### What You're Actually Doing

Git takes a snapshot of every file in your project and stores it permanently. You can jump back to any snapshot at any time. Think of it as an unlimited undo history that your agent can never erase.

### Setup (One Time, ~15 Minutes)

**Step 1 — Install Git.** It's likely already on your computer. Open a terminal (or ask your agent) and type `git --version`. If you see a version number, you're set. If not, download it from git-scm.com.

**Step 2 — Initialize your project.** Navigate to your project folder in the terminal and run:

```
git init
```

That's it. Your project now has version control.

**Step 3 — Create a `.gitignore` file.** This tells Git to skip files that shouldn't be saved — secrets, temporary files, massive dependency folders. Ask your agent: *"Create a .gitignore file appropriate for this project's tech stack."* Every agent knows how to do this well.

**Step 4 — Make your first save point.**

```
git add .
git commit -m "Initial working version"
```

`git add .` stages everything. `git commit -m "message"` saves the snapshot with a label.

### The 6 Commands You Actually Need

| Command | What It Does | When to Use It |
|---|---|---|
| `git add .` | Stages all changed files for the next save | Before every commit |
| `git commit -m "description"` | Creates the save point with a label | Every time something works |
| `git log --oneline` | Shows your save point history | When you need to find a previous version |
| `git diff` | Shows what changed since the last save | Before committing, to review what the agent did |
| `git checkout <commit-hash> -- .` | Restores your project to a specific save point | When you need to go back |
| `git branch <name>` / `git checkout <name>` | Creates a parallel timeline for experiments | Before risky changes |

### The Workflow to Practice

Use this rhythm every time you work with an agent:

1. **Verify your project works** — load it, click around, confirm things are functional
2. **Commit** — `git add .` then `git commit -m "working: description of current state"`
3. **Give the agent its next task** — one focused task (see Skill 4)
4. **Review what happened** — `git diff` to see every file the agent touched
5. **Test it** — does the app still work? Does the new thing work?
6. **If yes → commit again.** If no → `git checkout .` to revert everything the agent just did, and try a different approach

### Branching for Risky Experiments

When you're about to try something that might break things:

```
git checkout -b experiment-new-checkout-flow
```

This creates a separate timeline. If the experiment works, merge it back:

```
git checkout main
git merge experiment-new-checkout-flow
```

If it fails, just abandon it:

```
git checkout main
git branch -d experiment-new-checkout-flow
```

Your main project was never touched.

### How to Iterate This Skill

**Week 1:** Just commit after every working change. Get the muscle memory of `git add . && git commit -m "message"`.

**Week 2:** Start using `git diff` before committing to review what the agent changed. You'll start noticing patterns — files you didn't expect it to touch, things it deleted that it shouldn't have.

**Week 3:** Start branching before medium or large tasks. This gives you a safety net for anything non-trivial.

**Week 4+:** You can ask your agent to commit for you with meaningful messages. Many agents (Claude Code, Cursor) can run git commands directly. Just tell them: *"Commit the current state with a descriptive message before starting the next task."*

### Recovery Cheat Sheet

| Situation | Command |
|---|---|
| Agent just broke something, haven't committed yet | `git checkout .` (reverts all uncommitted changes) |
| Need to go back to a specific save point | `git log --oneline` → find the hash → `git checkout <hash> -- .` |
| Everything is a mess, go back to last commit | `git reset --hard HEAD` (nuclear option — erases all uncommitted work) |
| Want to see what the agent changed | `git diff` (before committing) or `git diff HEAD~1` (after committing) |

---

## Skill 2: Know When to Start Fresh

### Recognizing Context Degradation

Your agent's context window is like a whiteboard with limited space. Early instructions get erased as new content fills the board. Here are the concrete warning signs:

- The agent repeats a mistake you corrected 10+ messages ago
- It "forgets" architectural decisions and re-proposes alternatives you already rejected
- It starts rewriting files it already completed successfully
- Its responses get shorter, less detailed, or more generic
- It contradicts its own earlier work without acknowledging the change

When you see two or more of these signs, the context is degraded. Continuing will waste time and likely introduce bugs.

### The Simple Fix: Start Fresh with a Handoff Message

Don't just open a new chat and start from scratch. Write a **handoff message** — a summary that gives the new session everything it needs. Here's a template:

```
I'm continuing a project. Here's where we are:

PROJECT: [one-line description]
TECH STACK: [languages, frameworks, database]
WHAT'S DONE: [list of completed features/tasks]
WHAT'S NEXT: [the specific task to work on now]
KEY DECISIONS ALREADY MADE:
- [decision 1 and why]
- [decision 2 and why]
KNOWN ISSUES:
- [issue 1]
DO NOT CHANGE: [list any files or features that are working and should not be touched]
```

This takes 5 minutes to write and saves you hours of the agent re-learning your project.

### The Advanced Fix: Scaffold Documents

For projects that take more than one session (most real projects), create these four files in your project root. The agent reads them at startup and updates them as it works.

**File 1: `PLANNING.md`** — The architectural blueprint

```markdown
# Project Plan

## Overview
[2-3 sentences: what this product does and who it's for]

## Tech Stack
- Frontend: [e.g., React, Next.js]
- Backend: [e.g., Node.js, Supabase]
- Database: [e.g., PostgreSQL via Supabase]
- Auth: [e.g., Supabase Auth with Google SSO]
- Payments: [e.g., Stripe Checkout]

## Architecture Decisions
- [Decision]: [Why we chose this]
- [Decision]: [Why we chose this]

## Data Model
- Users: [key fields]
- Orders: [key fields and relationships]
- Products: [key fields]

## Pages / Routes
- /home — landing page
- /dashboard — authenticated user view
- /checkout — payment flow
```

**File 2: `TASKS.md`** — The burndown list

```markdown
# Task List

## Completed
- [x] Set up project scaffolding
- [x] Build user authentication
- [x] Create product listing page

## In Progress
- [ ] Add shopping cart functionality
  - [x] Cart state management
  - [ ] Cart UI component
  - [ ] Add-to-cart from product page

## Upcoming
- [ ] Checkout flow with Stripe
- [ ] Order confirmation emails
- [ ] Admin dashboard

## Known Bugs
- [ ] Product images don't load on mobile Safari
```

**File 3: `CONTEXT.md`** — The "where we left off" briefing

```markdown
# Current Context

## Last Session Summary
[2-3 sentences about what happened in the last session]

## Current State
The app is functional with [these features]. The user can [do these things].
[Feature X] is partially built — the backend is done but the UI is not connected.

## Active Decisions / Open Questions
- Should we use server-side or client-side pagination for the product list?
- The customer asked about adding a wishlist — not yet prioritized.

## Files Recently Modified
- src/components/Cart.jsx — new file, cart UI (in progress)
- src/lib/cartStore.js — cart state management (complete)
- src/pages/Products.jsx — added "Add to Cart" button (complete)
```

**File 4: `WORKFLOW.md`** — The step-by-step log

```markdown
# Workflow Log

## Session 4 — March 16, 2026

### Task: Add shopping cart
Step 1: Created cart state management (cartStore.js) ✅
Step 2: Built Cart UI component — IN PROGRESS
  - Basic layout done
  - Need: quantity adjustment, remove item, price totals
Step 3: Connect "Add to Cart" button on product pages ✅
Step 4: Cart persistence across page refreshes — NOT STARTED
Step 5: Cart → Checkout handoff — NOT STARTED
```

### How to Use These Documents in Practice

**Starting a new session:** Tell your agent: *"Read PLANNING.md, TASKS.md, CONTEXT.md, and WORKFLOW.md before doing anything. These files describe the current state of the project. Update CONTEXT.md with today's session date and begin working on the next incomplete task in TASKS.md."*

**During a session:** Periodically (every 3–4 completed sub-tasks), tell the agent: *"Update TASKS.md and WORKFLOW.md with current progress before continuing."*

**Ending a session:** Tell the agent: *"Update all scaffold documents to reflect where we stopped. Write a summary in CONTEXT.md so the next session can pick up cleanly."*

### How to Iterate This Skill

**Week 1:** Just use the handoff message template when starting new sessions. Copy-paste it, fill in the blanks.

**Week 2:** Create PLANNING.md and TASKS.md. These two alone solve 80% of the "starting from zero" problem.

**Week 3:** Add CONTEXT.md and start asking the agent to update it at the end of sessions.

**Week 4+:** Add WORKFLOW.md for complex multi-step features. Train yourself to recognize context degradation early and restart before the agent makes a mess.

---

## Skill 3: Standing Orders (Rules Files)

### The Starter Template

Create a file called `CLAUDE.md` (for Claude Code), `.cursorrules` (for Cursor), or `AGENTS.md` (universal) in your project root. Here's a production-ready starter:

```markdown
# Project Rules

## Identity
This is [Product Name], a [one-line description].
Built with [tech stack]. Database hosted on [platform].

## Code Style
- Use [language/framework conventions, e.g., "TypeScript with strict mode"]
- File naming: [e.g., "kebab-case for files, PascalCase for components"]
- Always add comments explaining WHY, not WHAT

## Architecture Rules
- All API calls go through [specific directory/pattern]
- Never modify the database schema without updating PLANNING.md first
- Every new page/route must include error handling and loading states

## UI / Design Rules
- Always use dark mode as the default theme
- Use the existing design system components in /src/components/ui/
- Never install a new UI library without asking first
- Mobile-responsive by default — test at 375px width

## Security Rules (Non-Negotiable)
- NEVER log customer emails, passwords, or payment information
- NEVER hardcode API keys or secrets — always use environment variables
- All database queries involving user data must use row-level security
- Authentication checks on every protected route

## Error Handling
- Every API call must have try/catch with user-friendly error messages
- Never show a blank screen on failure — always show a helpful message
- Log errors to the console for debugging but never expose stack traces to users

## Things You Keep Getting Wrong (Fix These)
- STOP defaulting to light mode. The theme is dark.
- STOP creating new utility files. Use the existing ones in /src/lib/
- STOP removing the loading spinner when refactoring components
- When I say "don't change X", that means do not touch that file at all

## Scale Expectations
This app currently serves ~200 users and is expected to grow to ~5,000
within 6 months. Build accordingly — don't over-engineer for millions,
but don't use patterns that break at 1,000 concurrent users.

## Before You Start Any Task
1. Read TASKS.md to understand what's been done
2. Read CONTEXT.md to understand current state
3. Confirm your plan before writing code
4. Make small, testable changes (see: small bets principle)
```

### Building the "Things You Keep Getting Wrong" Section

This is the most valuable section and it grows organically. Here's the process:

1. **Agent makes a mistake** (e.g., installs a new package you didn't want)
2. **You correct it** in the conversation
3. **You add a rule** to prevent it: `"Never install new npm packages without confirming with me first."`
4. **Next session:** the agent reads the rule and doesn't repeat the mistake

Keep a running note (on your phone, a sticky note, wherever) of things that annoy you during agent sessions. At the end of each session, batch-add them to the rules file.

### Rules File Hygiene

**Monthly review:** Read through the entire rules file. For each line, ask:

- Is the agent still making this mistake? If not, the rule may be removable.
- Is this rule clear enough? Could the agent misinterpret it?
- Does this rule conflict with another rule?

**Size targets:**

| Stage | Target Length |
|---|---|
| First week | 15–30 lines |
| First month | 50–80 lines |
| Mature project | 80–150 lines (hard cap at 200) |

**Why the cap matters:** Your rules file is loaded into the agent's context window at the start of every session. A 500-line rules file eats into the space available for actual work. Keep it tight.

### How to Iterate This Skill

**Week 1:** Create the rules file with just the Identity, Code Style, and Security sections from the template above. Even 15 lines is better than nothing.

**Week 2:** Start the "Things You Keep Getting Wrong" section. Add 1–2 entries after each session.

**Week 3:** Add the Architecture and UI/Design sections based on patterns you've noticed.

**Week 4+:** Do your first monthly review. Cut anything the agent has stopped doing wrong. Tighten the language on rules it still occasionally violates. Ask the agent to read the rules file and flag any contradictions.

---

## Skill 4: Small Bets (Controlling Blast Radius)

### The Task Sizing Framework

Before giving your agent any task, run it through this decision tree:

**Question 1: How many files will this touch?**

- 1–3 files → Small. Just do it.
- 4–8 files → Medium. Plan first, execute in stages.
- 9+ files → Large. Decompose into multiple medium tasks.

**Question 2: Does this change the database?**

- No → Lower risk.
- Yes, adding new tables/columns → Medium risk. Commit before and after.
- Yes, modifying existing tables/columns → High risk. Branch first, test thoroughly.

**Question 3: Could this break existing features?**

- No, it's additive (new page, new component) → Lower risk.
- Maybe, it modifies shared code (utilities, auth, navigation) → Medium risk.
- Yes, it refactors core systems (database schema, auth flow, payment) → High risk. Decompose.

### Decomposition in Practice

Here's a real example. Say you want to add a "customer reviews" feature to your product.

**Bad approach (one giant task):**
*"Add a customer reviews feature to the product."*

The agent will try to do everything at once — database tables, API routes, UI components, form validation, star ratings, review moderation — and if one piece breaks, the cascading failures are hard to untangle.

**Good approach (decomposed into small bets):**

```
Task 1: Create the reviews database table
  - Fields: id, user_id, product_id, rating, text, created_at
  - Add row-level security: users can only edit/delete their own reviews
  → Test: verify table exists, RLS works
  → Commit

Task 2: Build the API route for submitting a review
  - POST /api/reviews with validation
  - Require authentication
  → Test: submit a review via API, verify it's in the database
  → Commit

Task 3: Build the review submission form UI
  - Star rating selector
  - Text input with character limit
  - Submit button with loading state
  - Error handling for failed submissions
  → Test: submit a review through the UI, verify it appears in database
  → Commit

Task 4: Build the review display component
  - Show reviews on the product page
  - Sort by most recent
  - Show average rating
  → Test: verify reviews display correctly, average rating is accurate
  → Commit

Task 5: Add review editing and deletion
  - Users can only edit/delete their own reviews
  - Confirmation dialog before delete
  → Test: edit and delete a review, verify other users' reviews are untouchable
  → Commit
```

Each task is small enough that if it fails, you revert one commit and lose 15 minutes of work instead of 3 hours.

### The Commit-Test-Continue Rhythm

This is the actual workflow to internalize:

```
┌─────────────┐
│  Give agent  │
│  one focused │
│    task      │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Agent works  │
│  on task     │
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌──────────────┐
│ Review with  │────▶│  Task broke   │
│  git diff    │ NO  │  something?  │
│ Does it look │     │  Revert with │
│   right?     │     │ git checkout │
└──────┬──────┘     └──────────────┘
       │ YES
       ▼
┌─────────────┐     ┌──────────────┐
│ Test it.     │────▶│  Fix is small │
│ Does it      │ NO  │  enough?     │
│ actually     │     │  Fix → Test  │
│ work?        │     │  Otherwise   │
└──────┬──────┘     │  revert.     │
       │ YES        └──────────────┘
       ▼
┌─────────────┐
│  Commit.     │
│  Move to     │
│  next task.  │
└─────────────┘
```

### How to Ask Your Agent to Decompose

You don't have to do the decomposition yourself. Use these prompts:

**For planning:**
*"I want to add [feature]. Before writing any code, break this down into the smallest possible independent tasks. Each task should touch as few files as possible and be testable on its own. Present the plan and wait for my approval before starting."*

**For execution:**
*"Work on Task 1 only. Do not start Task 2 until I confirm Task 1 is working. After completing Task 1, tell me what to test."*

**For mid-build check-ins:**
*"Before continuing, show me which files you've modified and summarize the changes. I want to review before you move on."*

### How to Iterate This Skill

**Week 1:** Just practice asking "how big is this?" before every task. If it feels big, tell the agent to plan it out first.

**Week 2:** Start using the commit-test-continue rhythm. One task → test → commit → next task.

**Week 3:** Practice decomposition. Take a medium feature and break it down into 3–5 sub-tasks before the agent starts.

**Week 4+:** You'll start to develop intuition for what's "too big." The boundary shifts as you get more comfortable with your tools. Tasks that felt large in week 1 may feel medium by week 4 because you have better save points and scaffold docs.

---

## Skill 5: Ask the Questions Your Agent Won't

### Category 1: Error Handling

Your agent builds for the "happy path" — everything works, the network is fast, the user does exactly what's expected. Real users will hit every edge case imaginable.

**The instruction to add to your rules file:**

```
## Error Handling Requirements
Every function that calls an API, reads from the database, or processes
user input MUST include error handling with the following:
1. A try/catch block (or equivalent)
2. A user-facing error message that is helpful and non-technical
3. A console log of the actual error for debugging
4. A fallback state so the UI never goes blank

Example good error message: "We couldn't load your orders right now. Please try again in a moment."
Example bad error message: "Error: 500 Internal Server Error" or a blank screen.
```

**Prompt to retrofit error handling on an existing project:**

*"Review every file that makes an API call or database query. For each one, verify there's proper error handling with a user-friendly message. If any are missing, add them. Show me a summary of what you found and what you fixed."*

**How to test error handling:** Turn off your Wi-Fi and use your app. Everything that breaks without an explanation is a place you need error handling.

### Category 2: Data Security

**The checklist — go through this with your agent:**

**Row-level security (RLS):**

Prompt your agent: *"For every database table that contains user-specific data, implement row-level security so that each user can only read, update, and delete their own rows. Show me the policies you created."*

This is a specific database feature (available in Supabase, PostgreSQL, etc.) that prevents User A from ever seeing User B's data, even if there's a bug in your app code.

**Environment variables for secrets:**

Your project should have a file called `.env` (or `.env.local`) that stores your secret keys. This file should be in your `.gitignore` so it never gets committed to version control.

```
# .env (NEVER commit this file)
STRIPE_SECRET_KEY=sk_live_abc123...
DATABASE_URL=postgresql://...
SUPABASE_SERVICE_KEY=eyJ...
```

Your code references these as `process.env.STRIPE_SECRET_KEY` (in Node.js) or the equivalent in your framework. The actual values never appear in your code.

**Prompt your agent:** *"Audit the entire codebase for hardcoded secrets, API keys, or credentials. Replace any you find with environment variable references. Verify that .env is in .gitignore."*

**The rules file additions for security:**

```
## Security (Non-Negotiable)
- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER log personally identifiable information (emails, names, addresses)
- NEVER log payment information (card numbers, tokens, amounts with user IDs)
- NEVER store passwords in plain text — always use bcrypt or equivalent
- All user-specific database queries must use row-level security
- Authentication must be checked on EVERY protected API route, not just the frontend
```

### Category 3: Scale Expectations

**The conversation to have with your agent:**

Early in your project (ideally when setting up the database and API), tell your agent:

*"This app currently has [X] users and I expect it to grow to [Y] users within [timeframe]. Based on this, what architectural decisions should we make now to avoid painful migrations later? Explain the tradeoffs in plain language."*

Common things the agent might suggest based on scale:

| Scale | Typical Recommendations |
|---|---|
| 1–100 users | Simple setup is fine. SQLite or basic Supabase. Don't over-engineer. |
| 100–1,000 users | Proper database indexing, connection pooling, basic caching |
| 1,000–10,000 users | Database query optimization, CDN for static assets, rate limiting on APIs |
| 10,000+ users | Load balancing, database read replicas, job queues for heavy operations |

**Prompt for a scale audit:**

*"Review the current architecture with the expectation that we'll have [X] concurrent users within [timeframe]. Identify the top 3 things most likely to break at that scale and propose solutions. Don't implement anything yet — just present the analysis."*

### Category 4: The "Real Users" Stress Test

Ask your agent to think like a hostile or careless user. This prompt is surprisingly effective:

*"Pretend you're a user who doesn't read instructions, has slow internet, and occasionally does weird things like double-clicking submit buttons, pasting emojis into number fields, and hitting the back button during checkout. Review the app and identify every place where this user would have a bad experience. Then fix them."*

Specific things to test:

- Double-clicking buttons (does it submit the form twice? charge the card twice?)
- Empty form submissions (does the app crash or show validation?)
- Extremely long inputs (does a 10,000-character name break the layout?)
- Slow network (do loading states exist, or does the UI freeze?)
- Browser back button during multi-step flows (does the state break?)
- Expired sessions (what happens if the user's login times out mid-action?)

### How to Iterate This Skill

**Week 1:** Add the error handling and security rules to your rules file. That's it — just get them in there so every session starts with these guardrails.

**Week 2:** Run the secret key audit and RLS setup. These are one-time tasks that dramatically reduce risk.

**Week 3:** Run the "hostile user" stress test on your most important flow (usually signup or checkout). Fix what you find.

**Week 4+:** Before every release or major feature launch, run through the full checklist: error handling, security, scale, and the stress test. Make this a habit the way committing has become a habit.

---

## Putting It All Together: The Session Workflow

Here's what a well-managed agent session looks like from start to finish:

```
START OF SESSION
│
├── Agent reads rules file automatically
├── You tell the agent to read scaffold docs (PLANNING, TASKS, CONTEXT, WORKFLOW)
├── Agent confirms understanding and current state
│
├── TASK LOOP (repeat for each task):
│   ├── You assign one focused task
│   ├── Agent confirms its plan before starting
│   ├── Agent works on the task
│   ├── You review changes (git diff)
│   ├── You test the result
│   ├── If broken → revert (git checkout .) → rethink → reassign
│   ├── If working → commit (git add . && git commit)
│   └── Agent updates TASKS.md and WORKFLOW.md
│
├── CONTEXT CHECK (every 30-45 minutes or 20+ messages):
│   ├── Is the agent still following instructions?
│   ├── Is it repeating mistakes?
│   ├── If degraded → have agent update all scaffold docs → start fresh session
│   └── If fine → continue
│
END OF SESSION
├── Agent updates all scaffold docs
├── Final commit with descriptive message
└── You're ready to pick up next time
```

---

## Quick-Start: Your First Week

If this feels like a lot, here's the absolute minimum to start with:

**Day 1:** Initialize git in your project. Make your first commit.

**Day 2:** Create a basic rules file (just the Identity and Security sections from the Skill 3 template).

**Day 3:** Practice the commit-test-continue rhythm with one small task.

**Day 4:** Create TASKS.md and start tracking what's done vs. what's next.

**Day 5:** Run the secret key audit on your project.

**Day 6-7:** Try decomposing a medium feature into 3–5 sub-tasks and executing them one at a time.

By the end of the week, you'll have version control, a rules file, a task list, and the habit of working in small bets. That alone puts you ahead of most people managing agents.
