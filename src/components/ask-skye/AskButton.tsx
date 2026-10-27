import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import type { FluentIcon } from "@fluentui/react-icons";

// VelmAI's own button, kept as a custom control rather than Fluent's Button:
// the composer's circular Send and Stop and the voice bar's buttons depend on
// its exact sizes, glass fill and inverted Send style. Only the icon set (Fluent instead of
// lucide) and the colours (Fluent tokens, see askSkye.css) differ.

export type AskButtonSize = "default" | "small";
export type AskButtonShape = "default" | "circular";
export type AskButtonAppearance = "primary" | "secondary" | "transparent";

interface AskButtonBaseProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** `default` is 40px tall; `small` is 28px. */
  size?: AskButtonSize;
  /** Icon shown before the text. An icon without text makes the button 1:1. */
  icon?: FluentIcon;
  /** `default` has a 6px radius; `circular` is fully rounded. */
  shape?: AskButtonShape;
  /** `primary` is the brand fill, `secondary` (default) is glass, and `transparent` has no background. */
  appearance?: AskButtonAppearance;
  ref?: Ref<HTMLButtonElement>;
}

/** Text goes between the tags. Icon-only buttons need a `label` for their accessible name and tooltip. */
export type AskButtonProps = AskButtonBaseProps &
  ({ children: ReactNode; label?: string } | { children?: undefined; icon: FluentIcon; label: string });

export function AskButton({
  size = "default",
  shape = "default",
  appearance = "secondary",
  icon: Icon,
  label,
  children,
  className,
  type = "button",
  ...rest
}: AskButtonProps) {
  const iconOnly = !!Icon && (children === undefined || children === null || children === false);
  return (
    <button
      {...rest}
      type={type}
      className={className ? `ask-button ${className}` : "ask-button"}
      data-size={size}
      data-shape={shape}
      data-appearance={appearance}
      data-icon-only={iconOnly}
      aria-label={label ?? rest["aria-label"]}
      title={label ?? rest.title}
    >
      {Icon && <Icon aria-hidden />}
      {!iconOnly && children !== undefined && <span className="ask-button__text">{children}</span>}
    </button>
  );
}
