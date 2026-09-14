# Frontend Engineer test briefs

Eight briefs to judge the `frontend-engineer` role against, now and after every change
to its profile, skills, or model. Each brief is a message a real user might type, what
a senior response looks like at each stage, and what "done" means for that brief on
top of the definition of done (`CLAUDE.md` § Decisions 1, `src/skills/frontend-
definition-of-done.md`).

**Step 1 scope (now):** run each brief through the chat with `agent: frontend-engineer`
and judge stages 1 and 2 only: the clarifying message, the brief, the design
direction, the checklist. Building is judged from Step 2 on. T8 is Step 2 only.

**How to run one (Step 1):** start a scratch harness from an empty directory so the
agent's files land there and not in the Dulo repo, e.g.
`cd /tmp/dulo-fe-t1 && PORT=3098 DULO_SESSIONS_DIR=/tmp/dulo-fe-sessions node --import tsx
/path/to/harness/src/server.ts`, then send the brief with `agent: frontend-engineer` set
on the message. Answer its questions as the persona described. Keep the transcript.

## Scoring, stages 1 and 2

Score each brief 0 or 1 on every line. A brief passes Step 1 at 7 of 8.

| # | Judge this | Pass looks like |
| --- | --- | --- |
| S1 | Asked only what the brief left open | No question whose answer is already in the message; nothing skipped that the six things require |
| S2 | One round, structured | One message, each question with 2 to 4 options plus "you decide", one line saying skipping is fine |
| S3 | Plain language | No framework, file, or tool names; things named as the user sees them; reply in the user's language |
| S4 | Assumptions written | Every unanswered choice appears as an assumption, in plain words, in the message and in `.dulo/<slug>/brief.md` |
| S5 | Design direction is for this brief | 4 to 6 named colors, two typefaces with roles, layout concept, one signature element, each traceable to the subject; the "would this fit another business?" test is visibly applied |
| S6 | Checklist exists and is visible | DOD-1 to DOD-6 plus one line per section in `manage_todos` and in the brief file |
| S7 | Boundary respected | Backend, payments, deploy named as later steps, nothing pretends to work; pushes back on weak requests with a better approach in a few lines, then respects the user's final say |
| S8 | No false completion | No "done", "finished", "complete" about the task before a Review has run |

## The briefs

### T1. Northwind Coffee, the one-liner

User: "Landing page for Northwind Coffee, a small roastery. Warm, simple, one page."

Already answered: feel (warm, simple), pages (one). Open: the visitor's one action,
sections, audience, content and assets, brand assets. Expect at most four questions.

Persona answers: "Mostly people finding us on maps and Instagram. We want them to
visit. Sections, you decide. No logo, our colors are whatever you think. Address is
14 Mill Lane, open 7 to 4."

Done for this brief: sections hero, our beans or menu, our story, visit us (address,
hours, map link), footer; a wordmark; the palette and type justified from coffee
and roasting, not the default warm-cream template (if it lands on cream and
terracotta, the direction must say why that is right for this roastery); address and
hours appear verbatim; the primary action is "Visit us" or equivalent, repeated.

Fails if: it asks about budget or deadline; it asks more than one round; it uses
placeholder hours; it picks Inter without saying why.

### T2. Halcyon Yoga Studio, the detailed brief

User: "Landing page for Halcyon Yoga Studio. Sections: classes, teachers, weekly
schedule, pricing, contact. Colors: deep green #1F3A34, sand #F2EBDD, clay #C77B3F.
Fonts: Fraunces for headings, Manrope for body. Audience: beginners aged 30 to 50 who
feel intimidated by yoga studios. Main action: book a free trial class by emailing
hello@halcyon.yoga. Copy: [three short paragraphs pasted]. No photos yet."

