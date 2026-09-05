import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Shared build/artifact resolver. Agency owns allocation, locking and retention. */
export function runIosBuild({ gameDir, configuration, args, run = execFileSync }) {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'native-output-result-')));
  const resultFile = path.join(temporary, 'result.json');
  try {
    const stdout = run('agency', [
      'workspace', 'run-output', '--repo', path.resolve(gameDir, '../..'),
      '--lane', `${path.basename(gameDir)}-ios-${configuration.toLowerCase()}`,
      '--kind', configuration === 'Release' ? 'durable' : 'scratch',
      '--result-file', resultFile, '--', 'xcodebuild', ...args,
      '-derivedDataPath', '{agency-output}/DerivedData',
    ]);
    const { output_dir: outputDir } = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    if (!path.isAbsolute(outputDir)) throw new Error('Agency returned a non-absolute output directory');
    return {
      stdout,
      derived: path.join(outputDir, 'DerivedData'),
      appPath: path.join(outputDir, 'DerivedData', 'Build', 'Products', `${configuration}-iphoneos`, 'App.app'),
    };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
