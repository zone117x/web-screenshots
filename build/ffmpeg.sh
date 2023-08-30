#!/bin/bash

set -euo pipefail

CONF_FLAGS=(
  --target-os=none              # disable target specific configs
  --arch=x86_32                 # use x86_32 arch
  --enable-cross-compile        # use cross compile configs
  --disable-asm                 # disable asm
  --disable-stripping           # disable stripping as it won't work
  --disable-programs            # disable ffmpeg, ffprobe and ffplay build
  --disable-doc                 # disable doc build
  --disable-debug               # disable debug mode
  --disable-runtime-cpudetect   # disable cpu detection
  --disable-autodetect          # disable env auto detect

  # disable all features except for ones needed to create screenshots for supported video formats
  --disable-everything
  --enable-avfilter
  --enable-protocol=file
  --enable-demuxer=matroska,mov,avi,mpegps,mpegts,m2ts # demuxers for common video containers
  --enable-muxer=png,image2 # muxer for png file output
  --enable-parser=mpegvideo # parse mpeg-2 m2ts files from blu-ray discs correctly
  --enable-filter=null,trim,scale,tonemap,colorspace,format
  --enable-encoder=png # encoder for png output
  --enable-decoder=h264,vc1,mpeg2video,hevc # decoders for common video formats
  --enable-swscale # software scaler library (swscale)

  # assign toolchains and extra flags
  --nm=emnm
  --ar=emar
  --ranlib=emranlib
  --cc=emcc
  --cxx=em++
  --objcc=emcc
  --dep-cc=emcc
  --extra-cflags="$CFLAGS"
  --extra-cxxflags="$CXXFLAGS"

  # disable thread when FFMPEG_ST is NOT defined
  ${FFMPEG_ST:+ --disable-pthreads --disable-w32threads --disable-os2threads}
)

emconfigure ./configure "${CONF_FLAGS[@]}" $@
emmake make -j
