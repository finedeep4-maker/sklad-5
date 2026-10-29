import { en } from './en'
import { ar } from './ar'
import { ru } from './ru'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname, basename } from 'node:path'

function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...collectKeys(v as Record<string, unknown>, path))
    } else {
      keys.push(path)
    }
  }
  return keys
}

const dicts: Record<string, Set<string>> = {
  en: new Set(collectKeys(en as unknown as Record<string, unknown>)),
  ar: new Set(collectKeys(ar as unknown as Record<string, unknown>)),
  ru: new Set(collectKeys(ru as unknown as Record<string, unknown>)),
}

const pairs: [string, string][] = [['ru', 'en'], ['ru', 'ar'], ['en', 'ar']]
let hasMissing = false

const PLACEHOLDER_RE = /\{(\w+)\}/g

function collectPlaceholders(obj: Record<string, unknown>, prefix = ''): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {}
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, collectPlaceholders(v as Record<string, unknown>, path))
    } else if (typeof v === 'string') {
      out[path] = new Set([...v.matchAll(PLACEHOLDER_RE)].map((m) => m[1]))
    }
  }
  return out
}

const placeholders: Record<string, Record<string, Set<string>>> = {
  en: collectPlaceholders(en as unknown as Record<string, unknown>),
  ar: collectPlaceholders(ar as unknown as Record<string, unknown>),
  ru: collectPlaceholders(ru as unknown as Record<string, unknown>),
}

for (const [a, b] of pairs) {
  for (const key of dicts[a]) {
    if (!dicts[b].has(key)) continue
    const inA = placeholders[a][key] ?? new Set<string>()
    const inB = placeholders[b][key] ?? new Set<string>()
    const same = inA.size === inB.size && [...inA].every((p) => inB.has(p))
    if (!same) {
      console.error(`Placeholder mismatch for key "${key}": ${a} {${[...inA].sort().join(', ')}} vs ${b} {${[...inB].sort().join(', ')}}`)
      hasMissing = true
    }
  }
}

for (const [a, b] of pairs) {
  const missingInB = [...dicts[a]].filter((k) => !dicts[b].has(k))
  if (missingInB.length > 0) {
    console.error(`Missing keys in ${b} (compared to ${a}):`)
    missingInB.forEach((k) => console.error(`  - ${k}`))
    hasMissing = true
  }
}

if (hasMissing) {
  process.exit(1)
} else {
  console.log('i18n keys are consistent across ru, en, and ar.')
}

const CYRILLIC_RE = /[\u0400-\u04FF]/
const SRC_DIR = join(process.cwd(), 'src')
const I18N_DIR = join(SRC_DIR, 'i18n')
const EXCLUDED_EXTS = new Set(['.css', '.svg', '.png', '.jpg', '.webp', '.ico'])
const COMMENT_RE = /^\s*(\/\/|\/\*|\*|<!--)/

function scanDir(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      scanDir(fullPath, files)
    } else {
      const ext = extname(fullPath)
      const base = basename(fullPath)
      if (EXCLUDED_EXTS.has(ext)) continue
      if (base.includes('.test.')) continue
      if (fullPath.startsWith(I18N_DIR)) continue
      files.push(fullPath)
    }
  }
  return files
}

const files = scanDir(SRC_DIR)
const cyrillicFindings: string[] = []

for (const file of files) {
  const content = readFileSync(file, 'utf-8')
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (COMMENT_RE.test(line)) continue
    if (CYRILLIC_RE.test(line)) {
      const relPath = file.replace(process.cwd() + '/', '')
      cyrillicFindings.push(`${relPath}:${i + 1}: ${line.trim().slice(0, 120)}`)
    }
  }
}

if (cyrillicFindings.length > 0) {
  console.error('\nCyrillic characters found outside src/i18n:')
  cyrillicFindings.forEach((f) => console.error(`  ${f}`))
  process.exit(1)
} else {
  console.log('No Cyrillic characters found outside src/i18n.')
}
