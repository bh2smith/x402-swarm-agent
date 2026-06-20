"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { connectWallet, decodeSettlement } from "@/lib/x402-browser";

const GATEWAY = "https://api.gateway.ethswarm.org/bytes/";
const BASESCAN = "https://sepolia.basescan.org/tx/";
const REPO = "https://github.com/bh2smith/x402-swarm-agent";

type Token = { symbol: string; address: string; chainId: number };
const PRESETS: Token[] = [
  { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", chainId: 8453 },
  { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", chainId: 8453 },
  { symbol: "cbBTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", chainId: 8453 },
  { symbol: "DEGEN", address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", chainId: 8453 },
];

type Receipt = {
  ts: string;
  token: Token;
  price: number;
  source: string;
  swarmRef: string | null;
  tx?: string;
  payer?: string;
};

type LedgerEntry = {
  seq: number;
  ts: string;
  endpoint: string;
  request?: { address?: string; chainId?: number };
  payment?: { payer?: string };
  responseAddress?: string;
};

const short = (s?: string, a = 6, b = 4) =>
  !s ? "" : s.length <= a + b + 2 ? s : `${s.slice(0, a)}…${s.slice(-b)}`;

const fmtPrice = (n: number) =>
  n >= 1
    ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    : `$${n.toPrecision(4)}`;

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : `${d.toISOString().replace("T", " ").slice(0, 19)}Z`;
};

export default function Home() {
  const paidFetch = useRef<typeof fetch | null>(null);
  const [addr, setAddr] = useState<string | null>(null);
  const [token, setToken] = useState<Token>(PRESETS[0]);
  const [custom, setCustom] = useState({ address: "", chainId: "8453" });
  const [phase, setPhase] = useState<"idle" | "connecting" | "paying">("idle");
  const [msg, setMsg] = useState<{ kind: "" | "err" | "work"; text: string }>({
    kind: "",
    text: "",
  });
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [ledgerNote, setLedgerNote] = useState<string>("");

  const loadLedger = useCallback(async () => {
    try {
      const r = await fetch("/api/receipts", { cache: "no-store" });
      const j = await r.json();
      setLedger(Array.isArray(j.receipts) ? j.receipts : []);
      setLedgerNote(
        j.configured === false ? "Receipts not configured on this deployment." : "",
      );
    } catch {
      setLedgerNote("Ledger unavailable.");
    }
  }, []);

  useEffect(() => {
    loadLedger();
  }, [loadLedger]);

  const onConnect = useCallback(async () => {
    setPhase("connecting");
    setMsg({ kind: "work", text: "Requesting wallet…" });
    try {
      const c = await connectWallet();
      paidFetch.current = c.paidFetch;
      setAddr(c.address);
      setMsg({ kind: "", text: "" });
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Connection failed." });
    } finally {
      setPhase("idle");
    }
  }, []);

  const active: Token =
    custom.address.length === 42
      ? {
          symbol: short(custom.address),
          address: custom.address,
          chainId: Number(custom.chainId) || 8453,
        }
      : token;

  const onPay = useCallback(async () => {
    if (!paidFetch.current) return;
    setPhase("paying");
    setReceipt(null);
    setMsg({ kind: "work", text: "Awaiting signature, then settling on Base Sepolia…" });
    try {
      const url = `/api/tools/prices?address=${active.address}&chainId=${active.chainId}`;
      const res = await paidFetch.current(url);
      if (!res.ok) {
        throw new Error(
          `Server responded ${res.status}. Token may be unsupported on chain ${active.chainId}.`,
        );
      }
      const data = (await res.json()) as { price: number; source: string };
      const settle = decodeSettlement(res.headers.get("payment-response"));
      setReceipt({
        ts: new Date().toISOString(),
        token: active,
        price: data.price,
        source: data.source,
        swarmRef: res.headers.get("x-receipt"),
        tx: settle?.transaction,
        payer: settle?.payer ?? addr ?? undefined,
      });
      setMsg({ kind: "", text: "" });
      loadLedger();
    } catch (e) {
      const text = e instanceof Error ? e.message : "Payment failed.";
      setMsg({
        kind: "err",
        text: /insufficient|balance|funds/i.test(text)
          ? "Payment failed — your wallet needs Base Sepolia USDC."
          : text,
      });
    } finally {
      setPhase("idle");
    }
  }, [active, addr, loadLedger]);

  return (
    <>
      <div className="wrap">
        <header className="top">
          <span className="brand">
            <span className="hex" />
            <b>X402 · SWARM</b>
          </span>
          <nav>
            <a href="/docs">API</a>
            <a href={REPO} target="_blank" rel="noreferrer">
              Source
            </a>
          </nav>
        </header>

        <section className="hero">
          <div className="eyebrow rise">Pay-per-call · verifiable receipts</div>
          <h1 className="rise d1">
            Token data,
            <br />
            paid <em>by the sip.</em>
          </h1>
          <p className="lede rise d2">
            One signature pays a fraction of a cent in USDC and returns a live token price. Every call
            is settled on Base and minted into an encrypted, tamper-evident receipt on Swarm — readable
            only by you.
          </p>
          <div className="meta-row rise d3">
            <span className="chip">
              price <b>$0.001 / call</b>
            </span>
            <span className="chip">
              rail <b>x402 v2 · USDC</b>
            </span>
            <span className="chip">
              network <b>Base Sepolia</b>
            </span>
            <span className="chip">
              receipts <b>Swarm feed</b>
            </span>
          </div>
        </section>

        <div className="grid">
          <section className="panel rise d2">
            <div className="panel-h">
              <h2>Make a paid call</h2>
              <span className="n">01 / request</span>
            </div>

            {!addr ? (
              <button
                className="btn"
                style={{ width: "100%" }}
                onClick={onConnect}
                disabled={phase === "connecting"}
              >
                {phase === "connecting" ? "Connecting…" : "Connect wallet"}
              </button>
            ) : (
              <div className="wallet">
                <span className="dot" />
                connected&nbsp;
                <b style={{ color: "var(--ink)" }}>{short(addr, 6, 4)}</b>
                &nbsp;· Base Sepolia
              </div>
            )}

            <label className="lbl">Token</label>
            <div className="presets">
              {PRESETS.map((p) => (
                <button
                  key={p.symbol}
                  className="preset"
                  data-on={custom.address.length !== 42 && token.symbol === p.symbol}
                  onClick={() => {
                    setToken(p);
                    setCustom({ address: "", chainId: String(p.chainId) });
                  }}
                >
                  {p.symbol}
                </button>
              ))}
            </div>

            <label className="lbl">…or a custom address</label>
            <div className="row2">
              <input
                className="input"
                placeholder="0x… token contract"
                value={custom.address}
                onChange={(e) => setCustom((c) => ({ ...c, address: e.target.value.trim() }))}
                spellCheck={false}
              />
              <input
                className="input"
                placeholder="chainId"
                value={custom.chainId}
                onChange={(e) => setCustom((c) => ({ ...c, chainId: e.target.value.trim() }))}
                spellCheck={false}
              />
            </div>

            <button
              className="btn-accent btn"
              onClick={addr ? onPay : onConnect}
              disabled={phase === "paying"}
            >
              {phase === "paying" ? (
                "Settling…"
              ) : addr ? (
                <>
                  Fetch price <span className="sub">· sign &amp; pay $0.001</span>
                </>
              ) : (
                "Connect wallet to pay"
              )}
            </button>

            <div className={`status ${msg.kind}`}>{msg.text}</div>
            {addr && (
              <p className="note">
                Need test funds? Grab Base Sepolia USDC from the{" "}
                <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">
                  Circle faucet
                </a>
                . Gas is sponsored — you only sign.
              </p>
            )}
          </section>

          <section className="panel rise d3">
            <div className="panel-h">
              <h2>Your receipt</h2>
              <span className="n">02 / settle</span>
            </div>

            {receipt ? (
              <div className="receipt-slot">
                <div className="receipt" key={receipt.ts}>
                  <div className="r-top">
                    <div className="big">x402 · Swarm</div>
                    <div className="small">payment receipt</div>
                  </div>
                  <div className="r-line">
                    <span className="k">{receipt.token.symbol} / USD</span>
                    <span className="v">{receipt.source}</span>
                  </div>
                  <div className="r-amt">{fmtPrice(receipt.price)}</div>
                  <hr className="r-rule" />
                  <div className="r-line">
                    <span className="k">token</span>
                    <span className="v">{short(receipt.token.address, 8, 6)}</span>
                  </div>
                  <div className="r-line">
                    <span className="k">chain</span>
                    <span className="v">{receipt.token.chainId}</span>
                  </div>
                  <div className="r-line">
                    <span className="k">payer</span>
                    <span className="v">{short(receipt.payer, 8, 6)}</span>
                  </div>
                  <div className="r-line">
                    <span className="k">charged</span>
                    <span className="v">0.001 USDC</span>
                  </div>
                  {receipt.tx && (
                    <div className="r-line">
                      <span className="k">settlement</span>
                      <span className="v">
                        <a href={`${BASESCAN}${receipt.tx}`} target="_blank" rel="noreferrer">
                          {short(receipt.tx, 8, 6)}
                        </a>
                      </span>
                    </div>
                  )}
                  <hr className="r-rule" />
                  <div className="r-line">
                    <span className="k">swarm</span>
                    <span className="v">
                      {receipt.swarmRef ? (
                        <a href={`${GATEWAY}${receipt.swarmRef}`} target="_blank" rel="noreferrer">
                          decrypt ↗
                        </a>
                      ) : (
                        "—"
                      )}
                    </span>
                  </div>
                  <div className="barcode" />
                  <div className="r-foot">encrypted · verifiable · stored on swarm</div>
                </div>
              </div>
            ) : (
              <div className="empty-receipt">
                No receipt yet. Make a paid call and one prints here — with a Swarm link only your
                wallet can decrypt.
              </div>
            )}

            <div className="panel-h" style={{ marginTop: 28 }}>
              <h2>The public ledger</h2>
              <span className="n">03 / verify</span>
            </div>
            <div className="ledger">
              {ledger.length === 0 ? (
                <div className="ledger-empty">{ledgerNote || "No receipts on the feed yet."}</div>
              ) : (
                ledger.map((e, i) => (
                  <div className="lrow" key={`${e.seq}-${i}`}>
                    <span className="seq">#{e.seq}</span>
                    <span>
                      <div className="who">
                        {e.endpoint} · {short(e.request?.address, 6, 4) || "—"}
                      </div>
                      <div className="sub">payer {short(e.payment?.payer, 5, 4) || "anon"}</div>
                    </span>
                    <span className="when">{fmtTime(e.ts)}</span>
                  </div>
                ))
              )}
            </div>
            <div className="ledger-foot">
              The ledger commits to each response without exposing it — entries store only the bare
              content address. Decryption keys go solely to the paying caller.
            </div>
          </section>
        </div>
      </div>

      <div className="wrap">
        <footer>
          <span>x402 Swarm Agent — a clean fork of price-agent.</span>
          <span className="links">
            <a href="/docs">API docs</a>
            <a href={REPO} target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href="https://www.ethswarm.org" target="_blank" rel="noreferrer">
              Swarm
            </a>
            <a href="https://x402.org" target="_blank" rel="noreferrer">
              x402
            </a>
          </span>
        </footer>
      </div>
    </>
  );
}
