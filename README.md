# rain

> Social Media content generation tool for Earth App

`rain` is the official content generation tool for Earth App. It uses the Earth App API to fetch data about activities, events, prompts, and articles, and generates images with the content formatted in a visually appealing way.

## Usage

### Photo Generation

```bash
bun run photo:<type>
```

Where `<type>` is one of `activity`, `event`, `prompt`, or `article`.

### Video Generation

```bash
bun run video:prompt
```

This command generates a vertical short-form video at `out/prompt.mp4`.

Pipeline:

1. Fetch one random prompt from the Earth API.
2. Read the prompt aloud with Cloudflare TTS.
3. Generate an answer with Granite 4.0 H Micro using the Cloud system prompt.
4. Read the answer aloud with Cloudflare TTS.
5. Build timed captions from prompt and answer text.
6. Animate cloud variants while narration is active.
7. Render with Remotion over a random Minecraft background window.

Additional outputs:

- `out/prompt.props.json`: Render props passed into Remotion.
- `out/prompt.manifest.json`: Generation metadata (durations, assets, text).
- `src/assets/generated/prompt-*/`: Generated narration audio files.

## Video Notes

- Target format: `1080x1920` at `30fps`.
- Timing flow: prompt narration -> short pause -> answer narration.
- Duration policy:
  - Hard maximum: `90s`.
  - Hard minimum: `30s`.
  - Preferred range: `60s+`, with attempts centered around `80-85s`.
- Captions: phrase-level closed captions tuned for spoken pacing.
- Background: random 75-90 second window sampled from `src/assets/downloaded/minecraft.mp4`.
- Watermark: persistent Earth App logo at bottom-right.

Implementation approach (research-aligned):

- Use `OffthreadVideo` for stable frame-accurate background extraction.
- Use dynamic composition duration (`calculateMetadata`) so renders end with narration.
- Keep generation side effects out of the composition by precomputing all timing data in Bun.
- Use deterministic render props (`prompt.props.json`) for reproducible output/debugging.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request with your changes.

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for more information.
