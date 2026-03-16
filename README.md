# Met(l)a JeBem (Example App)

Met(l)a JeBem is an app for Meta Ray-Ban glasses for using our own AI capabilities that go around EU's bullshit.

This app is an **example client** built on top of the `expo-meta-wearables-dat` Expo native module.

## What This Example Uses

- `expo-meta-wearables-dat` for:
  - registration and permissions
  - device discovery
  - stream session lifecycle
  - photo capture
  - native stream preview
- local `expo-smolvlm` module in `example/modules/expo-smolvlm` for:
  - on-device image understanding (SmolVLM2)
  - voice-trigger support
  - Siri/App Intent command handoff

## Features

- Start/stop stream from connected Meta Ray-Ban glasses
- Continuous AI scene summaries
- Voice-trigger one-shot capture ("What I see")
- Siri/App Intent-triggered one-shot capture
- Text-to-speech playback of summaries

## Requirements

- Physical iPhone (no simulator)
- Meta AI app installed and glasses paired
- Xcode + valid Apple signing team
- iOS permissions in `app.json`/Info.plist:
  - `NSMicrophoneUsageDescription`
  - `NSSpeechRecognitionUsageDescription`
  - `UIBackgroundModes` includes `audio`

## Run

```bash
cd example
pnpm install --no-frozen-lockfile
npx expo run:ios --device "Michal’s iPhone"
```

If Metro is already running:

```bash
npx expo run:ios --device "Michal’s iPhone" --no-bundler
```

## Usage

1. Register app + grant camera permission.
2. Start stream.
3. Open AI Vision section.
4. Choose mode:
   - `Continuous`
   - `Voice Trigger`
5. (Optional) Enable voice output.

## Known Operational Limits

- Glasses can stop stream when thermal protection kicks in.
- Speech recognition and Siri behavior depend on iOS permission state.
- First model load may require network to download model artifacts.
