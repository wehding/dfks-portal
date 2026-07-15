#!/usr/bin/env node

import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"

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

const likelyDanishTextCommand = [
  "rg",
  "-l",
  '"[ÆØÅæøå]|\\b(Gem|Slet|Annuller|Tilføj|Opret|Rediger|Kontrakt|Værk|Rettighed|Besked|Hjælp|Søg|Status|Type|Tilbage|Fortsæt)\\b"',
  "app",
  "components",
  "--glob",
  '"*.tsx"',
].join(" ")

const i18nUsageCommand = "rg -l -F \"useI18n(\" app components --glob \"*.tsx\""

function run(command) {
  try {
    return execSync(command, { encoding: "utf8" }).trim().split(/\n/).filter(Boolean)
  } catch {
    return []
  }
}

const filesWithLikelyText = run(likelyDanishTextCommand)
const filesUsingI18n = new Set(run(i18nUsageCommand))
const filesWithoutI18n = filesWithLikelyText.filter(file => !filesUsingI18n.has(file))

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
