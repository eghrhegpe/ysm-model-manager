// 仅检查这两个文件能否被读到
import { readFileSync } from 'fs'
const paths = [
  'frontend/src/core/diary-sink/app.test.ts',
  'frontend/src/core/diary-sink/diary-sink.test.ts',
]
for (const p of paths) {
  try {
    const content = readFileSync(p, 'utf8')
    console.log(`OK ${p} (${content.length} bytes)`)
  } catch (e: any) {
    console.error(`FAIL ${p}: ${e.message}`)
  }
}
