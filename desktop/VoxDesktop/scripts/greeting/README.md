# Welcome home greeting sounds

The sounds in `resources/sounds` were made once and are shipped with the app.

- Voice: OpenAI `gpt-4o-mini-tts`, voices `fable`, `onyx`, `ash` (and `cedar` for the simple set),
  directed as a calm, refined British AI butler. The cinematic takes read "Welcome home... sir."
  with a short pause before "sir".
- Simple versions: a two-tone chime, then the voice with a light chorus and short metallic room.
- Cinematic versions: `build-layers.sh` synthesizes the power-up swell, HUD chirps, sub impact,
  ambient pad, and a hall reverb impulse; `mix.sh <voice>` mixes them with `cine-<voice>.wav`.

Both scripts need `ffmpeg`.
