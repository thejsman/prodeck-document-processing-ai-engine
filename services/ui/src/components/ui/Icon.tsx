import { LucideProps } from 'lucide-react';

type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface IconProps extends Omit<LucideProps, 'size'> {
  icon: React.FC<LucideProps>;
  size?: IconSize;
}

const sizeMap: Record<IconSize, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
};

export function Icon({ icon: LucideIcon, size = 'md', strokeWidth = 1.5, ...props }: IconProps) {
  return <LucideIcon size={sizeMap[size]} strokeWidth={strokeWidth} {...props} />;
}
