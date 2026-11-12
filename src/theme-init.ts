// Local script: compatible with Manifest V3's ban on inline JavaScript.
try {
  const theme = localStorage.getItem('theme')
  const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  const style = localStorage.getItem('style') ?? 'paper'
  document.documentElement.dataset.style = ['paper', 'linear', 'swiss', 'brutalist'].includes(style) ? style : 'paper'
} catch { /* Use default appearance if storage is unavailable. */ }
