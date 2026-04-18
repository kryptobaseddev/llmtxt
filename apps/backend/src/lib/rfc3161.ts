/**
 * Minimal RFC 3161 timestamp client for the tamper-evident audit log (T164).
 *
 * Design decisions:
 * - Uses freetsa.org as the TSA: free, publicly accessible, no account required,
 *   long-standing WebTrust-audited service. Alternative: DigiCert public TSA.
 * - Request format: DER-encoded TimeStampReq wrapping SHA-256(data).
 * - We build the DER request manually to avoid pulling in heavy ASN.1 libraries.
 *   The structure is minimal: v1, SHA-256 hash, nonce, certReq=true.
 * - On failure (network error, non-200 response, TSA error), the function throws
 *   with a descriptive message. Callers MUST catch and treat the failure as partial
 *   (insert checkpoint with tsr_token = null) rather than fatal.
 *
 * RFC 3161 TimeStampReq (minimal, v1) DER structure:
 *
 *   SEQUENCE {
 *     INTEGER 1                      -- version
 *     SEQUENCE {                     -- messageImprint
 *       SEQUENCE {                   -- hashAlgorithm (AlgorithmIdentifier)
 *         OID 2.16.840.1.101.3.4.2.1  -- SHA-256
 *         NULL
 *       }
 *       OCTET STRING <32-byte hash>  -- hashedMessage
 *     }
 *     INTEGER <random nonce>         -- nonce (8 bytes)
 *     BOOLEAN TRUE                   -- certReq
 *   }
 *
 * Reference: https://datatracker.ietf.org/doc/html/rfc3161#section-2.4.1
 */

const FREETSA_URL = 'https://freetsa.org/tsr';
const REQUEST_TIMEOUT_MS = 15_000; // 15 second timeout

