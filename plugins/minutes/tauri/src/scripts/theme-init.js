(() => {
  const THEME_KEY = 'minutes-theme';

  const normalizePreference = (value) => {
    if (value === 'light' || value === 'dark') {
      return value;
    }
    return null;
  };

  const applyPreference = (preference) => {
    const root = document.documentElement;
    if (preference) {
      root.setAttribute('data-theme', preference);
    } else {
      root.removeAttribute('data-theme');
    }
    return preference;
  };

  const readPreference = () => {
    try {
      return normalizePreference(localStorage.getItem(THEME_KEY));
    } catch (_) {
      return null;
    }
  };

  const syncFromStorage = () => applyPreference(readPreference());

  const setPreference = (value) => {
    const normalized = normalizePreference(value);
    try {
      if (normalized) {
        localStorage.setItem(THEME_KEY, normalized);
      } else {
        localStorage.removeItem(THEME_KEY);
      }
    } catch (_) {
      // Ignore storage exceptions (e.g., private mode restrictions)
    }
    return applyPreference(normalized);
  };

  window.MINUTES_THEME = {
    key: THEME_KEY,
    applyPreference,
    normalizePreference,
    readPreference,
    setPreference,
    syncFromStorage,
  };

  syncFromStorage();

  window.addEventListener('storage', (event) => {
    if (event.key === THEME_KEY) {
      applyPreference(normalizePreference(event.newValue));
    }
  });
})();
