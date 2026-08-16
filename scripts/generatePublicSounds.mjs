import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sampleRate = 44100
const outputDir = resolve('src/assets/sounds/original')
mkdirSync(outputDir, { recursive: true })

function seededNoise(seed) {
  let value = seed >>> 0
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0
    return value / 0xFFFFFFFF * 2 - 1
  }
}

function writeWav(name, duration, synth) {
  const count = Math.ceil(sampleRate * duration)
  const pcm = Buffer.alloc(count * 2)
  const noise = seededNoise([...name].reduce((sum, char) => sum + char.charCodeAt(0), 0))
  for (let index = 0; index < count; index += 1) {
    const time = index / sampleRate
    const attack = Math.min(1, time / 0.004)
    const release = Math.max(0, 1 - time / duration) ** 3.2
    const value = Math.max(-1, Math.min(1, synth(time, duration, noise) * attack * release))
    pcm.writeInt16LE(Math.round(value * 32767), index * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  writeFileSync(resolve(outputDir, name), Buffer.concat([header, pcm]))
}

const chirp = (start, end, time, duration) => Math.sin(2 * Math.PI * (start * time + (end - start) * time ** 2 / (2 * duration)))

writeWav('boop-soft.wav', 0.115, (t, d, noise) => 0.52 * chirp(310, 185, t, d) + 0.08 * noise())
writeWav('boop-round.wav', 0.14, (t, d, noise) => 0.46 * chirp(420, 215, t, d) + 0.16 * Math.sin(2 * Math.PI * 112 * t) + 0.05 * noise())
writeWav('pop-low.wav', 0.09, (t, d, noise) => 0.48 * chirp(235, 105, t, d) + 0.18 * noise())
writeWav('jelly-short.wav', 0.18, (t, d) => 0.42 * chirp(360, 150, t, d) + 0.18 * Math.sin(2 * Math.PI * 82 * t))
writeWav('jelly-bright.wav', 0.16, (t, d) => 0.4 * chirp(720, 285, t, d) + 0.14 * chirp(1080, 520, t, d))
writeWav('drop-cute.wav', 0.24, (t, d) => 0.38 * chirp(520, 190, t, d) + 0.16 * Math.sin(2 * Math.PI * 132 * t))

console.log(`Generated original public-domain-ready sounds in ${outputDir}`)
