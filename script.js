let ffmpeg;

document.addEventListener('DOMContentLoaded', init);

function log(message) {
  console.log(message);
  const logDiv = document.getElementById('logOutput');
  const isScrolledToBottom = logDiv.scrollHeight - logDiv.clientHeight <= logDiv.scrollTop + 1;
  logDiv.textContent += message + '\n';
  if (isScrolledToBottom) {
    logDiv.scrollTop = logDiv.scrollHeight;
  }
}

function addInfo(message) {
  const infoDiv = document.getElementById('info');
  infoDiv.textContent += message + '\n';
}

function parseDuration(durString) {
  const regex = /^\s*Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/;
  const match = durString.match(regex);
  if (!match) return null;
  const [, hours, minutes, seconds] = match;
  return (parseInt(hours) * 60 * 60) + (parseInt(minutes) * 60) + parseInt(seconds);
}

async function init() {
  ffmpeg = new FFmpegWASM.FFmpeg();
  ffmpeg.on('log', ({ type, message }) => {
    log(`FFMPEG [${type}]: ${message}`);
  });

  log('Initializing FFmpeg...');
  await ffmpeg.load({
    coreURL: '/ffmpeg-core.js',
    wasmURL: '/ffmpeg-core.wasm',
  });
  log('FFmpeg is ready');

  document.getElementById('videoFile').onchange = generateScreenshots;
  if (document.getElementById('videoFile').files[0]) {
    generateScreenshots();
  }
}

async function generateScreenshots() {
  const videoFileInput = document.getElementById('videoFile');
  const videoFile = videoFileInput.files[0];
  const videoPath = '/videos/' + videoFile.name;

  await ffmpeg.createDir('/videos');
  await ffmpeg.mount('WORKERFS', { files: [videoFile] }, '/videos');

  let duration = null;
  let isHDR = false;
  const logOutputCb = ({ type, message }) => {
    if (!duration && (duration = parseDuration(message))) {
      addInfo(`Video duration: ${duration} seconds`);
    }
    // HDR content typically has a video stream description like:
    //   > Stream #0:0(eng): Video: hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/smpte2084)
    // AFAIK the most reliable way to detect HDR is to look for the smpte2084 flag
    if (!isHDR && message.includes('smpte2084')) {
      isHDR = true;
      addInfo(`Tonemapping enabled, HDR detected from line: ${message.trim()}`);
    }
  };
  ffmpeg.on('log', logOutputCb);
  const ffmpegInfoArgs = [
    '-i', videoPath,
    '-an', // No audio
    '-sn', // No subtitles
    '-map', '0:v:0', // only use the first video stream from the first input file
    '-vn', // No video output
    '-hide_banner', // Hide the banner information
  ];
  log(`> ffmpeg ${ffmpegInfoArgs.join(' ')}`);
  await ffmpeg.exec(ffmpegInfoArgs);
  ffmpeg.off('log', logOutputCb);
  if (!duration) {
    throw new Error(`Could not determine video duration`);
  }
  log(`Video duration: ${duration} seconds`);

  const minStartTime = 0;
  const randomTime = () => Math.floor(Math.random() * (duration - minStartTime)) + minStartTime;
  const maxAttempts = 10;
  let validScreenshots = 0;
  let blurryScreenshots = 0;
  let darkScreenshots = 0;

  // Correct resolution for anamorphic videos
  let vfArg = `scale='max(sar,1)*iw':'max(1/sar,1)*ih'`;

  // Tonemapping for HDR videos
  const vfHdrTonemapping = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';
  
  if (isHDR) {
    vfArg += `,${vfHdrTonemapping}`;
  }

  for (let i = 1; i <= maxAttempts; i++) {
    const timestamp = randomTime();
    const screenFileName = `screen_${i}_${timestamp}.png`;
    const ffmpegArgs = [
      '-ss', `${timestamp}`,
      '-i', videoPath,
      '-an', // No audio
      '-sn', // No subtitles
      '-map', '0:v:0', // only use the first video stream from the first input file
      '-vf', vfArg,
      '-pix_fmt', 'rgb24',
      '-frames:v', '1',
      screenFileName
    ];
    log(`> ffmpeg ${ffmpegArgs.join(' ')}`);
    await ffmpeg.exec(ffmpegArgs);

    const thumbData = await ffmpeg.readFile(screenFileName);
    const thumbBlob = new Blob([thumbData.buffer], { type: 'image/png' });
    const objectURL = URL.createObjectURL(thumbBlob);
    await ffmpeg.deleteFile(screenFileName);

    const imgId = `outputImage_${i}_${timestamp}`;
    const imgElement = document.createElement('img');
    imgElement.id = imgId;
    imgElement.src = objectURL;
    imgElement.style.maxWidth = '20%';
    imgElement.style.cursor = 'pointer';
    imgElement.onclick = () => window.open(objectURL, '_blank');
    document.getElementById('output').appendChild(imgElement);
    await new Promise(resolve => imgElement.onload = () => resolve());

    const image = cv.imread(imgId);

    // Convert to grayscale for easier calculations
    const gray = new cv.Mat();
    cv.cvtColor(image, gray, cv.COLOR_RGBA2GRAY, 0);

    // Check darkness
    const meanIntensity = cv.mean(gray);
    const averageIntensity = meanIntensity[0];
    const isDark = averageIntensity < 50; // Threshold can be adjusted
    log(`Average intensity (brightness): ${averageIntensity}`);
    if (isDark) {
      darkScreenshots++;
      log('Dark image');
    }

    // Check blurriness
    const laplacian = new cv.Mat();
    cv.Laplacian(gray, laplacian, cv.CV_64F);
    const mean = new cv.Mat();
    const stddev = new cv.Mat();
    cv.meanStdDev(laplacian, mean, stddev);
    const variance = Math.pow(stddev.data64F[0], 2);
    const isBlurry = variance < 1000; // Threshold can be adjusted
    log(`Variance (blurriness): ${variance}`);
    if (isBlurry) {
      blurryScreenshots++;
      log('Blurry image');
    }

    imgElement.title = `Intensity (brightness): ${averageIntensity}, variance (blurriness): ${variance}`
    if (!isBlurry && !isDark) {
      validScreenshots++;
    }
    log(`Generated ${i} screenshots: ${validScreenshots} clear, ${blurryScreenshots} blurry, ${darkScreenshots} dark`);

    // Clean up
    image.delete();
    gray.delete();
    laplacian.delete();
    mean.delete();
    stddev.delete();
  }
}
