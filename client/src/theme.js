const THEME_KEYS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring'
];

// Hub's own theme, used when no tool is displayed. Mirrors client/src/styles/main.css.
export const DEFAULT_THEME = {
  background: '0 0% 7%',
  foreground: '0 0% 93%',
  card: '0 0% 10%',
  'card-foreground': '0 0% 93%',
  popover: '0 0% 10%',
  'popover-foreground': '0 0% 93%',
  primary: '0 0% 85%',
  'primary-foreground': '0 0% 10%',
  secondary: '0 0% 15%',
  'secondary-foreground': '0 0% 90%',
  muted: '0 0% 14%',
  'muted-foreground': '0 0% 60%',
  accent: '0 0% 16%',
  'accent-foreground': '0 0% 92%',
  destructive: '0 72% 62%',
  'destructive-foreground': '0 0% 98%',
  border: '0 0% 17%',
  input: '0 0% 19%',
  ring: '0 0% 80%'
};

export function applyTheme(tokens) {
  const root = document.documentElement;
  for (const key of THEME_KEYS) {
    const value = (tokens && tokens[key]) || DEFAULT_THEME[key];
    root.style.setProperty(`--${key}`, value);
  }
}
