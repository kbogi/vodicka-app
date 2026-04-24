import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'success' | 'danger' | 'neutral';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const variantCls: Record<Variant, string> = {
  primary: 'bg-cyan-500 hover:bg-cyan-400 text-slate-900',
  success: 'bg-emerald-500 hover:bg-emerald-400 text-slate-900',
  danger: 'bg-rose-500 hover:bg-rose-400 text-white',
  neutral: 'bg-slate-700 hover:bg-slate-600 text-white',
};

export function BigButton({ variant = 'primary', className = '', ...rest }: Props) {
  return (
    <button
      {...rest}
      className={`big-btn font-bold rounded-2xl px-6 py-5 text-2xl shadow-lg ${variantCls[variant]} disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
    />
  );
}
