# Contributing to Vox

Thanks for helping improve Vox.

## Contributor agreement

Every contributor must read [CLA.md](./CLA.md) and include the required acceptance statement in the pull-request description. This gives Eric Cheng the commercial rights needed to keep one commercial steward for Vox while public use remains noncommercial.

## Before opening a pull request

1. Create a focused branch from `main`.
2. Keep credentials and personal conversation data out of commits, fixtures, screenshots, and logs.
3. Preserve the separation between Vox Cloud and Personal mode. Personal mode must not contact Vox-hosted endpoints.
4. Keep long-lived provider credentials out of renderer and browser code.
5. Add or update focused tests for routing, privacy boundaries, language behavior, and desktop bridges.
6. Confirm that your contribution and its dependencies can be offered under the repository license and contributor agreement.
7. Run:

   ```bash
   npm run lint
   npm run build
   npm run test:privacy
   cd desktop/VoxDesktop && npm run check
   ```

## Pull requests

Describe the user-facing behavior, privacy or cost impact, verification performed, and any migration or desktop-reinstall requirement. Small, reviewable changes are preferred.

## Product principles

- Let people finish speaking.
- Stay quiet when speaking would not help.
- Make capture, storage, delegation, and computer control visible.
- Prefer explicit privacy boundaries over hidden convenience.
- Never claim an action succeeded unless it was verified.
