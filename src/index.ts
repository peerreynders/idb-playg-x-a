// IDBDatabase (from IDBOpenDBRequest) is the connection to the database

const DB_NAME = 'MESSAGE_STORE';
const STORE_NAME = 'MESSAGES';
const CHANNEL_NAME = 'MESSAGE_NOTIFICATION';

function init() {
  return new Promise<IDBDatabase>(function connect(resolve, reject) {
    const request = self.indexedDB.open(DB_NAME);

    function onError() {
      console.log('Error');
      reject(
        request.error ? request.error : new Error(`Failed to open ${DB_NAME}`)
      );
    }

    function onSuccess() {
      console.log('Success');
      resolve(request.result);
    }

    function onUpgradeNeeded(
      this: IDBOpenDBRequest,
      _e: IDBVersionChangeEvent
    ) {
      console.log('Upgrade Needed');
      const db = request.result;
      if (db.objectStoreNames.contains(STORE_NAME)) return;

      db.createObjectStore(STORE_NAME, {
        autoIncrement: true,
      });
    }

    request.addEventListener('error', onError);
    request.addEventListener('success', onSuccess);
    request.addEventListener('upgradeneeded', onUpgradeNeeded);
  });
}

type MessagePing = {
  recipient: string;
};

type StoreHandle = {
  db: IDBDatabase | undefined;
  error: Error | undefined;
  storeName: string;
  p: Promise<IDBDatabase>;
  channel: BroadcastChannel;
};

const handle = (function () {
  const h: Partial<StoreHandle> = {
    db: undefined,
    error: undefined,
    storeName: STORE_NAME,
    channel: new BroadcastChannel(CHANNEL_NAME),
  };

  function onConnect(db: IDBDatabase) {
    h.db = db;
    h.error = undefined;
  }

  function onError(error: Error) {
    h.error = error;
  }

  h.p = init();
  h.p.then(onConnect).catch(onError);

  return h as StoreHandle;
})();

export interface StoreMessage {
  recipient: string;
  details: unknown;
}

function pushMessage(h: StoreHandle, message: StoreMessage) {
  return new Promise<void>(function addMessage(resolve, reject) {
    const { db, storeName } = h;
    if (!db) return reject(new Error(`Not connected to store "${storeName}"`));

    const transaction = db.transaction(storeName, 'readwrite');

    function onError() {
      reject(transaction.error);
    }

    function onComplete() {
      resolve();
    }

    transaction.addEventListener('error', onError);
    transaction.addEventListener('complete', onComplete);
    transaction.objectStore(storeName).add(message);
  });
}

function popMessages(h: StoreHandle, recipient: string) {
  return new Promise<StoreMessage[]>(function removeMessages(resolve, reject) {
    const { db, storeName } = h;
    if (!db) return reject(new Error(`Not connected to store "${storeName}"`));

    const transaction = db.transaction(storeName, 'readwrite');
    const request = transaction.objectStore(storeName).openCursor();
    const messages: StoreMessage[] = [];

    function onError() {
      reject(request.error);
    }

    // Gets called for every message once
    // and finally with `null` at the end
    function onSuccess() {
      const cursor = request.result;
      // Reached end of cursor?
      if (!cursor) return resolve(messages);

      const message = cursor.value as StoreMessage;
      if (message.recipient !== recipient) return;

      cursor.delete();
      cursor.continue();
      messages.push(message);
    }

    request.onerror = onError;
    request.onsuccess = onSuccess;
  });
}

function subscribe(
  h: StoreHandle,
  recipient: string,
  postMessages: (messages: StoreMessage[]) => void
) {
  const channel = new BroadcastChannel(CHANNEL_NAME);

  async function forwardMessages(e: MessageEvent) {
    const ping = e.data as MessagePing;

    if (ping.recipient !== recipient) return;

    const messages = await popMessages(h, recipient);
    if (messages.length > 0) postMessages(messages);
  }

  channel.addEventListener('message', forwardMessages);
  forwardMessages(new MessageEvent('message', { data: { recipient } }));
  return () => channel.close();
}

export { handle, pushMessage, popMessages, subscribe };

(async function () {
  await handle.p;

  const t0 = performance.now();
  subscribe(handle, 'YOU', function postMessages(messages) {
    const t1 = performance.now();
    console.log(t1 - t0, messages);
  });

  const message = {
    recipient: 'YOU',
    details: {
      text: 'world',
    },
  };
  const message2 = { ...message, details: { text: 'world2' } };
  const message3 = { ...message, details: { text: 'world3' } };

  pushMessage(handle, message);
  pushMessage(handle, message2);
  pushMessage(handle, message3);
})();
