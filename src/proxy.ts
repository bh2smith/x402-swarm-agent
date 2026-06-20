import { paymentProxy } from "@x402/next";
import { server, payTo, network } from "@/lib/x402-server";

// The price route uses the fixed-price "exact" scheme and is enforced by this
// middleware. The analyst route (/api/tools/query) is NOT listed here — it uses
// the dynamic "upto" scheme and is wrapped with withX402 in its own handler, so
// it can settle the actual (not max) amount. The middleware passes it through.
export const proxy = paymentProxy(
  {
    "/api/tools/prices": {
      accepts: { scheme: "exact", payTo, price: "$0.001", network },
      description: "Token price endpoint",
    },
  },
  server,
  {
    appName: "Token Price API",
    appLogo: "/x402-icon-blue.png",
  },
);

// Configure which paths the middleware should run on
export const config = {
  matcher: ["/api/tools/:path*"],
};
