import { useTheme } from 'next-themes';
import { ToggleGroup, ToggleGroupItem } from '@databricks/appkit-ui/react';
import { Monitor, Moon, Sun } from 'lucide-react';

const OPTIONS = [
  { value: 'light', label: 'Light theme', icon: Sun },
  { value: 'dark', label: 'Dark theme', icon: Moon },
  { value: 'system', label: 'System theme', icon: Monitor },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={theme}
      onValueChange={(value) => { if (value) setTheme(value); }}
      aria-label="Color theme"
      className="rounded-md border border-sidebar-border"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={label}
          title={label}
          className="size-9 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground data-[state=on]:bg-sidebar-accent data-[state=on]:text-sidebar-foreground"
        >
          <Icon className="size-4" />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
