import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runClassifierProcess, type ClassifierProcessRunner } from './classification.ts';
import type { ClassifierSettings } from './types.ts';

export type VisionRequest = { prompt:string; schema:unknown; images:Array<{path:string}> };
export type VisionResponse = { value:unknown; reportedModel?:string };
export type VisionRunner = (request:VisionRequest)=>Promise<VisionResponse>;

/** Same isolated, no-action runner used for quality assessment and scoped classification. */
export async function visionJson(options: {
  settings: ClassifierSettings; directory: string; prompt: string; schema: unknown;
  images: Array<{path: string}>; signal?: AbortSignal; runProcess?: ClassifierProcessRunner; runVision?:VisionRunner;
}): Promise<{value: unknown; reportedModel?: string}> {
  const {settings, images, signal} = options;
  signal?.throwIfAborted();
  if(settings.runner==='mcp') {
    if(!options.runVision)throw new Error('Awaiting the connected ChatGPT MCP client; no model process was started.');
    return options.runVision({prompt:options.prompt,schema:options.schema,images});
  }
  if (settings.runner !== 'codex') throw new Error('Codex unavailable; visual work remains pending.');
  if (!settings.command.trim() || /[\r\n\0]/.test(settings.command)) throw new Error('Invalid executable');
  if (settings.model && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(settings.model)) throw new Error('Invalid model');
  const runDir = path.join(options.directory, `run-${randomUUID()}`);
  await mkdir(runDir, {recursive: true});
  const schemaPath = path.join(runDir, 'schema.json');
  const responsePath = path.join(runDir, 'response.json');
  await writeFile(schemaPath, JSON.stringify(options.schema));
const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--sandbox', 'read-only', '--json', '--color', 'never',
        '--cd', runDir, '--output-schema', schemaPath, '--output-last-message', responsePath,
        '-c', 'web_search="disabled"', '-c', 'mcp_servers={}', '-c', 'approval_policy="never"', '-c', 'forced_login_method="chatgpt"',
        '-c', 'project_doc_max_bytes=0', '-c', 'shell_environment_policy.inherit="none"'];
      for (const feature of ['shell_tool', 'unified_exec', 'apps', 'hooks', 'multi_agent', 'multi_agent_v2', 'plugins', 'remote_plugin', 'browser_use', 'browser_use_external',
        'browser_use_full_cdp_access', 'computer_use', 'image_generation', 'code_mode', 'code_mode_host', 'goals', 'memories', 'view_image', 'skill_search', 'sleep_tool', 'tool_suggest', 'workspace_dependencies']) args.push('--disable', feature);
      args.push('-c', `model_reasoning_effort="${settings.reasoning ?? 'high'}"`);
      if (settings.model) args.push('--model', settings.model.trim());
      for (const image of images) args.push('--image', image.path);
      args.push('-');

  const result = await (options.runProcess ?? runClassifierProcess)(settings.command, args, {
    cwd: runDir, prompt: options.prompt, timeoutMs: settings.timeoutMs, signal,
  });
  signal?.throwIfAborted();
  await writeFile(path.join(runDir, 'stdout.jsonl'), result.stdout);
  await writeFile(path.join(runDir, 'stderr.txt'), result.stderr);
  const raw = await readFile(responsePath, 'utf8').catch(() => result.lastMessage ?? '');
  return {value: JSON.parse(raw), reportedModel: result.model};
}
