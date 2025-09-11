<template>
  <div class="uploader">
    <h2>آپلود و فشرده‌سازی عکس و ویدئو</h2>

    <input ref="fileInput" type="file" multiple @change="onFileChange" accept="image/*,video/*" />

    <div v-if="items.length" class="items">
      <div v-for="(it, idx) in items" :key="idx" class="item-card">
        <div class="preview">
          <img v-if="it.type.startsWith('image/')" :src="it.previewUrl" alt="preview" />
          <video v-else controls :src="it.previewUrl" preload="metadata"></video>
        </div>
        <div class="meta">
          <div>
            <strong>{{ it.file.name }}</strong> — {{ formatBytes(it.file.size) }}
          </div>
          <div>نوع: {{ it.type }}</div>
          <div v-if="it.status">وضعیت: {{ it.status }}</div>
          <div v-if="it.progress >= 0">پیشرفت آپلود: {{ it.progress }}%</div>
          <button @click="removeItem(idx)">حذف</button>
          <button @click="downloadAllUploaded" :disabled="items.length === 0">
            دانلود همه فایل‌های آپلود شده
          </button>
        </div>
      </div>
    </div>

    <div class="controls">
      <label>حداکثر عرض عکس (px): <input type="number" v-model.number="imageMaxWidth" /></label>
      <label
        >حداکثر حجم عکس (MB): <input step="0.1" type="number" v-model.number="imageMaxMB"
      /></label>
      <label
        >کیفیت عکس (0.1-1): <input step="0.1" type="number" v-model.number="imageQuality"
      /></label>
      <label
        >رزولوشن هدف ویدئو (عرض px): <input type="number" v-model.number="videoTargetWidth"
      /></label>
      <label
        >بیت‌ریت هدف ویدئو (kbps): <input type="number" v-model.number="videoTargetKbps"
      /></label>
    </div>

    <div class="actions">
      <button @click="processAndUpload" :disabled="processing || !items.length">
        فشرده‌سازی و آپلود همه
      </button>
      <button @click="clearAll">پاک کردن همه</button>
    </div>

    <pre v-if="lastResponse">پاسخ سرور: {{ lastResponse }}</pre>
  </div>
</template>
<script setup>
import { ref } from 'vue'
import imageCompression from 'browser-image-compression'
import axios from 'axios'

const fileInput = ref(null)
const items = ref([]) // { file, type, previewUrl, status, progress }
const processing = ref(false)
const lastResponse = ref(null)

// تنظیمات قابل تغییر
const imageMaxWidth = ref(1920)
const imageMaxMB = ref(0.6)
const imageQuality = ref(0.75)
const videoTargetWidth = ref(1280)
const videoTargetKbps = ref(800) // kbps

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function onFileChange(e) {
  const selected = Array.from(e.target.files || [])
  for (const f of selected) {
    const obj = {
      file: f,
      type: f.type,
      previewUrl: URL.createObjectURL(f),
      status: 'آماده',
      progress: -1,
    }
    items.value.push(obj)
  }
}

function removeItem(idx) {
  const it = items.value[idx]
  URL.revokeObjectURL(it.previewUrl)
  items.value.splice(idx, 1)
}

function clearAll() {
  for (const it of items.value) URL.revokeObjectURL(it.previewUrl)
  items.value = []
}

