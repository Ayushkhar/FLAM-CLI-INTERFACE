/**
 * Command executor — spawns a job's shell command, captures output, enforces timeout.
 *
 * Uses child_process.exec with shell:true so shell builtins and pipes work.
 * On Windows: Node uses cmd.exe by default. On POSIX: /bin/sh.
 *
 * This function NEVER throws — all failures are returned as structured results.
 * This is critical for worker stability: a bad command must fail the job,
 * not crash the worker process.
 */

import { exec, type ChildProcess, type ExecException } from 'child_process';
import type { ExecutionResult } from '../types';

/**
 * Executes a shell command with timeout and output capture.
 *
 * exec() already runs commands in a shell (cmd.exe on Windows, /bin/sh on POSIX),
 * so we don't need to specify shell:true — it's the default behavior.
 *
 * @param command - The shell command to execute
 * @param timeoutSeconds - Maximum runtime in seconds; 0 = no timeout
 * @returns Structured result with exitCode, stdout, stderr, and timeout flag
 */
export function executeCommand(command: string, timeoutSeconds: number): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const timeoutMs = timeoutSeconds > 0 ? timeoutSeconds * 1000 : undefined;
    let timedOut = false;
    let childProcess: ChildProcess;

    try {
      childProcess = exec(
        command,
        {
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024, // 10MB max output
          killSignal: 'SIGKILL',
        },
        (error: ExecException | null, stdout: string, stderr: string) => {
          if (timedOut || (error && 'killed' in error && error.killed && timeoutMs)) {
            timedOut = true;
            resolve({
              exitCode: null,
              stdout: stdout || '',
              stderr: stderr || '',
              timedOut: true,
              error: `timeout after ${timeoutSeconds}s`,
            });
            return;
          }

          if (error) {
            // Command not found (ENOENT), permission denied, etc.
            const exitCode = error.code !== undefined ? (typeof error.code === 'number' ? error.code : 127) : 1;
            resolve({
              exitCode,
              stdout: stdout || '',
              stderr: stderr || error.message || '',
              timedOut: false,
              error: error.message,
            });
            return;
          }

          // Success
          resolve({
            exitCode: 0,
            stdout: stdout || '',
            stderr: stderr || '',
            timedOut: false,
          });
        },
      );

      // Handle spawn errors (e.g., shell not found)
      childProcess.on('error', (err) => {
        resolve({
          exitCode: 127,
          stdout: '',
          stderr: err.message,
          timedOut: false,
          error: err.message,
        });
      });
    } catch (err) {
      // Catch any synchronous errors from exec()
      resolve({
        exitCode: 127,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        timedOut: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
