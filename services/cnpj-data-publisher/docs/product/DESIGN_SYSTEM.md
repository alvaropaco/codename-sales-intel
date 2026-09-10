# Design System Documentation

## Overview

The design system provides a consistent, professional B2B SaaS aesthetic across the SalesIntel platform. It's built on **Tailwind CSS** with custom tokens for colors, typography, spacing, and animations.

## Design Principles

- **Clarity**: Information should be immediately understandable
- **Professionalism**: Enterprise-grade visual language
- **Generosity**: Ample whitespace and breathing room
- **Accessibility**: WCAG 2.1 AA compliant by default
- **Responsive**: Mobile-first, scales to all screen sizes
- **Dark Mode**: Full support for light and dark themes

## Color Palette

### Primary (Blue)
Professional blue for primary actions and accents.
```
primary-50: #f0f6ff (backgrounds)
primary-500: #4d7fff (primary interaction)
primary-600: #1f5aff (buttons, links)
primary-700: #1a47d9 (hover states)
primary-900: #13298d (dark mode text)
```

### Secondary (Slate)
Neutral slate for text, borders, and balance.
```
secondary-500: #64748b (secondary text)
secondary-600: #475569 (labels)
secondary-700: #334155 (primary text)
secondary-900: #0f172a (dark mode primary text)
```

### Success (Green)
Affirmative actions and positive states.
```
success-600: #16a34a
```

### Warning (Amber)
Cautionary states and warnings.
```
warning-600: #d97706
```

### Error (Red)
Destructive actions and error states.
```
error-600: #dc2626
```

### Neutral
For text, borders, and backgrounds.
```
neutral-50: #fafafa (light backgrounds)
neutral-200: #e5e5e5 (borders)
neutral-600: #525252 (secondary text)
neutral-900: #171717 (dark mode backgrounds)
```

## Typography

### Heading Scale
| Level | Size | Weight | Line Height |
|-------|------|--------|-------------|
| H1 | 2.5rem | 700 | 1.2 |
| H2 | 2rem | 700 | 1.3 |
| H3 | 1.5rem | 600 | 1.4 |
| H4 | 1.25rem | 600 | 1.4 |
| H5 | 1.125rem | 600 | 1.5 |
| H6 | 1rem | 600 | 1.5 |

### Body Text
| Style | Size | Weight | Line Height |
|-------|------|--------|-------------|
| Body Large | 1.125rem | 400 | 1.6 |
| Body Medium | 1rem | 400 | 1.6 |
| Body Small | 0.875rem | 400 | 1.5 |
| Body XSmall | 0.75rem | 400 | 1.5 |

### Font Family
- **Primary**: Inter (system fonts as fallback)
- **Monospace**: System monospace (for code)

## Spacing Scale
Tailwind's default spacing scale with custom values:
```
0: 0
1: 0.25rem
2: 0.5rem
3: 0.75rem
4: 1rem
6: 1.5rem
8: 2rem
12: 3rem
16: 4rem
...
```

Custom:
- `gutter`: Responsive padding (1rem-2rem based on viewport)

## Border Radius
| Value | Size |
|-------|------|
| sm | 0.375rem |
| md | 0.5rem |
| lg | 0.75rem |
| xl | 1rem |
| 2xl | 1.25rem |

## Shadows
| Level | Box Shadow |
|-------|------------|
| xs | 0 1px 2px 0 rgb(0 0 0 / 0.05) |
| sm | 0 1px 3px 0 rgb(0 0 0 / 0.1) |
| md | 0 4px 6px -1px rgb(0 0 0 / 0.1) |
| lg | 0 10px 15px -3px rgb(0 0 0 / 0.1) |
| xl | 0 20px 25px -5px rgb(0 0 0 / 0.1) |
| elevation | 0 10px 30px -5px rgb(0 0 0 / 0.15) |

## Component Library

### Button
```tsx
import { Button } from '@/components/ui/button';

// Variants
<Button variant="default">Primary</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline">Outline</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="link">Link</Button>

// Sizes
<Button size="sm">Small</Button>
<Button size="default">Default</Button>
<Button size="lg">Large</Button>
<Button size="icon">Icon</Button>

// States
<Button disabled>Disabled</Button>
```

### Input
```tsx
import { Input } from '@/components/ui/input';

<Input
  type="email"
  placeholder="Enter email"
  defaultValue=""
/>
```

### Card
```tsx
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';

<Card>
  <CardHeader>
    <CardTitle>Card Title</CardTitle>
    <CardDescription>Card description goes here</CardDescription>
  </CardHeader>
  <CardContent>
    {/* Card content */}
  </CardContent>
  <CardFooter>
    {/* Card footer */}
  </CardFooter>
</Card>
```

### Empty State
```tsx
import { EmptyState } from '@/components/states/empty-state';

<EmptyState
  icon="🔍"
  title="No results"
  description="Try adjusting your search filters"
  action={{
    label: "Clear filters",
    onClick: () => {}
  }}
/>
```

