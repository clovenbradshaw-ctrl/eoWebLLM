# eoWebLLM Laws

A law is not a preference, and this file is not a style guide. It exists
because the same mistake got made and unmade on the same component more than
once — the fix would go in, and a later pass would quietly reintroduce the
thing it fixed, because nothing on record said the old behavior was wrong on
purpose rather than just old. Writing it down here is what makes a fix stick
past the session that made it.

---

## L1 — A reasoning panel discloses; it does not sit on the page

Thinking, Plan, and Warrant are all built on the same `TracePanel` shell in
`app/components/chat.tsx`, styled by `.trace-panel` in `chat.module.scss`,
and the whole point of that shell is to look like Claude's own
extended-thinking display: collapsed, it is a single dim line of text with a
disclosure marker, sitting flush in the transcript, asking nothing of the
reader who doesn't click it. It earns a border, a fill, and an indent only
once it's actually open, because that's the one moment a reader has said
"show me" — anything short of that click gets the same weight as the prose
around it, not more.

This got built wrong twice. The first version gave `.trace-panel` a
permanent `border`, `background: var(--gray)`, and `padding` — regardless of
whether the `<details>` was open or closed — so every Plan and every Warrant
sat on the transcript as a shaded card whether or not anyone had asked to
look inside. A comment right above the rule even claimed it was "styled like
Claude's extended-thinking display," which was aspirational, not true: real
extended-thinking, collapsed, has no visible box at all. The fix removed the
border/background/padding from the shared `.trace-panel` shell entirely,
left `.trace-panel-summary` as the only affordance (a hover state and the
native disclosure marker, nothing else), and moved the indent and left-rule
onto `.trace-panel-body` so they only exist once the reader has actually
opened the thing.

**The check for a future pass:** if `.trace-panel`'s collapsed state
(anything outside `.trace-panel[open]` or `.trace-panel-body`) ever again
carries a `border`, a `background`, or padding that makes it read as a card
rather than a line of text, that's this law being violated again, not a
harmless restyle. Any new collapsible reasoning surface — not just Thinking,
Plan, and Warrant — should be built on `TracePanel` rather than growing its
own box, so this stays enforced by construction instead of by memory.
