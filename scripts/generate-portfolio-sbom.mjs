import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const outputDirectory = path.join(root, 'artifacts')
fs.mkdirSync(outputDirectory, { recursive: true })
const npmCli = process.env.npm_execpath
if (npmCli === undefined || npmCli === '') throw new Error('NPM_CLI_UNAVAILABLE')

for (const item of [
  { cwd: root, output: 'portfolio-root.cdx.json' },
  { cwd: path.join(root, 'my-remix-app'), output: 'portfolio-ui.cdx.json' },
]) {
  const generated = spawnSync(process.execPath, [
    npmCli, 'sbom', '--package-lock-only', '--sbom-format', 'cyclonedx', '--sbom-type', 'application',
  ], { cwd: item.cwd, encoding: 'utf8', windowsHide: true })
  if (generated.status !== 0 || generated.stdout.trim() === '') {
    process.stderr.write(generated.error?.message ?? generated.stderr ?? 'SBOM generation failed\n')
    process.exit(generated.status ?? 1)
  }
  const parsed = JSON.parse(generated.stdout)
  fs.writeFileSync(path.join(outputDirectory, item.output), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
}

console.log(`Generated CycloneDX SBOMs in ${outputDirectory}`)
