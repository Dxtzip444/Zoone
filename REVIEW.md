# Zoone usability review

Reviewed November 7, 2026 on macOS, Spotify 1.3.8.620 and Spicetify 2.46.4. The fixes ship in Zoone v0.0.5.

## Confirmed issues fixed

| Priority | Finding | Result |
| --- | --- | --- |
| High | The volume popup was underneath Quickplay and other custom pages. Spotify's `#main` has an isolated stacking context, so increasing the popup's own z-index could not bring it above those pages. | The theme-owned popup now mounts beside the custom pages, stays anchored to the volume number, and accepts clicks. |
| High | Readout-only mode hid Spotify's entire volume group even when a redraw removed the replacement control. The observer only retagged direct children; recovery depended on a one-second polling timer. | Native controls appear immediately while the readout is absent. Structural changes repair the injected control on the next frame, including changes within the tray. Playback-clock text updates are ignored. |
| High | On a reload, Spicetify sometimes exposed its native player before attaching `Player.origin`, leaving theme startup waiting indefinitely. | Startup can attach the available native player bridge while preserving an existing bridge. |
| Medium | The number was under play/pause, far from the native slider in the left tray. | The number is centered directly below the native slider. Both controls are the default; slider-only and readout-only remain available. |
| Medium | The popup's mute action used a Spicetify helper that looked for an obsolete Spotify CSS class. | It activates Spotify's current native mute button, preserving the previous level on unmute. |
| Medium | Slow pointer movement could be ignored indefinitely because the jitter reference moved on every event. The idle view could also open while Spotify was in the background. | Pointer movement accumulates, background windows cannot trigger the idle view, and returning to Spotify restarts the inactivity timer. |

The volume popup also closes when opening another theme overlay or changing volume mode. Escape returns focus to its trigger, moving focus between the popup's slider and mute button keeps it open, and outside interaction closes it.

## Local Spotify change

Spotify Studio was enabled through the native `enableSuperConnect` feature flag. A saved local override sets that flag to `false`, disabling the Studio toolbar entry and onboarding popup independently of Zoone. Other feature overrides were preserved. This is a local Spotify preference, not a change bundled into the theme.

## Validation

- All 20 Node regression tests pass, including player startup, native mute dispatch, redraw recovery, mutation batching, and idle behavior. JavaScript syntax checking passes.
- All 31 live volume checks pass at each of 800 × 650, 1180 × 800, and 1512 × 949: 93 checks total.
- Live checks cover all three volume modes, placement, popup hit testing on Quickplay / Collection / Social / Browse, focus, Escape, outside dismissal, settings dismissal, and removal/recovery of the injected readout without replacing native controls.
- Actual mute/unmute was checked with no active track; the original output volume was restored.
- Spotify was restarted to check theme startup and persistence of the Studio preference.

Playback with an active track, Connect-device transitions, Canvas video, screen readers, other languages, and the full set of theme options were not exhaustively exercised. These checks should not be read as a claim that every theme bug is resolved.

## UX follow-ups

These are design choices to revisit, separate from the verified defects above:

- Quickplay starts artist radio on a click, while Collection selects on a click and plays on double-click or Enter. Consistent primary actions and visible play controls would make the transition easier to learn.
- Filled hearts remove a liked song immediately by default, while Spotify's native saved control opens its picker. A default closer to Spotify's behavior, with explicit removal in the menu, would reduce surprises.
- Many secondary labels use 9.5–11 px text. Larger text and pointer targets would improve discoverability, especially in settings and the player tray.
- The automatic mix view is enabled after five minutes by default. Making it opt-in would avoid an unexpected screen change for users who want the library to remain visible.
