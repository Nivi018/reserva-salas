import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { URL, fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('./hyperframes/', import.meta.url))
const scenes = JSON.parse(await readFile(join(root, 'escenas.json'), 'utf8'))
const total = scenes.reduce((value, scene) => value + scene.duration, 0)
const scriptPath = fileURLToPath(new URL('./guion.json', import.meta.url))
const script = JSON.parse(await readFile(scriptPath, 'utf8'))
const round = (x) => x.toFixed(2)
const escape = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
let at = 0
const markers = []
const subtitles = []
const srtTime = (value) => new Date(Math.round(value * 1000)).toISOString().slice(11, 23).replace('.', ',')
const clips = scenes.map((scene, index) => {
  const start = at
  at += scene.duration
  for (const shot of scene.stills) markers.push({
    name: shot.name,
    time: round(start + Math.min(shot.seconds, scene.duration - 0.2)),
  })
  const phrases = script[index].voice.split(/(?<=[.!?])\s+/)
  let speechStart = start + 0.16
  const speechLength = Math.min(scene.voiceLength, scene.duration - 0.16)
  const weight = phrases.reduce((sum, phrase) => sum + phrase.length, 0)
  for (const phrase of phrases) {
    const speechEnd = speechStart + speechLength * phrase.length / weight
    subtitles.push(`${subtitles.length + 1}\n${srtTime(speechStart)} --> ${srtTime(speechEnd)}\n${phrase}`)
    speechStart = speechEnd
  }
  const attrs = `data-start="${round(start)}" data-duration="${round(scene.duration)}"`
  return {
    video: `<video id="video-${scene.name}" class="clip footage" src="assets/${scene.file}" muted playsinline ${attrs} data-track-index="1"></video>`,
    title: `<aside id="title-${scene.name}" class="clip footer" ${attrs} data-track-index="2">
      <div class="number">${scene.name}<span> / ${String(scenes.length).padStart(2, '0')}</span></div>
      <div><div class="section">${escape(scene.title)}</div><div class="caption">${escape(scene.caption)}</div></div>
      <div class="badge">RESERVA SALAS&nbsp; / &nbsp;DEMO</div>
    </aside>`,
    audio: `<audio id="voz-${scene.name}" class="clip" src="assets/voz-${scene.name}.wav"
      data-start="${round(start + 0.16)}" data-duration="${round(Math.min(scene.voiceLength, scene.duration - 0.16))}" data-track-index="3" data-volume="0.90"></audio>`,
    chapter: `[${index + 1}] ${String(Math.floor(start / 60)).padStart(2, '0')}:${String(Math.floor(start % 60)).padStart(2, '0')} · ${scene.title}`,
  }
})
const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>Reserva Salas — demostración</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:"Segoe UI",Arial,sans-serif}
#demo{position:relative;width:1440px;height:1080px;overflow:hidden;background:#0d2036;color:#f4f8fe}
.footage{position:absolute;left:80px;top:30px;width:1280px;height:900px;border-radius:10px}
.footer{position:absolute;left:80px;right:80px;top:954px;height:101px;display:flex;align-items:center;gap:23px;border-top:1px solid #476079}
.number{font-size:29px;color:#8edaff;font-weight:750;white-space:nowrap}.number span{font-size:17px;color:#aac0d7}
.section{font-size:29px;line-height:1.14;font-weight:740}.caption{font-size:20px;color:#c4d8ec;margin-top:5px}
.badge{margin-left:auto;align-self:center;font-size:14px;letter-spacing:2px;color:#99c4e9;font-weight:650;white-space:nowrap}
</style></head>
<body><main id="demo" data-composition-id="reserva-salas" data-start="0" data-width="1440" data-height="1080" data-duration="${round(total)}" data-no-timeline>
${clips.map(({ video, title, audio }) => `${video}\n${title}\n${audio}`).join('\n')}
</main></body></html>
`
await mkdir(root, { recursive: true })
await writeFile(join(root, 'index.html'), html)
await writeFile(join(root, 'marcas.json'), JSON.stringify(markers, null, 2))
await writeFile(join(root, 'capitulos.txt'), clips.map(({ chapter }) => chapter).join('\n') + '\n')
await writeFile(fileURLToPath(new URL('./reserva-salas-demo.srt', import.meta.url)), subtitles.join('\n\n') + '\n')
await writeFile(fileURLToPath(new URL('./reserva-salas-demo.vtt', import.meta.url)),
  `WEBVTT\n\n${subtitles.map((caption) => caption.replace(/(?<=\d),(?=\d{3}\b)/g, '.')).join('\n\n')}\n`)
