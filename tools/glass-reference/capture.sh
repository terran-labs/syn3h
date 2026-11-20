#!/bin/sh
# Supply an already booted development simulator and a folder of matched 344:160 backgrounds.
# Run through tools/heavy.sh. The app and screenshots stay in the output directory.
set -eu
if [ "$#" -ne 5 ]; then
  echo "Usage: capture.sh SIMULATOR_ID BACKGROUND_DIR OUTPUT_DIR regular|clear 2|3" >&2
  exit 2
fi
device=$1
images=$2
output=$3
material=$4
scale=$5
case "$material" in regular|clear) ;; *) exit 2 ;; esac
case "$scale" in 2|3) ;; *) exit 2 ;; esac
src=$(dirname "$0")
app="$output/GlassTrial.app"
mkdir -p "$app"
sdk=$(xcrun --sdk iphonesimulator --show-sdk-path)
xcrun --sdk iphonesimulator swiftc -parse-as-library -target arm64-apple-ios26.0-simulator -sdk "$sdk" "$src/Simulator.swift" -o "$app/GlassTrial"
cp "$src/Info.plist" "$app/Info.plist"
cp "$images"/*.png "$app/"
codesign --force --sign - "$app"
xcrun simctl install "$device" "$app"
for file in "$images"/*.png; do
  name=$(basename "$file" .png)
  for theme in light dark; do
    for state in bare rest repeat; do
      set --
      if [ "$state" = bare ]; then set -- -bare; fi
      xcrun simctl launch --terminate-running-process "$device" dev.syn3h.GlassTrial -background "$name" -variant "$material" -theme "$theme" "$@"
      sleep 1.2
      xcrun simctl io "$device" screenshot "$output/full.png"
      width=$((328 * scale))
      height=$((160 * scale))
      ffmpeg -nostdin -v error -threads 1 -y -i "$output/full.png" -vf "crop=$width:$height:(in_w-$width)/2:(in_h-$height)/2" -frames:v 1 "$output/$name-$theme-$state.png"
    done
  done
done
