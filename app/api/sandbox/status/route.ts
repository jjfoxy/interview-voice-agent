import { NextResponse } from 'next/server';
import { Sandbox } from '@vercel/sandbox';
import { sandboxManager } from '@/lib/sandbox-manager';
import type { SandboxStatus, SandboxStatusResponse } from '@/types/sandbox';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sandboxId = searchParams.get('sandboxId');

  if (!sandboxId) {
    return NextResponse.json({ error: 'sandboxId parameter is required' }, { status: 400 });
  }

  let sandbox = sandboxManager.get(sandboxId);

  // If not found in in-memory manager (e.g. running in serverless), query Vercel Sandbox directly
  if (!sandbox) {
    try {
      const vercelSandbox = await Sandbox.get({ sandboxId });
      if (vercelSandbox) {
        const defaultAgentName =
          process.env.LIVEKIT_AGENT_NAME || process.env.AGENT_NAME || 'my-agent';

        if (
          vercelSandbox.status === 'stopped' ||
          vercelSandbox.status === 'stopping' ||
          vercelSandbox.status === 'failed'
        ) {
          sandbox = {
            id: sandboxId,
            status: vercelSandbox.status === 'failed' ? 'failed' : 'stopped',
            roomName: sandboxManager.getByRoom(sandboxId)?.roomName,
            agentName: defaultAgentName,
            createdAt: Date.now(),
            expiresAt: Date.now() + (vercelSandbox.timeout || 600000),
            error: `Sandbox is ${vercelSandbox.status}`,
          };
          sandboxManager.register(sandbox);
        } else {
          // VM is running or pending; check agent status from within the sandbox
          let agentStatus: SandboxStatus = 'installing';
          let progressMessage = 'Initializing sandbox environment...';
          let errorMsg: string | undefined;

          try {
            const check = await vercelSandbox.runCommand({
              cmd: 'cat',
              args: ['/tmp/agent-status.txt'],
            });
            const stdout = (await check.stdout())?.trim();
            if (stdout) {
              const colonIdx = stdout.indexOf(':');
              if (colonIdx !== -1) {
                const s = stdout.substring(0, colonIdx).trim() as SandboxStatus;
                const msg = stdout.substring(colonIdx + 1).trim();
                agentStatus = s;
                progressMessage = msg;
                if (s === 'failed') {
                  errorMsg = msg;
                }
              }
            }
          } catch {
            // Status file not written yet; setup is in progress
          }

          sandbox = {
            id: sandboxId,
            status: agentStatus,
            roomName: sandboxManager.getByRoom(sandboxId)?.roomName,
            agentName: defaultAgentName,
            createdAt: Date.now(),
            expiresAt: Date.now() + (vercelSandbox.timeout || 600000),
            progressMessage,
            error: errorMsg,
          };
          sandboxManager.register(sandbox);
        }
      }
    } catch (e) {
      console.warn('[Sandbox Status] Could not query Vercel Sandbox API directly:', e);
    }
  }

  if (!sandbox) {
    return NextResponse.json({ error: `Sandbox '${sandboxId}' not found` }, { status: 404 });
  }

  const isExpired = sandboxManager.isExpired(sandboxId);
  if (isExpired) sandboxManager.updateStatus(sandboxId, 'stopped');

  const agentConnected = sandbox.status === 'ready' || sandbox.status === 'running';

  return NextResponse.json({
    sandbox,
    agentConnected,
    ready: agentConnected && !isExpired,
  } as SandboxStatusResponse);
}
