// Vox Mail checks. Google, Microsoft Graph, and mail servers are all fake:
// fetch is mocked, IMAP and SMTP run in memory behind a scripted socket, and
// D1 is SQLite in memory with the real migrations.

await import("./unit.test.mjs");
await import("./imap.test.mjs");
await import("./site.test.mjs");

console.log("Vox Mail checks passed.");
