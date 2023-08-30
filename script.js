let ffmpeg;

document.addEventListener('DOMContentLoaded', init);

function log(message) {
  console.log(message);
  const logDiv = document.getElementById('logOutput');
  logDiv.textContent += message + '\n';
  logDiv.scrollTop = logDiv.scrollHeight;
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
  const logOutputCb = ({ type, message }) => {
    duration = parseDuration(message);
    if (duration) {
      ffmpeg.off('log', logOutputCb);
    }
  };
  ffmpeg.on('log', logOutputCb);
  await ffmpeg.exec([
    '-i', videoPath,
    '-an', // No audio output
    '-vn', // No video output
    '-sn', // No subtitle output
    '-hide_banner', // Hide the banner information
  ]);
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

  for (let i = 1; i <= maxAttempts; i++) {
    const timestamp = randomTime();
    const result = await ffmpeg.exec([
      '-ss', `${timestamp}`,
      '-i', videoPath,
      '-an', // No audio output
      '-sn', // No subtitle output
      '-frames:v', '1',
      `screen_${timestamp}.png`
    ]);
    log('Screenshot generated', result);

    const thumbData = await ffmpeg.readFile(`screen_${timestamp}.png`);
    const thumbBlob = new Blob([thumbData.buffer], { type: 'image/png' });
    const objectURL = URL.createObjectURL(thumbBlob);

    const imgId = `outputImage_${timestamp}`;
    const imgElement = document.createElement('img');
    imgElement.id = imgId;
    imgElement.src = objectURL;
    imgElement.style.maxWidth = '20%';
    imgElement.style.cursor = 'pointer';
    imgElement.onclick = () => window.open(objectURL, '_blank');
    imgElement.onload = () => {
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
    };
    document.getElementById('output').appendChild(imgElement);
  }
}
