import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ClassifierSettings } from './types.ts';

const execute = promisify(execFile);
/** Local authentication check only. Never starts inference or falls back to another provider. */
export async function ensureCodexReady(settings: ClassifierSettings, signal?: AbortSignal) {
  if (settings.runner !== 'codex') throw new Error('Codex preflight requires the codex provider.');
  if (!settings.command.trim() || /[\r\n\0]/.test(settings.command))
    throw new Error('Invalid classifier executable.');
  try {
    const result = await execute(settings.command, ['login', 'status'], {
      timeout: 10000,
      maxBuffer: 16384,
      windowsHide: true,
      signal,
    });
    if (!/^Logged in using ChatGPT\b/im.test(`${result.stdout}\n${result.stderr}`))
      throw new Error('ChatGPT authentication is required.');
  } catch {
    signal?.throwIfAborted();
    throw new Error(
      'Codex CLI is unavailable or not authenticated with ChatGPT. Run codex login before collection. No browser or capture was started.',
    );
  }
}