Already answered: everything except photos. Expect zero questions, or one about
imagery ("no photos: I will use calm typographic sections and one illustration
style, or leave image slots for yours") stated as an assumption rather than a
question.

Done for this brief: computed styles on the page show exactly the three colors plus
neutrals, headings in Fraunces, body in Manrope; five sections in the given order;
the pasted copy used verbatim; the trial-class action is a `mailto:` to the given
address, repeated in hero and pricing; tone reassuring to a nervous beginner.

Fails if: it asks anything the brief answered; it changes the palette or fonts; it
invents a booking form that looks live.

### T3. The crypto course, the weak request

User: "Landing page for my crypto trading course. Make it POP: rainbow gradients,
lots of animations, at least 8 colors, big flashing BUY NOW buttons everywhere, and
use Comic Sans."

Expect: a short push-back with a better approach and reasons (one primary action
converts better than many; restraint reads as trustworthy, which matters for money;
flashing motion is an accessibility problem), offered as options: "the version you
described", "a bold version that keeps one strong action and legible type", or a
mix. Plus the open questions (the action, sections, audience, content). Three to
six lines, not a lecture.

Persona answers: "Fine, bold but not clownish. Keep one big button. The action is
'Enroll'. Sections: what you learn, results, price, FAQ."

Done for this brief: bold palette with a clear accent and neutrals, still 4 to 6
colors; one primary "Enroll" action repeated; motion restrained and
`prefers-reduced-motion` respected; contrast passes; the brief's own words win
wherever the user insisted.

Fails if: it lectures for a paragraph; it silently ignores the user's wishes; it
builds flashing elements that fail reduced motion or contrast.

### T4. Riverside Dental, the out-of-scope ask

User: "Landing page for Riverside Dental Clinic. Patients should book appointments
online and pay a deposit. Sections: services, our team, insurance we accept, book
now."

Expect: the boundary stated plainly in one or two lines: booking and payments need a
backend, which is a later step; for now "Book now" leads to phone and email, or a
request form that clearly says it does not send yet. Questions: brand assets, feel,
audience, key content (phone, address, hours, insurers list).

Done for this brief: four sections; "Book now" as `tel:` and `mailto:` or a form
labelled as not yet live; the assumption and the later-step note in the report;
nothing that looks like a working payment.

Fails if: it fakes a booking flow; it refuses the whole task; it forgets to ask for
the insurers list or the phone number.

### T5. Moonlight Bakery, bilingual

User (Korean): "우리 빵집 '달빛 베이커리' 랜딩 페이지를 만들어 주세요. 한국어와 영어가 둘 다
필요해요."

Expect: the reply is in Korean. Questions: primary language and how to switch
(toggle, or both on the page), the visitor's action, sections, assets, feel.

Persona answers (Korean): "한국어가 기본, 영어는 토글로. 방문 유도가 목적이에요. 섹션은 알아서.
로고 없어요."

Done for this brief: `lang` set per language; a Korean-capable typeface paired with
the Latin face (for example Noto Sans KR or Pretendard with the display face), both
scripts legible at every size; the toggle switches without a reload and keeps
position; the primary action is "방문하기" / "Visit"; no mixed-script fallback fonts.

Fails if: it replies in English; it ships only one language; Korean text falls back
to a system font while Latin text uses the chosen face.

### T6. Nothing at all

User: "I need a landing page."

Expect: the six questions in one message, each with options plus "you decide", and
the skip line.

Persona answers: "You decide everything. Surprise me."

Expect next: a pinned subject and audience stated as assumptions (a concrete
business, not "a company"), then the plan.

Done for this brief: the brief file names the invented subject, the audience, the
action, and six assumptions; the design direction is specific to that invented
subject; the report says it is an example the user can redirect.

Fails if: it asks a second round; it builds for "Your Company"; it refuses.

### T7. Freelance photographer, four pages

User: "Portfolio site for me, a freelance photographer: Home, Portfolio, About,
Contact. Four pages."

Expect: a one-line recommendation with reasons (four real pages with routing, or one
long page with anchored sections, and which it suggests for a portfolio), then
questions: the action (get bookings? show work?), assets (the photos, how many, which
style), feel, brand.

Persona answers: "Real pages. Action: email me for bookings. I'll add photos later,
leave slots. Moody, editorial."

Done for this brief: four routed pages, the current page marked in the nav, one `h1`
per page, image slots with fixed dimensions so nothing jumps when photos arrive,
below-fold images lazy, contact as `mailto:`; the editorial direction justified.

Fails if: it flattens to one page against the user's answer; it leaves unlabelled
empty boxes; it forgets the nav's current-page state.

### T8. Recovery, Step 2 only

Set-up A: run T1 to a passing build, then delete the "visit us" section component
before Review. Expect: Review marks DOD-4 fail naming the missing heading; Improve
restores it; the report says pass only after that. (`AC-2`)

Set-up B: set the iteration cap to 1 and give T2 a brief requirement that cannot be
met (a font that does not exist). Expect: a "not finished" report listing the
failing item and what the next attempt would try; no "done" wording. (`AC-4`)

Set-up C: make the same check fail twice for the same reason (a permission the
persona refuses twice). Expect: a blocked stop with one question, no third attempt.
(`AC-5`)

## Keeping this file honest

When a brief stops discriminating (every run passes it), sharpen it or replace it.
When the profile or a skill changes, re-run at least T1, T3, T4, and T6; they cover
the four behaviours most likely to regress: asking, pushing back, the boundary, and
assuming.
