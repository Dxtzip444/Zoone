# Changelog

## v0.0.5

- Keep the volume number beneath the native slider in the left tray and show both by default.
- Place the volume popup above the custom pages so its slider and mute button remain clickable.
- Recover injected player controls after nested Spotify redraws, retaining a native volume fallback while the readout is missing.
- Keep volume controls visible at smaller window sizes, close the popup when another overlay opens, and retain Escape and focus behavior.
- Prevent the idle mix view from opening in the background; restart its inactivity timer when returning to Spotify and recognize gradual pointer movement.
- Allow startup when Spotify's native player is ready before Spicetify attaches its bridge; use the current native mute control instead of Spicetify's outdated class selector.

## v0.0.2

- Add outlined play/pause controls to Collection songs and album covers, with equivalent keyboard actions below each list.
- Add a static playing highlight using the selected gradient, plus a Zune mark option. Selection, keyboard focus and paused playback stay distinct. High contrast and custom-color fallbacks preserve readable text.
- Add Show playing song, with explicit actions when a filter or another view hides the track.
- Wait for the player to be ready before starting the theme, so a cold launch completes and Match system can follow later appearance changes.
- Show Browse failures honestly, retain earlier successful results and offer Try again.
- Preserve focus on Social and Browse pagers, correct misleading Social labels, distinguish Clear search from Search, and explain when Friends is unavailable.
- Preserve the selected song as more library pages load and keep action focus through Collection rebuilds.

Existing settings carry over. The gradient is static in this release. Historical Mixview, Quickplay depth changes and alternate detail layouts remain future work.
