import { NextResponse } from "next/server";
import { Wallet } from "ethers";

const ENGINE_BASE_URL = process.env.NEXT_PUBLIC_ENGINE_URL ?? "http://localhost:5193";
const ADMIN_KEY = process.env.OCS_ADMIN_PRIVATE_KEY;

/** POST /api/governance — sign and commit a whitelist/blacklist action to the engine. */
export async function POST(req: Request) {
  if (!ADMIN_KEY) {
    return NextResponse.json({ error: "OCS_ADMIN_PRIVATE_KEY not configured on this server." }, { status: 500 });
  }

  const { address, listType, confidence, notes } = await req.json() as {
    address: string;
    listType: number;
    confidence: number;
    notes: string;
  };

  if (!address || typeof listType !== "number") {
    return NextResponse.json({ error: "address and listType are required." }, { status: 400 });
  }

  try {
    const cleanAddr = address.toLowerCase().trim();
    const action = listType === 1 ? "Whitelist" : "Blacklist";
    const message = `Authorize OCS ${action}: ${cleanAddr}`;

    const wallet = new Wallet(ADMIN_KEY.replace(/[^a-fA-F0-9xX]/g, "").trim());
    const signature = await wallet.signMessage(message);

    const res = await fetch(`${ENGINE_BASE_URL}/api/PGTAIL/whitelist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: cleanAddr,
        userAddress: wallet.address.toLowerCase(),
        signature,
        listType,
        confidence: confidence ?? 100,
        notes: notes || `Dashboard commit — ${new Date().toISOString()}`,
      }),
    });

    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: data.message ?? "Engine rejected commit." }, { status: res.status });
    return NextResponse.json({ success: true, message: data.message });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/governance?address=... — prune a registry entry. */
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address");
  if (!address) return NextResponse.json({ error: "address required" }, { status: 400 });

  const res = await fetch(`${ENGINE_BASE_URL}/api/PGTAIL/registry/${encodeURIComponent(address)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });

  if (res.ok) return NextResponse.json({ success: true });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json({ error: data.message ?? "Prune failed." }, { status: res.status });
}