### Loading Skeleton
```tsx
import { LoadingSkeleton } from '@/components/states/empty-state';

<LoadingSkeleton lines={3} />
```

### Error State
```tsx
import { ErrorState } from '@/components/states/empty-state';

<ErrorState
  title="Something went wrong"
  message="Unable to load companies. Please try again."
  retry={() => {}}
/>
```

### Main Layout
```tsx
import { MainLayout } from '@/components/layouts/main-layout';

export default function AppLayout({ children }) {
  return <MainLayout>{children}</MainLayout>;
}
```

## Utility Functions

### cn() - Class Merging
Merge and deduplicate Tailwind classes with conflict resolution:
```tsx
import { cn } from '@/lib/utils';

cn('px-4', 'px-6') // Resolves to px-6
```

### formatCurrency()
```tsx
import { formatCurrency } from '@/lib/utils';

formatCurrency(1000) // "R$ 1.000,00"
```

### formatDate()
```tsx
import { formatDate } from '@/lib/utils';

formatDate(new Date()) // "11 de agosto de 2026"
```

### truncate()
```tsx
import { truncate } from '@/lib/utils';

truncate("Long text", 10) // "Long tex..."
```

### debounce()
```tsx
import { debounce } from '@/lib/utils';

const search = debounce((query: string) => {
  // Search logic
}, 300);
```

### getInitials()
```tsx
import { getInitials } from '@/lib/utils';

getInitials("João Silva") // "JS"
```

### getEmailDomain()
```tsx
import { getEmailDomain } from '@/lib/utils';

getEmailDomain("user@company.com") // "company.com"
```

### isEmpty()
```tsx
import { isEmpty } from '@/lib/utils';

isEmpty("") // true
isEmpty([]) // true
isEmpty({}) // true
```

## Dark Mode

Dark mode is automatically supported on all components. It uses the `dark:` Tailwind prefix.

### Enable Dark Mode
```tsx
// Automatic (respects system preference)
// Or add to html element:
<html className="dark">
```

### Custom Dark Colors
```html
<div className="bg-white dark:bg-neutral-800">
  Content that respects dark mode
</div>
```

## Animations

### Available Animations
```
fade-in: Fade in over 0.2s
fade-out: Fade out over 0.2s
slide-in-up: Slide up from below over 0.3s
slide-out-down: Slide down below over 0.3s
```

### Usage
```html
<div className="animate-fade-in">
  Content animates in
</div>
```

## Responsive Design

### Breakpoints
Tailwind's default breakpoints:
```
sm: 640px
md: 768px
lg: 1024px
xl: 1280px
2xl: 1536px
```

### Mobile-First Approach
```tsx
<div className="flex-col md:flex-row">
  {/* Mobile: column, Desktop: row */}
</div>
```

## Accessibility

### Focus Ring
All interactive elements have focus rings enabled by default:
```tsx
<button className="focus-visible:ring-2 focus-visible:ring-primary-500">
  Click me
</button>
```

### Color Contrast
All text colors meet WCAG 2.1 AA standards (4.5:1 for small text, 3:1 for large).

### Semantic HTML
Always use proper semantic HTML elements:
- Use `<button>` for buttons, not `<div>`
- Use `<a>` for links
- Use `<form>` for forms
- Use `<input>` for form controls

## Best Practices

1. **Use Utility Classes**: Prefer Tailwind utilities over custom CSS
2. **Component Reuse**: Use existing components instead of creating new ones
3. **Consistent Spacing**: Use the spacing scale (4px units)
4. **Responsive First**: Think mobile-first, then enhance for larger screens
5. **Dark Mode**: Test all components in dark mode
6. **Accessibility**: Always test with keyboard navigation and screen readers
7. **Performance**: Keep component trees shallow
8. **Testing**: Test components in both light and dark modes

## Examples

### Card with Button
```tsx
<Card>
  <CardHeader>
    <CardTitle>Create Company</CardTitle>
  </CardHeader>
  <CardContent>
    <Input placeholder="Company name" />
  </CardContent>
  <CardFooter className="flex justify-end space-x-2">
    <Button variant="outline">Cancel</Button>
    <Button>Create</Button>
  </CardFooter>
</Card>
```

### Search Input with State
```tsx
<div className="space-y-4">
  <div className="space-y-2">
    <label className="text-sm font-medium">Search</label>
    <Input
      type="search"
      placeholder="Search companies..."
    />
  </div>
  <EmptyState
    icon="🔍"
    title="No results found"
  />
</div>
```

## Component Checklist

Before submitting a component, ensure:

- [ ] Responsive design (mobile-first)
- [ ] Dark mode support
- [ ] Accessibility (keyboard navigation, screen readers)
- [ ] TypeScript types are correct
- [ ] Proper ref forwarding (for interactive elements)
- [ ] Consistent with design system
- [ ] Tested in browser
- [ ] Documentation updated
