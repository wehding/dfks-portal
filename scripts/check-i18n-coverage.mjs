#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { accessSync, constants, readFileSync, readdirSync } from "node:fs"
import { delimiter, join, relative, resolve } from "node:path"

const strict = process.argv.includes("--strict")
const source = readFileSync("lib/i18n.tsx", "utf8")

function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  if (start === -1 || end === -1) throw new Error(`Could not find i18n section ${startMarker}`)
  return source.slice(start, end)
}

function keys(text) {
  return [...text.matchAll(/"([^"]+)"\s*:/g)].map(match => match[1]).sort()
}

const daKeys = keys(section("    da: {", "    en: {"))
const enKeys = keys(section("    en: {", "} as const"))
const missingInEn = daKeys.filter(key => !enKeys.includes(key))
const missingInDa = enKeys.filter(key => !daKeys.includes(key))

console.log(`DA keys: ${daKeys.length}`)
console.log(`EN keys: ${enKeys.length}`)

if (missingInEn.length || missingInDa.length) {
  console.log("\nMissing in EN:")
  console.log(missingInEn.join("\n") || "-")
  console.log("\nMissing in DA:")
  console.log(missingInDa.join("\n") || "-")
}

const sourceRoots = ["app", "components"]
const likelyDanishTextPattern = "[ÆØÅæøå]|\\b(Gem|Slet|Annuller|Tilføj|Opret|Rediger|Kontrakt|Værk|Rettighed|Besked|Hjælp|Søg|Status|Type|Tilbage|Fortsæt)\\b"
const likelyDanishTextRegex = new RegExp(likelyDanishTextPattern)

function executable(path) {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function findRg() {
  const fromPath = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map(folder => join(folder, "rg"))
  return [...fromPath, "/opt/homebrew/bin/rg", "/usr/local/bin/rg"].find(executable) ?? null
}

function runRg(rgPath, args) {
  const result = spawnSync(rgPath, args, { encoding: "utf8", shell: false })
  if (result.error) throw result.error
  // ripgrep exit 1 means a valid scan with no matches. Other non-zero exits are errors.
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(result.stderr?.trim() || `rg exited with status ${result.status}`)
  }
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).sort()
}

function listTsxFiles(folder) {
  const absolute = resolve(folder)
  try {
    return readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
      if (entry.name.startsWith(".") || entry.name === "node_modules") return []
      const path = join(absolute, entry.name)
      if (entry.isDirectory()) return listTsxFiles(path)
      return entry.isFile() && entry.name.endsWith(".tsx") ? [relative(process.cwd(), path)] : []
    })
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return []
    throw error
  }
}

function scanWithNode() {
  const files = sourceRoots.flatMap(listTsxFiles).sort()
  const filesWithLikelyText = []
  const filesUsingI18n = []
  for (const file of files) {
    const contents = readFileSync(file, "utf8")
    if (likelyDanishTextRegex.test(contents)) filesWithLikelyText.push(file)
    if (contents.includes("useI18n(")) filesUsingI18n.push(file)
  }
  return { filesWithLikelyText, filesUsingI18n, scannedFiles: files.length, scanner: "node" }
}

function scanSourceFiles() {
  const rgPath = findRg()
  if (!rgPath) return scanWithNode()
  try {
    const filesWithLikelyText = runRg(rgPath, ["-l", likelyDanishTextPattern, ...sourceRoots, "--glob", "*.tsx"])
    const filesUsingI18n = runRg(rgPath, ["-l", "-F", "useI18n(", ...sourceRoots, "--glob", "*.tsx"])
    const scannedFiles = runRg(rgPath, ["--files", ...sourceRoots, "--glob", "*.tsx"]).length
    return { filesWithLikelyText, filesUsingI18n, scannedFiles, scanner: rgPath }
  } catch (error) {
    console.warn(`rg kunne ikke bruges (${error instanceof Error ? error.message : "ukendt fejl"}); bruger Node-scanner.`)
    return scanWithNode()
  }
}

const scan = scanSourceFiles()
const filesWithLikelyText = scan.filesWithLikelyText
const filesUsingI18n = new Set(scan.filesUsingI18n)
const filesWithoutI18n = filesWithLikelyText.filter(file => !filesUsingI18n.has(file))

console.log(`\nScanner: ${scan.scanner}`)
console.log(`Scanned TSX files: ${scan.scannedFiles}`)
console.log(`\nFiles with likely visible Danish text: ${filesWithLikelyText.length}`)
console.log(`Files using useI18n: ${filesUsingI18n.size}`)
console.log(`Files with likely Danish text but no useI18n: ${filesWithoutI18n.length}`)

if (filesWithoutI18n.length) {
  console.log("\nTop files to migrate:")
  console.log(filesWithoutI18n.slice(0, 80).join("\n"))
}

if (strict && (missingInEn.length || missingInDa.length || filesWithoutI18n.length)) {
  process.exit(1)
}
