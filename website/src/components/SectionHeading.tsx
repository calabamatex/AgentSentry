import { cn } from '@/lib/cn';

interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: 'left' | 'center';
  className?: string;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'left',
  className,
}: SectionHeadingProps) {
  return (
    <header
      className={cn(
        'flex flex-col gap-3',
        align === 'center' && 'items-center text-center',
        className,
      )}
    >
      {eyebrow && (
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-ink-200">
          {eyebrow}
        </span>
      )}
      <h2 className="max-w-[28ch] text-balance text-3xl font-semibold tracking-tight text-ink-50 sm:text-4xl">
        {title}
      </h2>
      {description && (
        <p className="max-w-prose-tight text-ink-200">{description}</p>
      )}
    </header>
  );
}