async function processAndUpload() {
  processing.value = true
  lastResponse.value = null
  try {
    for (const it of items.value) {
      it.status = 'در حال فشرده‌سازی'
      let toUploadBlob = null

      // 📥 حجم اولیه
      console.log(`📥 فایل انتخاب شد: ${it.file.name} — حجم اصلی: ${formatBytes(it.file.size)}`)

      if (it.type.startsWith('image/')) {
        try {
          const compressedFile = await compressImage(it.file)
          toUploadBlob = compressedFile
          it.uploadedBlob = compressedFile // ذخیره برای دانلود
          it.status = `فشرده شد — ${formatBytes(compressedFile.size)}`
          console.log(
            `📉 تصویر ${it.file.name} — بعد از فشرده‌سازی: ${formatBytes(compressedFile.size)}`,
          )
        } catch (err) {
          console.error('❌ خطا در فشرده‌سازی تصویر', err)
          it.status = 'خطا در فشرده‌سازی تصویر — ارسال اصلی'
          toUploadBlob = it.file
        }
      } else if (it.type.startsWith('video/')) {
        try {
          const compressedVideoBlob = await compressVideo(it.file, {
            width: videoTargetWidth.value,
            kbps: videoTargetKbps.value,
          })
          toUploadBlob = new File(
            [compressedVideoBlob],
            it.file.name.replace(/\.[^.]+$/, '.webm'),
            { type: compressedVideoBlob.type },
          )
          it.uploadedBlob = toUploadBlob // ذخیره برای دانلود
          it.status = `فشرده شد — ${formatBytes(toUploadBlob.size)}`
          console.log(
            `📉 ویدئو ${it.file.name} — بعد از فشرده‌سازی: ${formatBytes(toUploadBlob.size)}`,
          )
        } catch (err) {
          console.error('❌ خطا در فشرده‌سازی ویدئو', err)
          it.status = 'خطا در فشرده‌سازی ویدئو — ارسال اصلی'
          toUploadBlob = it.file
        }
      } else {
        toUploadBlob = it.file
      }

      // ⬆️ شروع آپلود
      console.log(`⬆️ شروع آپلود: ${it.file.name}`)
      it.status = 'در حال آپلود'
      await uploadFile(toUploadBlob, it)
    }
  } finally {
    processing.value = false
  }
}

async function uploadFile(blobOrFile, it) {
  const url = 'https://httpbin.org/post' // آدرس تستی — به سرور خودت تغییر بده
  const form = new FormData()
  form.append('file', blobOrFile, blobOrFile.name || 'upload')

  try {
    const res = await axios.post(url, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (e.lengthComputable) {
          it.progress = Math.round((e.loaded * 100) / e.total)
        }
      },
      timeout: 5 * 60 * 1000, // 5 دقیقه
    })
    it.status = 'آپلود موفق'
    lastResponse.value = JSON.stringify(res.data).slice(0, 2000)
    console.log(`✅ آپلود موفق: ${it.file.name}`)
  } catch (err) {
    console.error('❌ خطا در آپلود', err)
    it.status = 'خطا در آپلود'
  }
}

// ------------------ Image compression ------------------
async function compressImage(file) {
  const options = {
    maxSizeMB: imageMaxMB.value,
    maxWidthOrHeight: imageMaxWidth.value,
    useWebWorker: true,
    initialQuality: imageQuality.value,
  }
  const compressedFile = await imageCompression(file, options)
  return compressedFile
}

// ------------------ Video compression (client-side) ------------------
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

    video.addEventListener('loadedmetadata', async () => {
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

        const mimeTypeCandidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
        let mimeType =
          mimeTypeCandidates.find(
            (m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m),
          ) || 'video/webm'

        const bitrate = kbps * 1000
        let options = { mimeType }
        try {
          options.videoBitsPerSecond = bitrate
        } catch (e) {}

        let recordedChunks = []
        let mediaRecorder
        try {
          mediaRecorder = new MediaRecorder(stream, options)
        } catch (err) {
          reject(err)
          return
        }

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
              } catch (e) {}
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
    })

    video.addEventListener('error', () => reject(new Error('خطا در بارگذاری ویدئو')))
  })
}

function downloadAllUploaded() {
  for (const item of items.value) {
    const blob = item.uploadedBlob
    if (!blob) continue
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = blob.name || item.file.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }
}
</script>

<style scoped>
.uploader {
  max-width: 900px;
  margin: 1rem auto;
  padding: 1rem;
  border: 1px solid #ddd;
  border-radius: 8px;
}
.items {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}
.item-card {
  display: flex;
  gap: 1rem;
  border: 1px solid #eee;
  padding: 0.5rem;
  border-radius: 6px;
}
.preview img,
.preview video {
  max-width: 160px;
  max-height: 120px;
  display: block;
}
.controls {
  margin-top: 1rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.actions {
  margin-top: 1rem;
}
</style>
