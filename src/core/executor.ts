

import { exec, type ChildProcess, type ExecException } from 'child_process';
import type { ExecutionResult } from '../types';

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
          maxBuffer: 10 * 1024 * 1024, 
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

          resolve({
            exitCode: 0,
            stdout: stdout || '',
            stderr: stderr || '',
            timedOut: false,
          });
        },
      );

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
