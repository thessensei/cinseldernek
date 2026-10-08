/**
 * Uygulama genelinde paylaşılan durum ve olay yolu.
 * store.set() değişiklikleri 'change' olayıyla yayınlar; emit/on genel olaylar içindir.
 */
const bus = new EventTarget();

export const store = {
  state: {
    user: null,
    settings: { announcement: '', registrationOpen: true },
    rooms: [],
    conversations: [],
    online: new Set(),
    wsStatus: 'idle',
    unreadRooms: 0,
    unreadDms: 0,
    reportsOpen: 0,
    activeThread: null,
  },

  set(patch) {
    Object.assign(this.state, patch);
    bus.dispatchEvent(new CustomEvent('change', { detail: { keys: Object.keys(patch) } }));
  },

  subscribe(listener) {
    bus.addEventListener('change', listener);
    return () => bus.removeEventListener('change', listener);
  },
};

export function emit(type, detail) {
  bus.dispatchEvent(new CustomEvent(type, { detail }));
}

export function on(type, listener) {
  bus.addEventListener(type, listener);
  return () => bus.removeEventListener(type, listener);
}

export const isStaff = (user) => user?.role === 'moderator' || user?.role === 'admin';
export const isAdmin = (user) => user?.role === 'admin';
