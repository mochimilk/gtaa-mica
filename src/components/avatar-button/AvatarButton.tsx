import { Avatar, Button, makeStyles, mergeClasses, type AvatarProps, type ButtonProps } from "@fluentui/react-components";

/*
 * A medium icon-only button is 32px: a 20px icon in 5px padding and a 1px
 * border. The avatar is 24px, so the icon slot grows to it and the padding
 * shrinks to 3px, keeping the button's 32px box.
 */
const useStyles = makeStyles({
  root: {
    padding: "3px",
  },
  icon: {
    width: "24px",
    height: "24px",
    fontSize: "24px",
  },
});

// ButtonProps is a union (a button or an anchor root); omit from each member
// so the union survives, as a plain Omit would merge them.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type AvatarButtonProps = DistributiveOmit<ButtonProps, "icon" | "iconPosition" | "children"> & {
  /** The Avatar shown in place of the icon, at size 24. */
  avatar?: AvatarProps;
};

/**
 * Fluent's icon-only Button with an Avatar as its icon, e.g. the signed-in
 * user. Subtle by default; label it (aria-label or a Tooltip) as any
 * icon-only button. Wrappers' refs reach the button, as Tooltip and
 * MenuTrigger need.
 */
export function AvatarButton({ avatar, appearance = "subtle", className, ...rest }: AvatarButtonProps) {
  const styles = useStyles();
  return (
    <Button
      {...rest}
      appearance={appearance}
      className={mergeClasses(styles.root, className)}
      icon={{ className: styles.icon, children: <Avatar size={24} {...avatar} /> }}
    />
  );
}
