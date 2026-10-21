import type { LoadError } from '../data/useDataset';
import type { NumberFormats } from './format';
import type { Messages } from './messages.ca';

/** A failed load, worded in the active language when shown (P27). */
export function loadErrorText(failure: LoadError, text: Messages, fmt: NumberFormats): string {
  const { source, cause } = failure;
  switch (source.kind) {
    case 'synthetic':
      return text.app.loadFailed(fmt.int(source.rows), cause);
    case 'real':
      return text.app.loadMonthFailed(fmt.month(source.month), cause);
    case 'history':
      return text.app.loadMonthFailed(text.app.levels[source.level], cause);
  }
}
