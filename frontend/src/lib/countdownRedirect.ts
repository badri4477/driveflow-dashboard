import { toast } from 'sonner';

/**
 * Show a success toast that counts down, then navigate. "Stay here" cancels.
 * Used after bill submit (merchant) and delivery (staff).
 */
export function redirectAfterCountdown(
  navigate: (path: string, options?: { replace?: boolean }) => void,
  path: string,
  message: string,
  destinationLabel = 'home',
  seconds = 3,
) {
  const id = `redirect-${path}`;
  let left = seconds;
  let cancelled = false;

  const render = () =>
    toast.success(message, {
      id,
      description: `Going to ${destinationLabel} in ${left}s…`,
      duration: (seconds + 1) * 1000,
      action: {
        label: 'Stay here',
        onClick: () => {
          cancelled = true;
          clearInterval(timer);
        },
      },
    });

  render();
  const timer = setInterval(() => {
    if (cancelled) return;
    left -= 1;
    if (left <= 0) {
      clearInterval(timer);
      toast.dismiss(id);
      navigate(path, { replace: true });
      return;
    }
    render();
  }, 1000);
}
