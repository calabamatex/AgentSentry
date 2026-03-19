# From Vibe Coding to Agent Management: The 5 Essential Skills

## The Core Problem

In 2025, "vibe coding" — describing what you want and letting AI build it — was enough. Tools like Lovable, Claude, Cursor, Replit, and ChatGPT let non-engineers ship real software from text prompts alone.

In 2026, those same tools became **agentic**. They no longer just suggest code — they read files, create database tables, run commands, install dependencies, and iterate autonomously for 10–60+ minutes at a stretch. This is a fundamentally different dynamic: a single bad step midway through a multi-step operation can cascade and compound, making everything that follows worse.

**The shift:** Vibe coding was a *prompting* problem. Agent management is a *supervision* problem. You don't need to become an engineer — you need to become a competent manager of an engineer with short-term memory.

**The analogy:** Think of yourself as a general contractor building a house. You're not laying brick, but you know what a straight wall looks like, which walls are load-bearing, and that you don't tear out plumbing without turning off the water.

---

## The 5 Skills

### Skill 1: Save Points (Version Control)

**The disaster:** Your agent breaks something. It tries to fix it, makes it worse. You're 3 hours deep in a circular conversation and the working version is gone.

**The fix:** Use **Git** — treat it like save points in a video game. Every time your project is in a working state, save a snapshot. That snapshot is permanent. One command and you're back to the version that worked, no matter what the agent does next.

**Action steps:**

- Learn the 5–6 Git commands you actually need (commit, checkout, branch, log, diff, reset)
- Save a snapshot *before every significant change*
- Make this a priority *ahead of your next feature request*

---

### Skill 2: Know When to Start Fresh

**The disaster:** Your agent is brilliant for the first 20–40 minutes, then starts ignoring instructions, rewriting working code, and introducing bugs. It feels like it forgot everything — because it literally did.

**Why it happens:** Agents have a fixed **context window**. Every message, file read, and error consumes space. When it fills up, your early instructions get compressed or dropped.

**Simple fix:** Start a new conversation.

**Advanced fix — build scaffold documents:**

| Document | Purpose |
|---|---|
| **Workflow file** | Logs what the agent is doing step-by-step |
| **Planning file** | Outlines the overall architecture and approach |
| **Context file** | Gives the agent its bearings when restarting mid-project |
| **Task list** | A burndown list so the agent picks up where it left off |

These documents act as "save points for the agent run itself." If you're 65% through a build and the agent loses context, you restart with these docs and pick up at 65% — not zero.

---

### Skill 3: Standing Orders (Rules Files)

**The disaster:** You've told your agent "always use dark mode" a dozen times. It keeps defaulting to light mode. Every session starts from scratch.

**The fix:** Create a **rules file** — a text document in your project folder that the agent reads at the start of every session. Think of it as your employee handbook.

**Tool-specific names:**

- Claude Code → `claude.md`
- Cursor → `.cursorrules`
- Universal standard → `agents.md`

**How to build it (iteratively, not all at once):**

1. Start minimal: what the product is, what it's built with, a few known issues
2. Every time the agent makes a repeated mistake, add a line to prevent it
3. Over weeks, it becomes a precise reflection of your project's needs
4. Prune regularly — every line should earn its keep
5. Keep it under 200 lines (ideally under 100) since it competes for the same context window as your conversation

---

### Skill 4: Small Bets (Control the Blast Radius)

**The disaster:** You ask for a full redesign of the order system. The agent touches every file. Half the features break. You can't tell which change caused which problem.

**The concept: blast radius** — how much of your project a single change can affect. Complex changes compound errors exponentially.

**Decision framework:**

| Change Size | Approach |
|---|---|
| **Small** (change a color, fix a form) | Just do it. No special prep needed. |
| **Medium** (add a new feature) | Have the agent plan it into sub-tasks. Execute in pieces. Validate and save between each piece. |
| **Large** (redesign a system) | Only attempt with a robust eval and agent harness. If you don't know those terms, break it into medium tasks instead. |

**Before every task, ask:** "How big is this?" Then scope accordingly.

---

### Skill 5: Ask the Questions Your Agent Won't

Your agent will never proactively raise these concerns. You must embed them in your instructions and rules file.

**1. Handle failures gracefully**
> "Every time the app communicates with a server, handle failure with a clear, friendly message — never a blank screen."

Payments get declined. Servers go down. Connections drop. Your agent won't think to show users what went wrong unless you tell it to.

**2. Protect customer data**
- Instruct the agent to implement **row-level security** so each customer can only see their own data
- **Never paste secret keys into AI chat** — use environment variables or secret managers
- Add to your rules file: *"Never log customer emails or payment information"*
- Use third-party services (Stripe, Google sign-in) to handle sensitive data so you're not storing it yourself

**3. Set growth expectations upfront**
Tell the agent your expected scale before it builds anything. "This is for 10 users" produces very different architecture than "this needs to support 10,000." Without this, agents either over-engineer or under-engineer.

---

## When to Bring In a Professional

Even with these skills, hire a real engineer when:

- You're handling payments beyond basic checkouts
- You're dealing with medical, children's, or legally regulated data
- Your app is getting slow under real load and you don't know why
- Your codebase has gotten so messy the agent is struggling with it

This isn't failure — if a non-engineer can build a product, get real customers, and *then* bring in an engineer to harden it, you've already proved the idea works before spending serious money. That's exactly the right sequence.

---

## Quick-Reference Checklist

- [ ] **Before every change:** Git commit (save point)
- [ ] **Before every session:** Agent reads the rules file
- [ ] **Before every task:** Ask "how big is this?" and scope accordingly
- [ ] **During long sessions:** Watch for context degradation; restart with scaffold docs if needed
- [ ] **In the rules file:** Error handling instructions, security requirements, scale expectations, "never log PII"
- [ ] **After every completed sub-task:** Verify it works, then save
