// Containers start with --pull=never, so the image is fetched before the first submission.
import { execFileSync } from 'node:child_process';
import { dockerEnv, SANDBOX_IMAGE } from './docker.js';

execFileSync('docker', ['pull', SANDBOX_IMAGE], { env: dockerEnv(), stdio: 'inherit' });
