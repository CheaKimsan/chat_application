const DB_NAME = "e2ee-keys";
const STORE_NAME = "keys";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            req.result.createObjectStore(STORE_NAME);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbSet(key: string, value: unknown): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function generateAndStoreKeyPair(): Promise<CryptoKeyPair> {
    const keyPair = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        false,
        ["deriveKey", "deriveBits"]
    ) as CryptoKeyPair;

    await idbSet("keyPair", keyPair);
    return keyPair;
}

export async function getStoredKeyPair(): Promise<CryptoKeyPair | undefined> {
    return idbGet<CryptoKeyPair>("keyPair");
}

export async function exportPublicKeyBase64(publicKey: CryptoKey): Promise<string> {
    const raw = await crypto.subtle.exportKey("raw", publicKey);
    return arrayBufferToBase64(raw);
}

export async function importPublicKeyFromBase64(base64Key: string): Promise<CryptoKey> {
    const raw = base64ToArrayBuffer(base64Key);
    return crypto.subtle.importKey(
        "raw",
        raw,
        { name: "ECDH", namedCurve: "P-256" },
        true,
        []
    );
}

export async function deriveSharedAesKey(
    myPrivateKey: CryptoKey,
    theirPublicKey: CryptoKey
): Promise<CryptoKey> {
    return crypto.subtle.deriveKey(
        { name: "ECDH", public: theirPublicKey } as EcdhKeyDeriveParams,
        myPrivateKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

export async function encryptMessage(
    sharedKey: CryptoKey,
    plaintext: string
): Promise<{ ciphertext: string; nonce: string }> {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonce },
        sharedKey,
        encoded
    );

    return {
        ciphertext: arrayBufferToBase64(ciphertext),
        nonce: arrayBufferToBase64(nonce.buffer),
    };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export async function decryptMessage(
    sharedKey: CryptoKey,
    ciphertextBase64: string,
    nonceBase64: string
): Promise<string> {
    const ciphertext = base64ToArrayBuffer(ciphertextBase64);
    const nonce = base64ToArrayBuffer(nonceBase64);

    try {
        const plaintextBuf = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: new Uint8Array(nonce) },
            sharedKey,
            ciphertext
        );
        return new TextDecoder().decode(plaintextBuf);
    } catch (err) {
            console.error("AES-GCM decrypt failed", {
                name: (err as Error)?.name,
                message: (err as Error)?.message,
                nonceByteLength: nonce.byteLength, // should be exactly 12
            ciphertextByteLength: ciphertext.byteLength,
        });
        throw err;
    }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    // Normalize base64url -> standard base64, strip whitespace/padding issues.
    // This is the #1 cause of "encrypt/decrypt logic is correct but every
    // round trip through the server fails" — some backends/JSON libs emit
    // URL-safe base64 (using - and _ instead of + and /) by default.
    let normalized = base64.trim().replace(/-/g, "+").replace(/_/g, "/");

    // Re-pad to a multiple of 4 if the server stripped padding (common with
    // url-safe encoders).
    while (normalized.length % 4 !== 0) {
        normalized += "=";
    }

    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}


export async function storePeerPublicKey(userId: string, publicKeyB64: string): Promise<void> {
    await idbSet(`peerPubKey:${userId}`, publicKeyB64);
}

export async function getPeerPublicKey(userId: string): Promise<string | undefined> {
    return idbGet<string>(`peerPubKey:${userId}`);
}