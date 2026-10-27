#!/usr/bin/env node
// Prints a fresh private signing JWKS (one RS256 key) as a single JSON line,
// for BROKER_SIGNING_JWKS. The output is a secret: write it to your secret
// store, not to a file in the repository or a shell history.
import { calculateJwkThumbprint, exportJWK, generateKeyPair } from "jose";

const { privateKey } = await generateKeyPair("RS256", { modulusLength: 2048, extractable: true });
const jwk = await exportJWK(privateKey);
jwk.kid = await calculateJwkThumbprint(jwk);
jwk.alg = "RS256";
jwk.use = "sig";
process.stdout.write(`${JSON.stringify({ keys: [jwk] })}\n`);
