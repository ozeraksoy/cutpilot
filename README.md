<p align="center">
  <img src="./assets/banner.svg" alt="Cutpilot" width="100%">
</p>

<p align="center">
  <strong>AI editing copilot for Adobe Premiere Pro.</strong><br>
  Skip the boring parts of editing.
</p>

<p align="center">
  <a href="./README.tr.md">Türkçe</a> ·
  <a href="https://buymeacoffee.com/ozeraksoy">Buy me a coffee</a>
</p>

---

## What it does

Cutpilot is a Premiere Pro CEP extension that turns hours of editing into minutes:

- **Whisper transcription** with word-level timestamps in 15+ languages
- **Frame-perfect jump cut** that auto-removes silences and filler words
- **AI viral shorts** that finds engaging moments and turns them into 9:16 vertical sequences
- **Auto-resync subtitles** to your jump-cut sequence
- **Customizable** filler words, silence threshold, AI model, candidate count

Built for content creators who want to spend more time creating and less time cutting silences.

## Quick install

### macOS

```bash
git clone https://github.com/ozeraksoy/cutpilot.git
cd cutpilot
chmod +x scripts/install.sh
./scripts/install.sh
```

### Windows

```bat
git clone https://github.com/ozeraksoy/cutpilot.git
cd cutpilot
scripts\install.bat
```

The install script will:
1. Copy the extension to your Adobe CEP folder
2. Enable Premiere Pro debug mode
3. Check for FFmpeg (and offer to install via Homebrew on macOS)

After install, restart Premiere Pro completely. Find Cutpilot under **Window > Extensions > Cutpilot**.

## Requirements

- Adobe Premiere Pro 2019 or later (CC 13.0+)
- macOS or Windows
- FFmpeg (the install script can install it on macOS)
- OpenAI API key with access to Whisper and GPT-4o models

## How to use

1. Open Premiere Pro and the Cutpilot panel
2. Click the settings gear, paste your OpenAI API key
3. Pick a clip in your timeline (or use "All Clips" to grab the active sequence)
4. Click **Start Transcription** — Whisper transcribes with word-level accuracy
5. From here:
   - **Jump Cut** removes silences and filler words, creating a tight new sequence
   - **AI Viral Shorts** finds the best moments and creates ready-to-publish 9:16 sequences

Subtitles auto-sync to the jump-cut sequence. Viral candidates show up as cards you can preview and select before generating.

## Languages

The interface supports Turkish and English. Switch from the header dropdown.

Whisper transcribes 15+ languages: Turkish, English, German, French, Spanish, Italian, Russian, Arabic, Japanese, Korean, Chinese, Portuguese, Dutch, Polish, Swedish.

Translation is supported — transcribe in any source language, translate to your target language in the same job.

## Settings

All settings are saved per-device:

| Setting | Range | Default |
|---|---|---|
| Minimum silence | 100–1000ms | 300ms |
| Filler words | customizable list | sey, ee, um, uh... |
| AI model | gpt-4o-mini / gpt-4o | gpt-4o-mini |
| Candidate count | 3–15 | 5 |
| Duration range | 15–120s | 25–90s |

## Privacy

Your OpenAI API key is stored only on your local machine via localStorage. Cutpilot does not send any data anywhere except directly to OpenAI's API. No telemetry, no analytics, no account required.

## Roadmap

- Auto-Reframe (face tracking for 9:16 instead of center crop)
- More short-form effects (text overlays, captions, transitions)
- Adobe Marketplace listing (signed ZXP package)

## Contributing

Issues and pull requests welcome. Cutpilot is MIT licensed.

Windows compatibility testing help is especially appreciated — the project is currently developed on macOS.

## Support

If Cutpilot saves you editing time, you can [buy me a coffee](https://buymeacoffee.com/ozeraksoy). Bug reports and feature requests via GitHub Issues.

## License

MIT — see [LICENSE](./LICENSE)

---

Built by [Ozer Aksoy](https://github.com/ozeraksoy).
