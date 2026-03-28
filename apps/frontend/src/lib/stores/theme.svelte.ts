let theme = $state<'night' | 'winter'>('night');

export function getTheme() {
  return {
    get current() { return theme; },
    get isDark() { return theme === 'night'; },

    init() {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('llmtxt-theme') as 'night' | 'winter' | null;
        if (saved) {
          theme = saved;
        }
        document.documentElement.setAttribute('data-theme', theme);
      }
    },

    toggle() {
      theme = theme === 'night' ? 'winter' : 'night';
      if (typeof window !== 'undefined') {
        localStorage.setItem('llmtxt-theme', theme);
        document.documentElement.setAttribute('data-theme', theme);
      }
    },
  };
}
