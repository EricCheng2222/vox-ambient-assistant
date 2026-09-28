#!/bin/bash
set -e
v=$1
ffmpeg -v error -y -i riser.wav -i chirps.wav -i impact.wav -i pad.wav -i cine-$v.wav -i ir.wav -filter_complex "
[4]aresample=48000,silenceremove=start_periods=1:start_threshold=-45dB,highpass=f=90,equalizer=f=3200:t=q:w=1:g=3,equalizer=f=9500:t=q:w=1:g=2,acompressor=threshold=-22dB:ratio=3:attack=4:release=90,aformat=channel_layouts=stereo,asplit=2[dry][toverb];
[toverb][5]afir=dry=0:wet=10:length=1,volume=0.32,stereotools=slev=1.4[wet];
[dry][wet]amix=inputs=2:normalize=0,adelay=1750|1750[voice];
[1]adelay=1050|1050[chirps];
[2]adelay=1500|1500,volume=0.8[impact];
[3]adelay=1300|1300,volume=0.9[pad];
[0][chirps][impact][pad][voice]amix=inputs=5:normalize=0,alimiter=limit=0.9,loudnorm=I=-15:TP=-1.2" -ar 48000 -c:a aac -b:a 192k welcome-home-cinematic-$v.m4a
