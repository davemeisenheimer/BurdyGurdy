import { HELP_CONTENT } from '../../lib/helpContent';
import { InfoButton } from './InfoButton';

interface Props {
  id: string;
}

export function HelpInfo({ id }: Props) {
  const entry = HELP_CONTENT[id];
  if (!entry) return null;
  return <InfoButton title={entry.title} body={entry.body} imageUrl={entry.imageUrl} />;
}