// SHA-256 OID: 2.16.840.1.101.3.4.2.1
// Encoded as: 60 86 48 01 65 03 04 02 01
const SHA256_OID_BYTES = Buffer.from([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);

/**
 * Encode a DER length field.
 * For lengths < 128: single byte.
 * For lengths 128-255: two bytes (0x81, length).
 * For lengths 256-65535: three bytes (0x82, hi, lo).
 */
function derLength(len: number): Buffer {
  if (len < 0x80) {
    return Buffer.from([len]);
  } else if (len <= 0xff) {
    return Buffer.from([0x81, len]);
  } else {
    return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
  }
}

/** Wrap bytes in a DER SEQUENCE (tag 0x30). */
function derSequence(content: Buffer): Buffer {
  const len = derLength(content.length);
  return Buffer.concat([Buffer.from([0x30]), len, content]);
}

/** Encode a non-negative integer as a DER INTEGER (tag 0x02). */
function derInteger(value: Buffer | bigint): Buffer {
  let bytes: Buffer;
  if (typeof value === 'bigint') {
    // Convert bigint to big-endian bytes, with a 0x00 prefix if high bit set.
    let hex = value.toString(16);
    if (hex.length % 2 !== 0) hex = '0' + hex;
    bytes = Buffer.from(hex, 'hex');
    if (bytes[0] & 0x80) {
      bytes = Buffer.concat([Buffer.from([0x00]), bytes]);
    }
  } else {
    bytes = value;
    if (bytes.length === 0 || (bytes[0] & 0x80)) {
      bytes = Buffer.concat([Buffer.from([0x00]), bytes]);
    }
  }
  const len = derLength(bytes.length);
  return Buffer.concat([Buffer.from([0x02]), len, bytes]);
}

/** Encode a BOOLEAN TRUE as DER (tag 0x01). */
function derBooleanTrue(): Buffer {
  return Buffer.from([0x01, 0x01, 0xff]);
}

/** Wrap bytes in a DER OCTET STRING (tag 0x04). */
function derOctetString(data: Buffer): Buffer {
  const len = derLength(data.length);
  return Buffer.concat([Buffer.from([0x04]), len, data]);
}

/** Encode a DER OID field (tag 0x06) from pre-encoded OID bytes. */
function derOID(oidBytes: Buffer): Buffer {
  const len = derLength(oidBytes.length);
  return Buffer.concat([Buffer.from([0x06]), len, oidBytes]);
}

/** DER NULL (tag 0x05). */
function derNull(): Buffer {
  return Buffer.from([0x05, 0x00]);
}

/**
 * Build a minimal RFC 3161 TimeStampReq DER buffer for a given data hash.
 *
 * @param dataHash - 32-byte SHA-256 digest of the data to timestamp.
 * @param nonce    - 8-byte random nonce (prevents replay).
 * @returns DER-encoded TimeStampReq as a Buffer.
 */
export function buildTimestampRequest(dataHash: Buffer, nonce: Buffer): Buffer {
  if (dataHash.length !== 32) throw new Error('dataHash must be 32 bytes');
  if (nonce.length !== 8) throw new Error('nonce must be 8 bytes');

  // version: INTEGER 1
  const version = derInteger(Buffer.from([0x01]));

  // hashAlgorithm: SEQUENCE { OID sha-256, NULL }
  const hashAlgorithmSeq = derSequence(Buffer.concat([derOID(SHA256_OID_BYTES), derNull()]));

  // messageImprint: SEQUENCE { hashAlgorithm, hashedMessage }
  const messageImprint = derSequence(
    Buffer.concat([hashAlgorithmSeq, derOctetString(dataHash)]),
  );

  // nonce: INTEGER (8 random bytes, treated as unsigned)
  const nonceBigInt = BigInt('0x' + nonce.toString('hex'));
  const nonceField = derInteger(nonceBigInt);

  // certReq: BOOLEAN TRUE
  const certReq = derBooleanTrue();

  // TimeStampReq ::= SEQUENCE { version, messageImprint, nonce, certReq }
  return derSequence(Buffer.concat([version, messageImprint, nonceField, certReq]));
}

/**
 * Submit a SHA-256 hash to the FreeTSA RFC 3161 timestamp service and return
 * the DER-encoded TimeStampToken as hex.
 *
 * @param merkleRootHex - 64-char lowercase hex of the 32-byte Merkle root.
 * @returns Hex-encoded DER TimeStampToken from the TSA.
 * @throws Error if the TSA is unreachable, returns a non-200 status, or the
 *         response body cannot be parsed as a valid TimeStampResp.
 */
export async function requestRfc3161Timestamp(merkleRootHex: string): Promise<string> {
  if (merkleRootHex.length !== 64) {
    throw new Error(`merkleRootHex must be 64 hex chars, got ${merkleRootHex.length}`);
  }

  const dataHash = Buffer.from(merkleRootHex, 'hex');

  // Generate 8 random bytes for the nonce.
  const nonce = Buffer.allocUnsafe(8);
  for (let i = 0; i < 8; i++) {
    nonce[i] = Math.floor(Math.random() * 256);
  }

  const reqDer = buildTimestampRequest(dataHash, nonce);

  // Send to FreeTSA with a timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(FREETSA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/timestamp-query' },
      // Convert Buffer to Uint8Array for fetch BodyInit compatibility.
      body: new Uint8Array(reqDer),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`RFC 3161 request failed (network error): ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`RFC 3161 TSA returned HTTP ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('timestamp-reply') && !contentType.includes('octet-stream')) {
    // freetsa.org returns application/timestamp-reply; tolerate octet-stream too.
    console.warn(`[rfc3161] unexpected content-type: ${contentType}`);
  }

  const rawBytes = await response.arrayBuffer();
  const respBuf = Buffer.from(rawBytes);

  // Basic sanity check: TimeStampResp is a DER SEQUENCE (0x30) wrapping
  //   { status: PKIStatusInfo, timeStampToken: ContentInfo (optional) }.
  // We store the entire response as the "token" for maximum verifiability.
  // A proper consumer can use openssl ts -verify to validate it.
  if (respBuf.length < 4 || respBuf[0] !== 0x30) {
    throw new Error('RFC 3161 response does not look like a DER SEQUENCE');
  }

  // Check PKIStatusInfo — byte 4 of the inner SEQUENCE should be an INTEGER
  // with value 0x00 (granted) or 0x01 (grantedWithMods).
  // We do a best-effort check without full ASN.1 parsing.
  // Structure: SEQUENCE { SEQUENCE { INTEGER <status> ... } ... }
  // Offset 0: 0x30 (outer seq tag), 1-N: length, then inner content.
  let offset = 1;
  // Skip outer length
  if (respBuf[offset] & 0x80) {
    offset += (respBuf[offset] & 0x7f) + 1;
  } else {
    offset += 1;
  }
  // Now at inner SEQUENCE (PKIStatusInfo)
  if (offset < respBuf.length && respBuf[offset] === 0x30) {
    offset += 1; // skip inner seq tag
    if (respBuf[offset] & 0x80) {
      offset += (respBuf[offset] & 0x7f) + 1;
    } else {
      offset += 1;
    }
    // Now at first element of PKIStatusInfo = INTEGER (status)
    if (offset < respBuf.length && respBuf[offset] === 0x02) {
      const statusLen = respBuf[offset + 1];
      const statusVal = respBuf[offset + 2 + statusLen - 1]; // last byte = value
      if (statusVal !== 0x00 && statusVal !== 0x01) {
        throw new Error(`RFC 3161 TSA returned error status: 0x${statusVal.toString(16)}`);
      }
    }
  }

  return respBuf.toString('hex');
}
