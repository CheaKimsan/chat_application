import { reqGetPublicKey } from "../api/apiClient";
import {
    getStoredKeyPair,
    generateAndStoreKeyPair,
    exportPublicKeyBase64,
    importPublicKeyFromBase64,
    deriveSharedAesKey,
    getPeerPublicKey,
    storePeerPublicKey,
} from "./crypto";

const KEY_EXCHANGE_TIMEOUT_MS = 8000;

let myKeyPair: CryptoKeyPair | null = null;
const sharedKeys = new Map<string, CryptoKey>();
const pendingExchanges = new Map<string, { resolve: (k: CryptoKey) => void; reject: (e: Error) => void }>();

// Guards against concurrent initE2EE() calls (e.g. multiple tabs/components
// mounting at once) racing to generate two different keypairs, where the
// second write silently clobbers the first in IndexedDB.
let initPromise: Promise<CryptoKeyPair> | null = null;

export const initE2EE = (): Promise<CryptoKeyPair> => {
    if (initPromise) return initPromise;

    initPromise = (async () => {
        const existing = await getStoredKeyPair();
        myKeyPair = existing ?? (await generateAndStoreKeyPair());
        return myKeyPair;
    })();

    return initPromise;
};

export const getMyKeyPair = (): CryptoKeyPair | null => myKeyPair;

export const hasSharedKey = (userId: string): boolean => sharedKeys.has(userId);

export const getSharedKey = (userId: string): CryptoKey | undefined => sharedKeys.get(userId);

// Called when a key_exchange_request arrives — respond with our public key.
export const buildKeyExchangeResponse = async (): Promise<string> => {
    if (!myKeyPair) throw new Error("E2EE not initialized — call initE2EE() first");
    return exportPublicKeyBase64(myKeyPair.publicKey);
};

// Called when a key_exchange_response arrives — derive, cache, AND persist the shared key.
export const completeKeyExchange = async (fromUser: string, publicKeyB64: string): Promise<CryptoKey> => {
    if (!myKeyPair) throw new Error("E2EE not initialized — call initE2EE() first");

    // Persist the peer's public key so future sessions can re-derive the same
    // shared secret offline, without needing them online for a live handshake.
    await storePeerPublicKey(fromUser, publicKeyB64);

    const theirPublicKey = await importPublicKeyFromBase64(publicKeyB64);
    const sharedKey = await deriveSharedAesKey(myKeyPair.privateKey, theirPublicKey);
    sharedKeys.set(fromUser, sharedKey);

    const pending = pendingExchanges.get(fromUser);
    if (pending) {
        pending.resolve(sharedKey);
        pendingExchanges.delete(fromUser);
    }

    // let the UI know a key just became available
    window.dispatchEvent(new CustomEvent("chat:key_ready", { detail: { userId: fromUser } }));

    return sharedKey;
};

export const failKeyExchange = (fromUser: string, reason: string): void => {
    const pending = pendingExchanges.get(fromUser);
    if (pending) {
        pending.reject(new Error(reason));
        pendingExchanges.delete(fromUser);
    }
};

// Resolution order:
//   1. In-memory cache (fastest, current session already derived it)
//   2. Persisted peer public key in IndexedDB (works even if peer is offline/left)
//   3. Live socket handshake as last resort (first time ever seeing this peer)
export const waitForSharedKey = async (
    otherUserId: string,
    onNeedsRequest: () => void
): Promise<CryptoKey> => {
    const existing = sharedKeys.get(otherUserId);
    if (existing) return existing;

    if (!myKeyPair) throw new Error("E2EE not initialized — call initE2EE() first");

    const cachedPubKey = await getPeerPublicKey(otherUserId);
    if (cachedPubKey) {
        const theirPublicKey = await importPublicKeyFromBase64(cachedPubKey);
        const sharedKey = await deriveSharedAesKey(myKeyPair.privateKey, theirPublicKey);
        sharedKeys.set(otherUserId, sharedKey);
        return sharedKey;
    }

    // Not cached locally — ask the server's public key directory. Works even
    // if the peer is offline and has never completed a live handshake with
    // us before, since they published their key once at login/signup time.
    try {
        const serverPubKey = await reqGetPublicKey(otherUserId);
        const theirPublicKey = await importPublicKeyFromBase64(serverPubKey);
        const sharedKey = await deriveSharedAesKey(myKeyPair.privateKey, theirPublicKey);
        sharedKeys.set(otherUserId, sharedKey);
        await storePeerPublicKey(otherUserId, serverPubKey); // cache for next time, fully offline-capable after this
        return sharedKey;
    } catch {
        // Peer genuinely has no public key registered server-side yet
        // (e.g. never logged in since this feature shipped) — fall through
        // to the live handshake as a last resort.
    }

    // Fall back to live handshake only if we've truly never seen this peer's key.
    return new Promise((resolve, reject) => {
        pendingExchanges.set(otherUserId, { resolve, reject });
        onNeedsRequest();

        setTimeout(() => {
            if (pendingExchanges.has(otherUserId)) {
                pendingExchanges.delete(otherUserId);
                reject(new Error("key exchange timed out — recipient may be offline"));
            }
        }, KEY_EXCHANGE_TIMEOUT_MS);
    });
};

// Only clears the in-memory session cache — persisted peer public keys in
// IndexedDB are left intact so decrypt still works after reconnect/reload.
export const clearAllSharedKeys = (): void => {
    sharedKeys.clear();
    pendingExchanges.forEach(({ reject }) => {
        reject(new Error("connection closed"));
    });
    pendingExchanges.clear();
};