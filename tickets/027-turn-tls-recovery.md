# Ticket 027: TURN/TLS browser recovery

Date: 2026-11-01
POC: Tolu Shekoni
TL;DR: Establish browser relay-only audio through trusted TURN/TLS before any GPU rental.

Owner permits direct AdaL deployment implementation and exceeding prior ACT/gas caps for debugging. Preserve protected deployments28831027 and29314839. No automatic funding, domain purchase or secret publication. No GPU lease until browser relay-only candidate statistics and received synthetic audio counters pass. No physical device activation needed.

Scope: akash/transport source, CPU SDL, private runtime preparation, operator-authenticated no-device browser test. ACME certificate and key remain private in container. Verify exact dedicated HTTP marker, successful certificate issuance, hostname/SAN trust and actual TURN/TLS443 endpoint. LiveKit WSS signaling through provider HTTPS. Synthetic oscillator audio is test audio, not Vox proof.

Acceptance: two browser peers connect with relay-only ICE using turns hostname443 transporttcp; selected candidate local type relay and TLS protocol corroborated by server config/cert; remote inbound RTP counters increase and decoded audio energy nonzero. Reconnect passes. Then normal ICE passes. Record actual costs and current state. Close unusable leases and verify closure. Keep a bounded cleanup task for each live test lease.

Commands: validate SDL; Docker Linux startup; external marker and TLS probe; browser stats; chain deployment/lease/balance queries. Document failures rather than claiming readiness.
