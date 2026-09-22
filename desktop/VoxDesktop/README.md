# Vox Desktop

Vox Desktop is a secure Electron shell for the existing Vox web interface. It adds an explicit bridge to the Codex installation and sign-in on the user's computer.

## Safety model

- The Vox website runs in a separate, sandboxed view. Its only local capability is a narrow, desktop-only request bridge; it receives no filesystem, shell, or general Electron access.
- The Codex panel is bundled local code. Progress and command details stay local; only a redacted, concise final reply returns to Vox after the user confirms that disclosure.
- The user chooses one local workspace folder.
- Software tasks launched from the Codex panel require a native confirmation dialog.
- Tasks are read-only by default. Edit access is limited to the chosen workspace.
- Network access and Codex web search are disabled for local tasks.
- Spoken or typed software-work requests can be routed to local Codex only when the desktop bridge is present. Ordinary programming conversation stays with Vox.
- Opening the selected project folder is a direct Finder action. Vox asks for spoken confirmation first, then opens only the validated workspace; it does not invoke Codex or Computer Use for this action.
- Vox can directly launch a fixed allowlist of low-risk apps after spoken confirmation: Finder, Safari, Google Chrome, Preview, Notes, Calculator, TextEdit, and Visual Studio Code.
- Mouse control is separate from app launching. One spoken confirmation authorizes the complete described task, it runs through local Codex in read-only mode, and it stays restricted to the named approved app. Computer Use or macOS may still show their own permission prompt until that app has been approved there.
- Approved browser tasks may create or switch tabs, navigate to a public website, and perform a public search. Codex's own HTTP and web-search tools remain disabled.
- Desktop control blocks deleting, sending, posting, sharing, uploading, purchasing, logging in, credentials, downloads, installs, settings changes, Terminal, and shell commands. If the macOS Computer Use service or permissions are unavailable, Vox reports that no action occurred.
- Computer Use on macOS requires Screen Recording and Accessibility permission for ChatGPT Computer Use. The desktop app never changes those permissions itself.
- Computer Use uses the Codex runtime from the installed ChatGPT/Codex desktop app, to match its native service. Ordinary coding tasks still use the bundled CLI. An app-approval denial is reported separately from a transport connection failure.
- Computer Use runs over App Server so its interactive app-access request can be answered from the user's spoken task confirmation. The grant is limited to the matching thread and named app, with no persistent permission. Other permission requests are declined.

## Development

```bash
npm install
npm run check
npm start
```

Set `VOX_DESKTOP_DEV_URL=http://localhost:5173` before `npm start` to load a local Vox development server. Packaged builds always load the production origin.

## Packaging

```bash
npm run dist
```

Unsigned local builds can be tested directly. Public distribution still requires Apple Developer signing/notarization on macOS and code signing on Windows.
