# ECON Escape Battle — complete source

This package contains the current 8-question Traditional Chinese / English game.
Questions 1 and 8 use the simplified versions requested by the teacher.

## Files
- standalone.html: complete offline HTML, with CSS, JavaScript and bilingual questions embedded. Open directly in a browser. Device-local leaderboard; players advance themselves.
- online.html: complete online HTML source. The online client calls the same-origin /api endpoints provided by the Worker. Opening this HTML alone does not provide synchronization.
- src/: readable CSS, browser JavaScript, bilingual question bank, Worker API and compatibility code.
- scripts/: build, local preview and SQLite preview adapter.
- drizzle/: database schema migrations, in order.
- tests/: end-to-end API checks for all eight questions and the teacher-paced flow.

## Build and local preview
Use a current Node.js release with node:sqlite support (tested with Node 24).
No package installation is required.

    node scripts/build.mjs
    node tests/api.test.mjs
    node scripts/preview.mjs

Open http://127.0.0.1:4173. Create a classroom as teacher, join in another browser tab as a student, and start question 1. The teacher ends answering, explains, then opens the next question.
The preview creates a local .preview.sqlite file.

## Online hosting
The build emits dist/server/index.js, a Cloudflare Worker ES module with a default fetch handler.
Provide a D1 database binding named DB and apply the three SQL migrations in drizzle/ in order before serving the Worker. Online clients must share that Worker origin, so their /api requests reach the same backend.
The .openai/hosting.json included here is a neutral build manifest. It deliberately omits the original Site project ID. Register your own Site before publishing through Sites, or configure your own compatible Worker host.

No database contents, classroom management tokens, personal data, Git credentials or deployment credentials are included.

## Content attribution
Five questions are adapted from teacher-supplied screenshots; three are original supplementary questions. Screenshot labels are retained as unverified labels, not verified examination years or licences. Raw screenshots are not included.
