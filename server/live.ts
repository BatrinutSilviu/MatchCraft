import type { Response } from 'express';

/**
 * Server-Sent Events fan-out: every open organiser page, spectator page and TV screen
 * subscribes to its tournament and is told the new version whenever it changes.
 */
export class LiveHub {
  private subs = new Map<string, Set<Response>>();

  subscribe(tournamentId: string, res: Response) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Stops nginx and similar proxies from buffering the stream.
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    let set = this.subs.get(tournamentId);
    if (!set) this.subs.set(tournamentId, (set = new Set()));
    set.add(res);
    // Comments keep idle connections from being closed by proxies.
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    res.on('close', () => {
      clearInterval(ping);
      set!.delete(res);
      if (!set!.size) this.subs.delete(tournamentId);
    });
  }

  publish(tournamentId: string, payload: Record<string, unknown>) {
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of this.subs.get(tournamentId) ?? []) res.write(line);
  }

  count(tournamentId: string) {
    return this.subs.get(tournamentId)?.size ?? 0;
  }

  closeAll() {
    for (const set of this.subs.values()) for (const res of set) res.end();
    this.subs.clear();
  }
}
