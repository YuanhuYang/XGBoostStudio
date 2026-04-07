/**
 * 从 client/build/icon.png 生成 client/build/icon.icns（供 macOS 打包）。
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import png2icons from 'png2icons'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const buildDir = path.join(__dirname, '..', 'build')
const pngPath = path.join(buildDir, 'icon.png')
const icnsPath = path.join(buildDir, 'icon.icns')

const input = fs.readFileSync(pngPath)
const out = png2icons.createICNS(input, png2icons.BILINEAR, 0)
if (!out) {
  console.error('emit-icns: createICNS 失败')
  process.exit(1)
}
fs.writeFileSync(icnsPath, out)
console.log('已写入:', icnsPath)
