import { NextResponse } from 'next/server';
import { Sandbox } from '@vercel/sandbox';
import { sandboxManager } from '@/lib/sandbox-manager';
import type { SandboxStatusResponse } from '@/types/sandbox';

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
        const isRunning = vercelSandbox.status === 'running';
        const isPending = vercelSandbox.status === 'pending';
        const isStopped = vercelSandbox.status === 'stopped' || vercelSandbox.status === 'stopping';
        const isFailed = vercelSandbox.status === 'failed';

        sandbox = {
          id: sandboxId,
          status: isRunning
            ? 'ready'
            : isPending
              ? 'creating'
              : isStopped
                ? 'stopped'
                : isFailed
                  ? 'failed'
                  : 'creating',
          roomName: sandboxManager.getByRoom(sandboxId)?.roomName,
          agentName: 'sandbox-agent',
          createdAt: Date.now(),
          expiresAt: Date.now() + (vercelSandbox.timeout || 600000),
          progressMessage: isRunning ? 'Agent is ready' : 'Provisioning sandbox...',
        };
        sandboxManager.register(sandbox);
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
