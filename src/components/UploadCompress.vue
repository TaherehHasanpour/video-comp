<template>
  <div class="uploader">
    <h2>آپلود و فشرده‌سازی عکس و ویدئو</h2>

    <FilePond
      ref="pond"
      :allow-multiple="true"
      :accepted-file-types="['image/*', 'video/*']"
      :server="serverConfig"
      @addfile="onAddFile"
      label-idle="فایل را بکشید یا کلیک کنید"
    />

    <div class="controls">
      <label
        >رزولوشن هدف ویدئو (عرض px):
        <input type="number" v-model.number="videoTargetWidth" />
      </label>
      <label
        >بیت‌ریت هدف ویدئو (kbps):
        <input type="number" v-model.number="videoTargetKbps" />
      </label>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import vueFilePond from 'vue-filepond'
import FilePondPluginFileValidateType from 'filepond-plugin-file-validate-type'
import FilePondPluginFileEncode from 'filepond-plugin-file-encode'
import axios from 'axios'

const FilePond = vueFilePond(FilePondPluginFileValidateType, FilePondPluginFileEncode)
const pond = ref(null)
// درست:
// const FilePond = vueFilePond(FilePondPluginFileValidateType)

// import FilePondPluginFileValidateType from 'filepond-plugin-file-validate-type'

// const FilePond = vueFilePond(FilePondPluginFileValidateType, FilePondPluginFileEncode) // حذف شد
// const FilePond = vueFilePond(FilePondPluginFileValidateType)

const videoTargetWidth = ref(1280)
const videoTargetKbps = ref(800)

// ------------------ Config Server ------------------
const serverConfig = {
  process: (fieldName, file, metadata, load, error, progress, abort) => {
    // فقط برای تست، آپلود مستقیم به httpbin
    const formData = new FormData()
    formData.append(fieldName, file, file.name)

    const request = axios
      .post('https://httpbin.org/post', formData, {
        onUploadProgress: (e) => {
          progress(e.lengthComputable, e.loaded, e.total)
        },
      })
      .then((res) => {
        load(res.data.url || file.name) // URL فایل آپلود شده
      })
      .catch((err) => {
        error('Upload failed')
      })

    return {
      abort: () => {
        request.cancel()
        abort()
      },
    }
  },
}

// ------------------ فایل اضافه شد ------------------
async function onAddFile(error, fileItem) {
  if (error) return

  const file = fileItem.file

  // اگر فایل فشرده شده است، دوباره فشرده نکن
  if (fileItem.getMetadata('compressed')) return

  if (file.type.startsWith('video/')) {
    console.log(`📥 ویدئو اضافه شد: ${file.name} — حجم اصلی: ${formatBytes(file.size)}`)

    try {
      const compressedBlob = await compressVideo(file, {
        width: videoTargetWidth.value,
        kbps: videoTargetKbps.value,
      })

      console.log(`📉 ویدئو ${file.name} — بعد از فشرده‌سازی: ${formatBytes(compressedBlob.size)}`)

      const compressedFile = new File([compressedBlob], file.name.replace(/\.[^.]+$/, '.webm'), {
        type: compressedBlob.type,
      })

      // اضافه کردن metadata برای جلوگیری از دوباره فشرده کردن
      pond.value.removeFile(fileItem.id)
      const newFileItem = await pond.value.addFile(compressedFile)
      newFileItem.setMetadata('compressed', true)
    } catch (err) {
      console.error('❌ خطا در فشرده‌سازی ویدئو', err)
    }
  }
}

// ------------------ کمکی ------------------
function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function compressVideo(file, { width = 1280, kbps = 800 } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof MediaRecorder === 'undefined')
      return reject(new Error('MediaRecorder پشتیبانی نمی‌شود'))

    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.src = url
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'

    video.addEventListener(
      'loadedmetadata',
      () => {
        try {
          const aspect = video.videoWidth / video.videoHeight
          const targetWidth = Math.min(width, video.videoWidth)
          const targetHeight = Math.round(targetWidth / aspect)

          const canvas = document.createElement('canvas')
          canvas.width = targetWidth
          canvas.height = targetHeight
          const ctx = canvas.getContext('2d')

          const fps = 25
          const stream = canvas.captureStream(fps)

          const mimeTypeCandidates = [
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
          ]
          const mimeType =
            mimeTypeCandidates.find(
              (m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m),
            ) || 'video/webm'

          const bitrate = kbps * 1000
          const options = { mimeType, videoBitsPerSecond: bitrate }

          const recordedChunks = []
          const mediaRecorder = new MediaRecorder(stream, options)

          mediaRecorder.ondataavailable = (ev) => {
            if (ev.data && ev.data.size) recordedChunks.push(ev.data)
          }

          mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: mimeType })
            URL.revokeObjectURL(url)
            resolve(blob)
          }

          video.addEventListener('play', () => {
            mediaRecorder.start(1000)
            function draw() {
              if (video.paused || video.ended) {
                try {
                  mediaRecorder.stop()
                } catch {}
                return
              }
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
              requestAnimationFrame(draw)
            }
            requestAnimationFrame(draw)
          })

          video.play().catch((err) => reject(err))
        } catch (err) {
          reject(err)
        }
      },
      { once: true },
    )

    video.addEventListener('error', () => reject(new Error('خطا در بارگذاری ویدئو')))
  })
}
</script>
<style scoped>
.uploader {
  max-width: 500px;
  margin: 20px auto;
}
.uploader {
  max-width: 900px;
  margin: 2rem auto;
  padding: 1.5rem;
  border: 1px solid #ddd;
  border-radius: 10px;
  background: #fafafa;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05);
  font-family: 'Vazir', sans-serif;
}

h2 {
  text-align: center;
  margin-bottom: 1.5rem;
  color: #333;
}

.file-input {
  display: block;
  margin: 0 auto 1rem;
  padding: 0.5rem;
  border-radius: 6px;
  border: 1px solid #ccc;
  width: 100%;
  max-width: 400px;
}

.controls {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.control-item {
  display: flex;
  flex-direction: column;
}

.control-item label {
  font-size: 0.9rem;
  margin-bottom: 0.3rem;
  color: #555;
}

.control-item input {
  padding: 0.4rem 0.5rem;
  border-radius: 5px;
  border: 1px solid #ccc;
}

.actions {
  display: flex;
  gap: 0.8rem;
  justify-content: center;
  margin-bottom: 1rem;
}

.actions button {
  padding: 0.6rem 1.2rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  background: #4caf50;
  color: white;
  font-weight: 500;
  transition: background 0.2s;
}

.actions button:disabled {
  background: #aaa;
  cursor: not-allowed;
}

.actions button:hover:not(:disabled) {
  background: #45a049;
}

.clear-btn {
  background: #f44336;
}

.clear-btn:hover {
  background: #d32f2f;
}

.server-response {
  background: #f0f0f0;
  padding: 0.8rem;
  border-radius: 6px;
  font-size: 0.9rem;
  color: #333;
  overflow-x: auto;
}
</style>
